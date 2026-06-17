import { SmtpRepository } from "../db/repositories/smtp.js";
import { encrypt } from "../security/crypto.js";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { loadConfig } from "../config/config.js";
import { createS3Client, getObjectText, putObjectText, resolveS3Location } from "../storage/s3.js";
import { createLogger } from "../logging/logger.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

export interface ParsedSmtpAccount {
  host: string;
  port?: number;
  username: string;
  password: string;
  useTls?: boolean;
  maxPerWindow?: number;
  maxConcurrent?: number;
  emailAccountReference?: string;
}

// Very forgiving parser: supports CSV (header) or comma/space-separated lines
export const parseSmtpTxt = (content: string): ParsedSmtpAccount[] => {
  logger.info("smtp_parser: starting parse", { contentLength: content.length });
  
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  logger.info("smtp_parser: split into lines", { lineCount: lines.length });
  
  if (lines.length === 0) return [];

  // detect header
  const first = lines[0];
  const hasHeader = /host/i.test(first) && /username/i.test(first);
  logger.info("smtp_parser: header detection", { hasHeader, firstLine: first.substring(0, 100) });
  
  const rows: string[][] = [];

  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const l = lines[i];
    // prefer CSV split, fallback to whitespace
    let cols = l.split(",").map((c) => c.trim()).filter(Boolean);
    if (cols.length <= 1) cols = l.split(/\s+/).map((c) => c.trim()).filter(Boolean);
    if (cols.length === 0) continue;
    rows.push(cols);
  }

  logger.info("smtp_parser: after column split", { rowCount: rows.length });

  const out: ParsedSmtpAccount[] = [];
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const cols = rows[rowIdx];
    logger.info("smtp_parser: processing row", { rowIdx, colCount: cols.length, cols: cols.slice(0, 3) });
    
    // Detect format based on first column content
    // Format 1: host:port,username,password,emailAccountId (combined format)
    // Format 2: host,port,username,password,emailAccountId (separate format)
    
    let host = cols[0] ?? "";
    let portText: string | undefined;
    let username = "";
    let password = "";
    let emailAccountReference: string | undefined;

    // Check if first column is host:port combined
    if (host.includes(":")) {
      const parts = host.split(":").map((s) => s.trim());
      logger.info("smtp_parser: detected colon in first column", { host, parts });
      if (parts.length === 2 && /^\d+$/.test(parts[1])) {
        // Valid combined format: host:port
        host = parts[0];
        portText = parts[1];
        // Remaining columns: username, password, emailAccountId
        username = cols[1] ?? "";
        password = cols[2] ?? "";
        emailAccountReference = cols[3] ?? undefined;
        logger.info("smtp_parser: parsed combined format", { host, portText, username });
      } else {
        // Invalid format, skip
        logger.info("smtp_parser: invalid host:port format, skipping", { parts });
        continue;
      }
    } else {
      // Separate format: host,port,username,password,[maxPerWindow],[maxConcurrent],[emailAccountReference]
      portText = cols[1];
      username = cols[2] ?? "";
      password = cols[3] ?? "";
      emailAccountReference = cols[4] ?? undefined;
      logger.info("smtp_parser: parsed separate format", { host, portText, username });
    }

    // Validate and parse port
    const port = portText ? Number(portText) : undefined;
    const maxPerWindow = cols[5] ? Number(cols[5]) : undefined;
    const maxConcurrent = cols[6] ? Number(cols[6]) : undefined;

    // Skip if missing required fields
    if (!host || !username) {
      logger.info("smtp_parser: missing required fields, skipping", { host, username });
      continue;
    }

    const account: ParsedSmtpAccount = {
      host,
      port: Number.isFinite(port) ? (port as number) : undefined,
      username,
      password: password ?? "",
      useTls: true,
      maxPerWindow: Number.isFinite(maxPerWindow) ? (maxPerWindow as number) : undefined,
      maxConcurrent: Number.isFinite(maxConcurrent) ? (maxConcurrent as number) : undefined,
      emailAccountReference
    };
    
    logger.info("smtp_parser: account extracted", { host: account.host, port: account.port, username: account.username });
    out.push(account);
  }

  logger.info("smtp_parser: parse complete", { totalAccounts: out.length });
  return out;
};

export interface IngestSmtpAccountsArgs {
  content?: string;
  sourcePath?: string;
  defaultEmailAccountReference?: string;
}

const fetchTextContent = async (sourcePath: string): Promise<string> => {
  if (/^https?:\/\//i.test(sourcePath)) {
    const response = await fetch(sourcePath);
    if (!response.ok) {
      throw new Error(`fetch_failed:${response.status}`);
    }
    return response.text();
  }

  if (sourcePath.startsWith("file://")) {
    const filePath = fileURLToPath(sourcePath);
    return (await readFile(filePath, "utf-8")).toString();
  }

  if (sourcePath.startsWith("s3://") || sourcePath.indexOf("://") === -1) {
    const cfg = loadConfig();
    const s3cfg = cfg.s3;
    
    // For s3:// URLs, bucket is in the path; for implicit paths, need configured bucket
    let bucket: string | undefined;
    if (sourcePath.startsWith("s3://")) {
      const location = resolveS3Location(sourcePath, "");
      bucket = location.bucket;
    } else {
      bucket = s3cfg.bucket;
    }

    if (!bucket || !s3cfg.endpoint || !s3cfg.accessKeyId || !s3cfg.secretAccessKey) {
      throw new Error(`s3_not_configured: bucket=${bucket}, endpoint=${!!s3cfg.endpoint}`);
    }

    const client = createS3Client({
      endpoint: s3cfg.endpoint,
      region: s3cfg.region,
      bucket,
      accessKeyId: s3cfg.accessKeyId,
      secretAccessKey: s3cfg.secretAccessKey
    } as any);

    const location = resolveS3Location(sourcePath, bucket);
    return getObjectText(client, location.bucket, location.key);
  }

  throw new Error("unsupported_source_path");
};

