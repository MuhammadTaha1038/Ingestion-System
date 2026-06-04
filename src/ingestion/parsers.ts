import { parse } from "csv-parse/sync";
import { extractEmailsFromText } from "./emailExtractor.js";
import { ParsedPayload, ParsedRecord } from "./types.js";

const EMAIL_KEYS = new Set([
  "email",
  "emailaddress",
  "email_address",
  "e-mail",
  "mail"
]);

const normalizeKey = (value: string): string => value.toLowerCase().replace(/[^a-z]/g, "");

const toMetadataObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const pickEmailFromRecord = (record: Record<string, unknown>): string | null => {
  for (const [key, value] of Object.entries(record)) {
    if (!EMAIL_KEYS.has(normalizeKey(key))) {
      continue;
    }

    if (typeof value === "string") {
      const emails = extractEmailsFromText(value);
      if (emails.length > 0) {
        return emails[0];
      }
    }
  }

  for (const value of Object.values(record)) {
    if (typeof value === "string") {
      const emails = extractEmailsFromText(value);
      if (emails.length > 0) {
        return emails[0];
      }
    }
  }

  return null;
};

const isHeaderRow = (row: string[]): boolean =>
  row.some((cell) => cell.trim().toLowerCase().includes("email"));

const buildRowMetadata = (
  header: string[],
  row: string[],
  emailIndexes: Set<number>
): Record<string, unknown> => {
  const metadata: Record<string, unknown> = {};

  header.forEach((key, index) => {
    if (!key || emailIndexes.has(index)) {
      return;
    }

    const value = row[index];
    if (value !== undefined && value !== "") {
      metadata[key] = value;
    }
  });

  return metadata;
};

const extractEmailsFromRow = (
  row: string[],
  emailIndexes: Set<number>
): string[] => {
  const emails: string[] = [];

  if (emailIndexes.size > 0) {
    emailIndexes.forEach((index) => {
      const value = row[index] ?? "";
      emails.push(...extractEmailsFromText(value));
    });

    return emails;
  }

  row.forEach((cell) => {
    emails.push(...extractEmailsFromText(cell));
  });

  return emails;
};

const parseCsvContent = (content: string): ParsedPayload => {
  const records: ParsedRecord[] = [];

  const rows = parse(content, {
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true
  }) as string[][];

  if (rows.length === 0) {
    return { rawCount: 0, records };
  }

  const headerRow = rows[0].map((cell) => String(cell ?? "").trim());
  const hasHeader = isHeaderRow(headerRow);
  const startIndex = hasHeader ? 1 : 0;
  const emailIndexes = new Set<number>();

  if (hasHeader) {
    headerRow.forEach((cell, index) => {
      if (cell.toLowerCase().includes("email")) {
        emailIndexes.add(index);
      }
    });
  }

  for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex].map((cell) => String(cell ?? "").trim());
    const metadata = hasHeader
      ? buildRowMetadata(headerRow, row, emailIndexes)
      : {
          rowIndex: rowIndex + 1,
          rawRow: row
        };

    const emails = extractEmailsFromRow(row, emailIndexes);

    if (emails.length === 0) {
      records.push({
        email: null,
        metadata
      });
      continue;
    }

    emails.forEach((email) => {
      records.push({
        email,
        metadata
      });
    });
  }

  const rawCount = Math.max(rows.length - (hasHeader ? 1 : 0), 0);
  return { rawCount, records };
};

const parseJsonValue = (value: unknown): ParsedRecord[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseJsonValue(entry));
  }

  if (typeof value === "string") {
    return extractEmailsFromText(value).map((email) => ({
      email,
      metadata: {}
    }));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = toMetadataObject(value);
  const nestedRecords = Object.values(record).flatMap((entry) =>
    parseJsonValue(entry)
  );
  const directEmail = pickEmailFromRecord(record);
  const records: ParsedRecord[] = [...nestedRecords];

  if (directEmail) {
    records.unshift({
      email: directEmail,
      metadata: record
    });
  }

  return records;
};

const parseJsonContent = (content: string): ParsedPayload => {
  try {
    const parsed = JSON.parse(content);
    const records = parseJsonValue(parsed);
    return { rawCount: records.length, records };
  } catch {
    return parseTextContent(content);
  }
};

const parseTextContent = (content: string): ParsedPayload => {
  const emails = extractEmailsFromText(content);
  return {
    rawCount: emails.length,
    records: emails.map((email) => ({
      email,
      metadata: {}
    }))
  };
};

export const parseInputContent = (
  format: string,
  content: string
): ParsedPayload => {
  switch (format) {
    case "csv":
      return parseCsvContent(content);
    case "json":
      return parseJsonContent(content);
    case "txt":
    case "raw":
    case "bulk":
    default:
      return parseTextContent(content);
  }
};
