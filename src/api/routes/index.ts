import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { loadConfig } from "../../config/config.js";
import { createLogger, getRecentLogs } from "../../logging/logger.js";
import { DatasetRepository } from "../../db/repositories/datasets.js";
import { JobRepository } from "../../db/repositories/jobs.js";
import { HierarchyRepository } from "../../db/repositories/hierarchy.js";
import { InputFormat } from "../../ingestion/types.js";
import { ingestionQueue } from "../../queue/queues.js";
import { getQueueStatus, pauseQueues, resumeQueues } from "../../queue/status.js";
import { jobStore } from "../../jobs/store.js";
import { getDatabasePool } from "../../db/pool.js";
import { sendDatasetWithCampaign } from "../../campaigns/sendService.js";

const notReady = (feature: string) => ({
  status: "not_ready",
  feature
});

const ok = (data: unknown) => {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { ok: true, ...(data as Record<string, unknown>) };
  }

  return { ok: true, data };
};

const config = loadConfig();
const logger = createLogger(config.logLevel);
const datasetRepo = config.databaseUrl ? new DatasetRepository() : null;
const jobRepo = config.databaseUrl ? new JobRepository() : null;
const hierarchyRepo = config.databaseUrl ? new HierarchyRepository() : null;

const allowedFormats: InputFormat[] = ["csv", "json", "txt", "raw", "bulk"];

const parseIngestBody = (body: unknown) => {
  if (!body || typeof body !== "object") {
    return { error: "invalid_body" };
  }

  const payload = body as Record<string, unknown>;
  const rawFormat = payload.format;
  const content = payload.content;
  const sourcePath = payload.sourcePath;
  const campaignId = payload.campaignId;

  const format = typeof rawFormat === "string" && rawFormat.trim().length > 0
    ? rawFormat.trim().toLowerCase()
    : "auto";

  if (!allowedFormats.includes(format as InputFormat)) {
    return { error: "invalid_format" };
  }

  if (typeof content !== "string" && typeof sourcePath !== "string") {
    return { error: "missing_content" };
  }

  return {
    format: format as InputFormat,
    content: typeof content === "string" ? content : "",
    sourcePath: typeof sourcePath === "string" ? sourcePath : undefined,
    campaignId: typeof campaignId === "string" ? campaignId : undefined
  };
};