export const ingestParsedAccounts = async (args: IngestSmtpAccountsArgs) => {
  const cfg = loadConfig();
  logger.info("smtp_ingest: starting", { hasContent: !!args.content, hasSourcePath: !!args.sourcePath });
  
  let rawContent = args.content?.trim();
  if ((!rawContent || rawContent.length === 0) && args.sourcePath) {
    logger.info("smtp_ingest: fetching from sourcePath", { sourcePath: args.sourcePath });
    rawContent = await fetchTextContent(args.sourcePath.trim());
    logger.info("smtp_ingest: fetched content", { contentLength: rawContent?.length });
  }

  if (!rawContent || rawContent.trim().length === 0) {
    throw new Error("missing_content_or_source_path");
  }

  logger.info("smtp_ingest: parsing content", { contentLength: rawContent.length, contentPreview: rawContent.substring(0, 100) });
  const parsed = parseSmtpTxt(rawContent);
  logger.info("smtp_ingest: parsed complete", { accountCount: parsed.length });
  
  const repo = new SmtpRepository();
  const results: Array<{ id?: string; error?: string; status?: string; username?: string }> = [];

  const { validateAndUpdateAccountStatus } = await import("./validator.js");

  for (const acc of parsed) {
    try {
      const emailAccountReference = acc.emailAccountReference ?? args.defaultEmailAccountReference;
      logger.info("smtp_ingest: processing account", { host: acc.host, username: acc.username, emailAccountReference: !!emailAccountReference });
      
      if (!emailAccountReference) {
        logger.info("smtp_ingest: missing email account reference", { username: acc.username });
        results.push({ error: "missing_email_account_reference", username: acc.username });
        continue;
      }

      const emailAccountId = await resolveEmailAccountId(emailAccountReference);
      if (!emailAccountId) {
        logger.info("smtp_ingest: email account not found", { emailAccountReference, username: acc.username });
        results.push({ error: "email_account_not_found", username: acc.username });
        continue;
      }

      const encrypted = encrypt(acc.password);
      const id = await repo.createSmtpAccount({
        emailAccountId,
        host: acc.host,
        port: acc.port ?? 587,
        username: acc.username,
        passwordEncrypted: encrypted,
        useTls: acc.useTls ?? true,
        maxPerWindow: acc.maxPerWindow ?? 50,
        maxConcurrent: acc.maxConcurrent ?? 1
      });

      const validation = await validateAndUpdateAccountStatus(repo, id);
      if (!validation.ok) {
        logger.warn("smtp_ingest: account validated but marked inactive", { id, username: acc.username, error: validation.error });
        results.push({ id, username: acc.username, status: "failed", error: validation.error });
      } else {
        logger.info("smtp_ingest: account created and validated", { id, username: acc.username });
        results.push({ id, username: acc.username, status: "active" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "error";
      logger.error("smtp_ingest: account creation failed", { username: acc.username, error: message });
      results.push({ error: message, username: acc.username });
    }
  }

  logger.info("smtp_ingest: storing raw file to S3");
  // store raw file to S3 when configured
  try {
    const s3cfg = cfg.s3;
    if (s3cfg && s3cfg.bucket && s3cfg.endpoint && s3cfg.accessKeyId && s3cfg.secretAccessKey) {
      const client = createS3Client({
        endpoint: s3cfg.endpoint,
        region: s3cfg.region,
        bucket: s3cfg.bucket,
        accessKeyId: s3cfg.accessKeyId,
        secretAccessKey: s3cfg.secretAccessKey
      } as any);

      const key = `smtp-uploads/${Date.now()}-${Math.random().toString(36).slice(2,8)}.txt`;
      await putObjectText(client, s3cfg.bucket, key, rawContent, "text/plain");
      logger.info("smtp_ingest: raw file stored", { key });
    }
  } catch (e) {
    logger.warn("smtp_ingest: failed to store raw file to S3", { error: e instanceof Error ? e.message : String(e) });
  }

  logger.info("smtp_ingest: complete", { successCount: results.filter((r) => r.id).length, failCount: results.filter((r) => r.error).length });
  return results;
};

const resolveEmailAccountId = async (reference: string): Promise<string | null> => {
  const HierarchyRepository = (await import("../db/repositories/hierarchy.js")).HierarchyRepository;
  const repo = new HierarchyRepository();

  const list = await repo.listEmailAccounts();
  const lower = reference.trim().toLowerCase();
  const match = list.find((row) => row.address.trim().toLowerCase() === lower);
  if (match) return match.id;

  // If reference looks like an email address, create an EmailAccount for it
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(reference.trim())) return null;

  logger.info("smtp_ingest: email account reference not found, creating new email account", { reference });

  // Find an existing subdomain to attach to, else create a fallback cPanel/subdomain
  let subdomains = await repo.listSubdomains();
  let subdomainId: string | undefined;
  if (subdomains && subdomains.length > 0) {
    subdomainId = subdomains[0].id;
  } else {
    // create fallback cpanel and subdomain
    const cpanelId = await repo.createCpanel("imported");
    subdomainId = await repo.createSubdomain(cpanelId, "imported");
  }

  const createdId = await repo.createEmailAccount(subdomainId!, reference.trim());
  logger.info("smtp_ingest: created email account for import", { email: reference, id: createdId });
  return createdId;
};

