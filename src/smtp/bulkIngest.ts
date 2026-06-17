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
    // Handle two formats:
    // 1. host, port, username, password, maxPerWindow, maxConcurrent, emailAccountId
    // 2. host:port, username, password, emailAccountId (when host:port combined)
    let host = cols[0] ?? "";
    let portText = cols[1] ?? "";
    let username = cols[2] ?? "";
    let password = cols[3] ?? "";
    let emailAccountId = cols[4] ?? undefined;

    // Detect if first column is host:port combined (e.g., smtp.example.com:587)
    if (host && !portText && host.includes(":")) {
      const [hostPart, portPart] = host.split(":").map((s) => s.trim());
      host = hostPart;
      portText = portPart;
      // Shift remaining columns if they exist
      username = cols[1] ?? "";
      password = cols[2] ?? "";
      emailAccountId = cols[3] ?? undefined;
    }

    const port = portText ? Number(portText) : undefined;
    const maxPerWindow = cols[5] ? Number(cols[5]) : undefined;
    const maxConcurrent = cols[6] ? Number(cols[6]) : undefined;

    // Skip if no valid host or username
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
    if (!s3cfg || !s3cfg.bucket || !s3cfg.endpoint || !s3cfg.accessKeyId || !s3cfg.secretAccessKey) {
      throw new Error("s3_not_configured");
    }

    const client = createS3Client({
      endpoint: s3cfg.endpoint,
      region: s3cfg.region,
      bucket: s3cfg.bucket,
      accessKeyId: s3cfg.accessKeyId,
      secretAccessKey: s3cfg.secretAccessKey
    } as any);

    const location = resolveS3Location(sourcePath, s3cfg.bucket);
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
