import { SmtpRepository } from "../db/repositories/smtp.js";
import { encrypt } from "../security/crypto.js";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { loadConfig } from "../config/config.js";
import { createS3Client, getObjectText, putObjectText, resolveS3Location } from "../storage/s3.js";

export interface ParsedSmtpAccount {
  host: string;
  port?: number;
  username: string;
  password: string;
  useTls?: boolean;
  maxPerWindow?: number;
  maxConcurrent?: number;
  emailAccountId?: string;
}

// Very forgiving parser: supports CSV (header) or comma/space-separated lines
export const parseSmtpTxt = (content: string): ParsedSmtpAccount[] => {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // detect header
  const first = lines[0];
  const hasHeader = /host/i.test(first) && /username/i.test(first);
  const rows: string[][] = [];

  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const l = lines[i];
    // prefer CSV split, fallback to whitespace
    let cols = l.split(",").map((c) => c.trim()).filter(Boolean);
    if (cols.length <= 1) cols = l.split(/\s+/).map((c) => c.trim()).filter(Boolean);
    if (cols.length === 0) continue;
    rows.push(cols);
  }

  const out: ParsedSmtpAccount[] = [];
  for (const cols of rows) {
    // Detect format based on first column content
    // Format 1: host:port,username,password,emailAccountId (combined format)
    // Format 2: host,port,username,password,emailAccountId (separate format)
    
    let host = cols[0] ?? "";
    let portText: string | undefined;
    let username = "";
    let password = "";
    let emailAccountId: string | undefined;

    // Check if first column is host:port combined
    if (host.includes(":")) {
      const parts = host.split(":").map((s) => s.trim());
      if (parts.length === 2 && /^\d+$/.test(parts[1])) {
        // Valid combined format: host:port
        host = parts[0];
        portText = parts[1];
        // Remaining columns: username, password, emailAccountId
        username = cols[1] ?? "";
        password = cols[2] ?? "";
        emailAccountId = cols[3] ?? undefined;
      } else {
        // Invalid format, skip
        continue;
      }
    } else {
      // Separate format: host,port,username,password,[maxPerWindow],[maxConcurrent],[emailAccountId]
      portText = cols[1];
      username = cols[2] ?? "";
      password = cols[3] ?? "";
      emailAccountId = cols[4] ?? undefined;
    }

    // Validate and parse port
    const port = portText ? Number(portText) : undefined;
    const maxPerWindow = cols[5] ? Number(cols[5]) : undefined;
    const maxConcurrent = cols[6] ? Number(cols[6]) : undefined;

    // Skip if missing required fields
    if (!host || !username) {
      continue;
    }

    out.push({
      host,
      port: Number.isFinite(port) ? (port as number) : undefined,
      username,
      password: password ?? "",
      useTls: true,
      maxPerWindow: Number.isFinite(maxPerWindow) ? (maxPerWindow as number) : undefined,
      maxConcurrent: Number.isFinite(maxConcurrent) ? (maxConcurrent as number) : undefined,
      emailAccountId
    });
  }

  return out;
};

export interface IngestSmtpAccountsArgs {
  content?: string;
  sourcePath?: string;
  defaultEmailAccountId?: string;
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
  let rawContent = args.content?.trim();
  if ((!rawContent || rawContent.length === 0) && args.sourcePath) {
    rawContent = await fetchTextContent(args.sourcePath.trim());
  }

  if (!rawContent || rawContent.trim().length === 0) {
    throw new Error("missing_content_or_source_path");
  }

  const parsed = parseSmtpTxt(rawContent);
  const repo = new SmtpRepository();
  const results: Array<{ id?: string; error?: string; username?: string }> = [];

  for (const acc of parsed) {
    try {
      const emailAccountId = acc.emailAccountId ?? args.defaultEmailAccountId;
      if (!emailAccountId) {
        results.push({ error: "missing_email_account_id", username: acc.username });
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

      results.push({ id, username: acc.username });
    } catch (err) {
      const message = err instanceof Error ? err.message : "error";
      results.push({ error: message, username: acc.username });
    }
  }

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
    }
  } catch (e) {
    // ignore S3 failures for now
  }

  return results;
};