export const registerRoutes = (server: FastifyInstance): void => {
  server.get("/health", async () => ({ status: "ok" }));

  server.post("/ingest", async (request, reply) => {
    const parsed = parseIngestBody(request.body);
    if ("error" in parsed) {
      reply.code(400).send({ error: parsed.error });
      return;
    }

    let datasetId: string | null = null;

    try {
      if (datasetRepo) {
        const sourcePath = parsed.sourcePath ?? "inline";
        datasetId = await datasetRepo.createDataset({
          sourceType: parsed.format,
          sourcePath
        });
      }

      const job = jobStore.createJob("ingestion", {
        format: parsed.format,
        sourcePath: parsed.sourcePath ?? null,
        campaignId: parsed.campaignId ?? null,
        datasetId
      });

      if (jobRepo) {
        await jobRepo.createJob({
          id: job.id,
          type: "ingestion",
          status: "pending",
          datasetId,
          campaignId: parsed.campaignId ?? null
        });
      }

      await ingestionQueue.add(
        "ingest",
        {
          jobId: job.id,
          datasetId: datasetId ?? undefined,
          input: {
            format: parsed.format,
            content: parsed.content,
            sourcePath: parsed.sourcePath
          },
          campaignId: parsed.campaignId
        },
        { jobId: job.id }
      );

      reply.code(202).send(ok({ jobId: job.id, datasetId, status: job.status }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      logger.error("ingest request failed", { message });
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.get("/status", async (request, reply) => {
    const query = request.query as Record<string, string | undefined> | undefined;
    const jobId = query?.jobId;
    if (jobId) {
      const job = jobStore.getJob(jobId);
      if (!job) {
        reply.code(404).send({ error: "not_found" });
        return;
      }

      reply.send(ok({ job }));
      return;
    }

    reply.send(ok(jobStore.getSummary()));
  });

  server.get("/queue", async (_request, reply) => {
    const status = await getQueueStatus();
    reply.send(ok({ status }));
  });

  server.get("/smtp/status", async (_request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("smtp_status"));
      return;
    }

    try {
      const smtpRepo = new (await import("../../db/repositories/smtp.js")).SmtpRepository();
      const accounts = await smtpRepo.listActiveAccounts();
      reply.send(ok({ accounts }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.get("/accounts/status", async (_request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("accounts_status"));
      return;
    }

    try {
      const smtpRepo = new (await import("../../db/repositories/smtp.js")).SmtpRepository();
      const accounts = await smtpRepo.listActiveAccounts();
      reply.send(ok({ accounts }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  // cPanel hierarchy management
  server.post("/accounts/cpanel", async (request, reply) => {
    if (!hierarchyRepo) {
      reply.send(notReady("db_required"));
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;
    const name = body?.name;
    if (typeof name !== "string" || name.trim() === "") {
      reply.code(400).send({ error: "invalid_name" });
      return;
    }

    try {
      const id = await hierarchyRepo.createCpanel(name.trim());
      reply.code(201).send(ok({ id }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.get("/accounts/cpanel", async (_request, reply) => {
    if (!hierarchyRepo) {
      reply.send(notReady("db_required"));
      return;
    }

    try {
      const list = await hierarchyRepo.listCpanels();
      reply.send(ok({ cpanels: list }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.post("/accounts/subdomain", async (request, reply) => {
    if (!hierarchyRepo) {
      reply.send(notReady("db_required"));
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;
    const cpanelId = body?.cpanelId;
    const name = body?.name;
    if (typeof cpanelId !== "string" || typeof name !== "string") {
      reply.code(400).send({ error: "invalid_body" });
      return;
    }

    try {
      const id = await hierarchyRepo.createSubdomain(cpanelId, name.trim());
      reply.code(201).send(ok({ id }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.get("/accounts/subdomain", async (request, reply) => {
    if (!hierarchyRepo) {
      reply.send(notReady("db_required"));
      return;
    }

    const query = request.query as Record<string, string | undefined> | undefined;
    const cpanelId = query?.cpanelId;

    try {
      const list = await hierarchyRepo.listSubdomains(cpanelId);
      reply.send(ok({ subdomains: list }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.post("/accounts/email", async (request, reply) => {
    if (!hierarchyRepo) {
      reply.send(notReady("db_required"));
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;
    const subdomainId = body?.subdomainId;
    const address = body?.address;
    if (typeof subdomainId !== "string" || typeof address !== "string") {
      reply.code(400).send({ error: "invalid_body" });
      return;
    }

    try {
      const id = await hierarchyRepo.createEmailAccount(subdomainId, address.trim());
      reply.code(201).send(ok({ id }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.get("/accounts/email", async (request, reply) => {
    if (!hierarchyRepo) {
      reply.send(notReady("db_required"));
      return;
    }

    const query = request.query as Record<string, string | undefined> | undefined;
    const subdomainId = query?.subdomainId;

    try {
      const list = await hierarchyRepo.listEmailAccounts(subdomainId);
      reply.send(ok({ emails: list }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  // SMTP account lifecycle
  server.post("/smtp/account", async (request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;
    const emailAccountId = body?.emailAccountId as string | undefined;
    const host = body?.host as string | undefined;
    const port = Number(body?.port ?? 587);
    const username = body?.username as string | undefined;
    const password = body?.password as string | undefined;
    const useTls = typeof body?.useTls === "boolean" ? body.useTls : true;
    const maxPerWindow = Number(body?.maxPerWindow ?? 50);
    const maxConcurrent = Number(body?.maxConcurrent ?? 1);

    if (!emailAccountId || !host || !username || !password) {
      reply.code(400).send({ error: "invalid_body" });
      return;
    }

    try {
      const { encrypt } = await import("../../security/crypto.js");
      const encrypted = encrypt(password);
      const smtpRepo = new (await import("../../db/repositories/smtp.js")).SmtpRepository();
      const id = await smtpRepo.createSmtpAccount({
        emailAccountId,
        host,
        port,
        username,
        passwordEncrypted: encrypted,
        useTls,
        maxPerWindow,
        maxConcurrent
      });

      const { validateAndUpdateAccountStatus } = await import("../../smtp/validator.js");
      const validation = await validateAndUpdateAccountStatus(smtpRepo, id);
      reply.code(201).send(ok({ id, status: validation.ok ? "active" : "failed", validationError: validation.error }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  // Bulk import SMTP accounts via uploaded text content
  server.post("/smtp/import", async (request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;
    const content = body?.content as string | undefined;
    const sourcePath = body?.sourcePath as string | undefined;
    const defaultEmailAccountId = body?.emailAccountId as string | undefined;

    if ((typeof content !== "string" || !content.trim()) && (typeof sourcePath !== "string" || !sourcePath.trim())) {
      reply.code(400).send({ error: "missing_content_or_source_path" });
      return;
    }

    try {
      const { ingestParsedAccounts } = await import("../../smtp/bulkIngest.js");
      const results = await ingestParsedAccounts({
        content: typeof content === "string" && content.trim() ? content : undefined,
        sourcePath: typeof sourcePath === "string" && sourcePath.trim() ? sourcePath.trim() : undefined,
        defaultEmailAccountReference: defaultEmailAccountId
      });
      reply.send(ok({ results }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.get("/smtp/accounts", async (_request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    try {
      const smtpRepo = new (await import("../../db/repositories/smtp.js")).SmtpRepository();
      const list = await smtpRepo.listAllAccounts();
      reply.send(ok({ accounts: list }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.get("/smtp/usage", async (request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    const query = request.query as Record<string, string | undefined> | undefined;
    const windowId = query?.windowId;

    try {
      const smtpRepo = new (await import("../../db/repositories/smtp.js")).SmtpRepository();
      if (windowId) {
        const res = await smtpRepo.pool.query(
          `SELECT smtp_account_id, used_count FROM smtp_usage WHERE window_id = $1 ORDER BY used_count DESC`,
          [windowId]
        );
        reply.send(ok({ usage: res.rows }));
        return;
      }

      // list recent windows
      const res = await smtpRepo.pool.query(`SELECT id, window_start, window_end, status FROM sending_windows ORDER BY window_start DESC LIMIT 10`);
      reply.send(ok({ windows: res.rows }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.put("/smtp/account/:id", async (request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    const id = (request.params as { id?: string }).id;
    const body = request.body as Record<string, unknown> | undefined;
    if (!id || !body) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }

    try {
      const smtpRepo = new (await import("../../db/repositories/smtp.js")).SmtpRepository();
      const update: Record<string, unknown> = {};
      if (typeof body.host === "string") update.host = body.host;
      if (typeof body.port === "number" || typeof body.port === "string") update.port = Number(body.port);
      if (typeof body.username === "string") update.username = body.username;
      if (typeof body.maxPerWindow === "number" || typeof body.maxPerWindow === "string") update.maxPerWindow = Number(body.maxPerWindow);
      if (typeof body.maxConcurrent === "number" || typeof body.maxConcurrent === "string") update.maxConcurrent = Number(body.maxConcurrent);
      if (typeof body.useTls === "boolean") update.useTls = body.useTls;
      if (typeof body.password === "string") {
        const { encrypt } = await import("../../security/crypto.js");
        update.passwordEncrypted = encrypt(body.password);
      }

      await smtpRepo.updateSmtpAccount(id, update as any);

      const shouldValidate = ["host", "port", "username", "useTls", "passwordEncrypted"].some((key) => key in update);
      if (shouldValidate) {
        const { validateAndUpdateAccountStatus } = await import("../../smtp/validator.js");
        const validation = await validateAndUpdateAccountStatus(smtpRepo, id);
        reply.send(ok({ id, status: validation.ok ? "active" : "failed", validationError: validation.error }));
        return;
      }

      reply.send(ok({ id }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.post("/smtp/account/:id/disable", async (request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    const id = (request.params as { id?: string }).id;
    if (!id) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }

    try {
      const smtpRepo = new (await import("../../db/repositories/smtp.js")).SmtpRepository();
      await smtpRepo.disableSmtpAccount(id);
      reply.send(ok({ id }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.post("/smtp/account/:id/enable", async (request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    const id = (request.params as { id?: string }).id;
    if (!id) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }

    try {
      const smtpRepo = new (await import("../../db/repositories/smtp.js")).SmtpRepository();
      await smtpRepo.enableSmtpAccount(id);
      reply.send(ok({ id }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.get("/smtp/failures", async (_request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    try {
      const smtpRepo = new (await import("../../db/repositories/smtp.js")).SmtpRepository();
      const res = await smtpRepo.pool.query(`SELECT smtp_account_id, consecutive_failures, last_failure_at FROM smtp_failures ORDER BY last_failure_at DESC LIMIT 100`);
      reply.send(ok({ failures: res.rows }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.get("/metrics", async (_request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    try {
      const pool = await (await import("../../db/pool.js")).getDatabasePool();
      const jobsRes = await pool.query(`SELECT status, count(*) FROM jobs GROUP BY status`);
      const usageRes = await pool.query(`SELECT smtp_account_id, SUM(used_count) as total_used FROM smtp_usage GROUP BY smtp_account_id`);

      reply.send(ok({ jobs: jobsRes.rows, smtpUsage: usageRes.rows }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.post("/campaigns", async (_request, reply) => {
    const body = _request.body as Record<string, unknown> | undefined;
    const name = body?.name as string | undefined;
    const subject = body?.subject as string | undefined;
    const bodyHtml = body?.body_html as string | undefined;
    const fromAddress = body?.from_address as string | undefined;
    const replyTo = body?.reply_to as string | undefined;
    const smtpAccountEmail = body?.smtp_account_email as string | undefined;

    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    if (!name || !subject || !bodyHtml || !fromAddress) {
      reply.code(400).send({ error: "invalid_body" });
      return;
    }

    try {
      let smtpAccountId: string | null = null;
      if (smtpAccountEmail) {
        const SmtpRepo = (await import("../../db/repositories/smtp.js")).SmtpRepository;
        const smtpRepo = new SmtpRepo();
        const ref = smtpAccountEmail.trim();
        let found = null as any;
        if (ref.includes("@")) {
          const parts = ref.split("@");
          const username = parts[0];
          const host = parts.slice(1).join("@");
          found = await smtpRepo.findByUsernameAndHost(username, host);
        }
        if (!found) {
          found = await smtpRepo.findByUsername(ref);
        }
        if (found) smtpAccountId = found.id;
      }

      const pool = await (await import("../../db/pool.js")).getDatabasePool();
      const createFields = ["name", "subject", "body_html", "from_address", "reply_to"];
      const createValues: unknown[] = [name, subject, bodyHtml, fromAddress, replyTo ?? null];
      if (smtpAccountId) {
        createFields.push("smtp_account_id");
        createValues.push(smtpAccountId);
      }

      const placeholders = createValues.map((_, index) => `$${index + 1}`).join(",");
      const res = await pool.query(
        `INSERT INTO campaigns (${createFields.join(",")}) VALUES (${placeholders}) RETURNING id`,
        createValues
      );
      reply.code(201).send(ok({ id: res.rows[0].id }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.put("/campaigns/:id", async (request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    const id = (request.params as { id?: string }).id;
    const body = request.body as Record<string, unknown> | undefined;
    if (!id || !body) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (typeof body.name === "string") {
      fields.push(`name = $${fields.length + 1}`);
      values.push(body.name);
    }

    if (typeof body.subject === "string") {
      fields.push(`subject = $${fields.length + 1}`);
      values.push(body.subject);
    }

    if (typeof body.body_html === "string") {
      fields.push(`body_html = $${fields.length + 1}`);
      values.push(body.body_html);
    }

    if (typeof body.body_text === "string") {
      fields.push(`body_text = $${fields.length + 1}`);
      values.push(body.body_text);
    }

    if (typeof body.from_address === "string") {
      fields.push(`from_address = $${fields.length + 1}`);
      values.push(body.from_address);
    }

    if (typeof body.reply_to === "string") {
      fields.push(`reply_to = $${fields.length + 1}`);
      values.push(body.reply_to);
    }

    if (typeof body.status === "string") {
      const allowedStatuses = new Set(["draft", "active", "paused", "archived"]);
      if (!allowedStatuses.has(body.status)) {
        reply.code(400).send({ error: "invalid_status" });
        return;
      }

      fields.push(`status = $${fields.length + 1}`);
      values.push(body.status);
    }

    if (fields.length === 0) {
      reply.code(400).send({ error: "no_fields_to_update" });
      return;
    }

    try {
      const pool = await (await import("../../db/pool.js")).getDatabasePool();
      values.push(id);
      const res = await pool.query(
        `UPDATE campaigns SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id, name, subject, status, updated_at`,
        values
      );

      if (!res.rows[0]) {
        reply.code(404).send({ error: "not_found" });
        return;
      }

      reply.send(ok({ campaign: res.rows[0] }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.get("/campaigns", async (_request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    try {
      const res = await (await import("../../db/pool.js")).getDatabasePool().query(`SELECT id,name,subject,status,created_at FROM campaigns ORDER BY created_at DESC LIMIT 50`);
      reply.send(ok({ campaigns: res.rows }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  // Trigger campaign send: create sending jobs in batches
  server.post("/campaigns/:id/send", async (request, reply) => {
    if (!config.databaseUrl) {
      reply.send(notReady("db_required"));
      return;
    }

    const id = (request.params as { id?: string }).id;
    if (!id) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;
    const datasetId = typeof body?.datasetId === "string" ? body.datasetId : undefined;

    if (!datasetId) {
      reply.code(400).send({ error: "dataset_id_required" });
      return;
    }

    try {
      const pool = await getDatabasePool();
      const sendResult = await sendDatasetWithCampaign({ datasetId, campaignId: id, pool });
      if (!sendResult) {
        reply.code(404).send({ error: "not_found" });
        return;
      }

      reply.send(ok({ queued: sendResult.queued, campaignId: sendResult.campaignId, recipients: sendResult.recipients }));
    } catch (err) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  server.post("/control/pause", async (_request, reply) => {
    await pauseQueues();
    reply.send(ok({ status: "paused" }));
  });

  server.post("/control/resume", async (_request, reply) => {
    await resumeQueues();
    reply.send(ok({ status: "running" }));
  });

  server.get("/logs", async (request, reply) => {
    const query = request.query as Record<string, string | undefined> | undefined;
    const limit = Number(query?.limit ?? 100);
    reply.send(ok({ logs: getRecentLogs(Number.isNaN(limit) ? 100 : limit) }));
  });
};
