import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";
import { getDatabasePool } from "../db/pool.js";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { selectCampaignById, sendDatasetWithCampaign } from "../campaigns/sendService.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const uuidRegex = /^[0-9a-fA-F-]{36}$/;

export const parseCampaignUpdateText = (text: string): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  const pairs = text.split(/\s+/).filter(Boolean);
  for (const pair of pairs) {
    const [key, rawValue] = pair.split("=");
    if (!key || rawValue === undefined) continue;

    const value = rawValue.trim();
    switch (key.trim().toLowerCase()) {
      case "name":
        patch.name = value;
        break;
      case "subject":
        patch.subject = value;
        break;
      case "body_html":
        patch.body_html = value;
        break;
      case "body_text":
        patch.body_text = value;
        break;
      case "reply_to":
        patch.reply_to = value;
        break;
      case "status":
        patch.status = value;
        break;
      case "smtp_account_email":
        patch.smtp_account_email = value;
        break;
    }
  }

  return patch;
};

export const saveCampaignFromModal = async (args: {
  campaignId?: string;
  name: string;
  subject: string;
  bodyHtml: string;
  replyTo?: string | null;
  status?: string | null;
  smtpAccountEmail?: string | null;
}): Promise<string> => {
  if (!config.databaseUrl) {
    return "db_required";
  }

  const pool = getDatabasePool();
  let smtpAccountId: string | null = null;

  if (args.smtpAccountEmail) {
    const smtpRepo = new SmtpRepository();
    const emailRef = args.smtpAccountEmail.trim();
    let found = null as any;
    if (emailRef.includes("@")) {
      const parts = emailRef.split("@");
      const username = parts[0];
      const host = parts.slice(1).join("@");
      found = await smtpRepo.findByUsernameAndHost(username, host);
    }
    if (!found) {
      found = await smtpRepo.findByUsername(emailRef);
    }
    if (!found) {
      return "smtp_account_email_not_found";
    }
    smtpAccountId = found.id;
  }

  const status = args.status ? args.status.toLowerCase() : null;
  const allowedStatuses = new Set(["draft", "active", "paused", "archived"]);
  if (status && !allowedStatuses.has(status)) {
    return "invalid_status";
  }

  if (args.campaignId) {
    const fields = ["name = $1", "subject = $2", "body_html = $3", "reply_to = $4"];
    const values: unknown[] = [args.name, args.subject, args.bodyHtml, args.replyTo ?? null];
    if (status) {
      fields.push(`status = $${fields.length + 1}`);
      values.push(status);
    }
    if (smtpAccountId) {
      fields.push(`smtp_account_id = $${fields.length + 1}`);
      values.push(smtpAccountId);
    }
    values.push(args.campaignId);

    const res = await pool.query(`UPDATE campaigns SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id`, values);
    return res.rows[0] ? `updated campaign ${res.rows[0].id}` : "campaign_not_found";
  }

  const createFields = ["name", "subject", "body_html", "reply_to"];
  const createValues: unknown[] = [args.name, args.subject, args.bodyHtml, args.replyTo ?? null];
  if (status) {
    createFields.push("status");
    createValues.push(status);
  }
  if (smtpAccountId) {
    createFields.push("smtp_account_id");
    createValues.push(smtpAccountId);
  }

  const placeholders = createValues.map((_, index) => `$${index + 1}`).join(",");
  const res = await pool.query(`INSERT INTO campaigns (${createFields.join(",")}) VALUES (${placeholders}) RETURNING id`, createValues);
  return `created campaign ${res.rows[0].id}`;
};

export const updateCampaignFromPatch = async (campaignId: string, patch: Record<string, unknown>): Promise<string> => {
  if (!config.databaseUrl) {
    return "db_required";
  }

  if (!uuidRegex.test(campaignId)) {
    return "invalid_campaign_id_format";
  }

  const pool = getDatabasePool();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (typeof patch.name === "string") {
    fields.push(`name = $${fields.length + 1}`);
    values.push(patch.name.slice(0, 500));
  }
  if (typeof patch.subject === "string") {
    fields.push(`subject = $${fields.length + 1}`);
    values.push(patch.subject.slice(0, 500));
  }
  if (typeof patch.body_html === "string") {
    fields.push(`body_html = $${fields.length + 1}`);
    values.push(patch.body_html.slice(0, 50000));
  }
  if (typeof patch.body_text === "string") {
    fields.push(`body_text = $${fields.length + 1}`);
    values.push(patch.body_text.slice(0, 50000));
  }
  if (typeof patch.reply_to === "string") {
    fields.push(`reply_to = $${fields.length + 1}`);
    const replyTo = patch.reply_to.slice(0, 500);
    values.push(replyTo === "" ? null : replyTo);
  }

  if (typeof patch.smtp_account_email === "string") {
    const smtpRepo = new SmtpRepository();
    const emailRef = patch.smtp_account_email.trim().slice(0, 500);
    if (emailRef === "") {
      fields.push("smtp_account_id = NULL");
    } else {
      let found = null as any;
      if (emailRef.includes("@")) {
        const parts = emailRef.split("@");
        const username = parts[0];
        const host = parts.slice(1).join("@");
        found = await smtpRepo.findByUsernameAndHost(username, host);
      }
      if (!found) {
        found = await smtpRepo.findByUsername(emailRef);
      }
      if (!found) {
        return "smtp_account_email_not_found";
      }
      fields.push(`smtp_account_id = $${fields.length + 1}`);
      values.push(found.id);
    }
  }

  if (typeof patch.status === "string") {
    const status = patch.status.toLowerCase().slice(0, 50);
    const allowedStatuses = new Set(["draft", "active", "paused", "archived"]);
    if (!allowedStatuses.has(status)) {
      return "invalid_status";
    }
    fields.push(`status = $${fields.length + 1}`);
    values.push(status);
  }

  if (fields.length === 0) {
    return "no_fields_to_update";
  }

  values.push(campaignId);
  const res = await pool.query(`UPDATE campaigns SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id`, values);
  return res.rows[0] ? `updated campaign ${res.rows[0].id}` : "campaign_not_found";
};

export const deleteCampaignById = async (campaignId: string): Promise<string> => {
  if (!config.databaseUrl) {
    return "db_required";
  }

  const pool = getDatabasePool();
  const res = await pool.query(`DELETE FROM campaigns WHERE id = $1 RETURNING id`, [campaignId]);
  return res.rows[0] ? `deleted campaign ${res.rows[0].id}` : "campaign_not_found";
};

export const queueCampaignSend = async (campaignId: string, datasetId: string): Promise<string> => {
  if (!config.databaseUrl) {
    return "db_required";
  }

  const result = await sendDatasetWithCampaign({ campaignId, datasetId });
  if (!result) {
    return "campaign_not_found";
  }

  return `triggered campaign ${result.campaignId}, queued ${result.queued} send jobs for dataset ${datasetId}`;
};
