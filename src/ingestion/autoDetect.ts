import AdmZip from "adm-zip";
import { extname } from "path";
import { InputFormat } from "./types.js";

export type AutoDetectedFormat = Exclude<InputFormat, "auto">;

export interface ResolvedIngestionChunk {
  format: AutoDetectedFormat;
  content: string;
  sourceName: string;
}

const ZIP_ENTRY_MAGIC = 0x50;

const isZipBuffer = (buffer: Buffer): boolean => {
  return buffer.length >= 4 && buffer[0] === ZIP_ENTRY_MAGIC && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
};

const looksLikeCsv = (content: string): boolean => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (lines.length < 2) {
    return false;
  }

  const separators = [",", "\t", ";", "|"];
  return separators.some((separator) => {
    const counts = lines.map((line) => line.split(separator).length);
    return counts.every((count) => count > 1) && counts.some((count) => count > 2 || count === 2);
  });
};

const detectTextFormat = (content: string, sourceName?: string): AutoDetectedFormat => {
  const extension = extname(sourceName ?? "").toLowerCase();

  if (extension === ".json") {
    return "json";
  }

  if (extension === ".csv") {
    return "csv";
  }

  if ([".txt", ".raw", ".log", ".list", ".lst"].includes(extension)) {
    return "txt";
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return "txt";
  }

  if ((trimmed.startsWith("{") || trimmed.startsWith("["))) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // fall through
    }
  }

  if (looksLikeCsv(content)) {
    return "csv";
  }

  return "txt";
};

const extractZipChunks = (buffer: Buffer, sourceName: string): ResolvedIngestionChunk[] => {
  const zip = new AdmZip(buffer);
  const chunks: ResolvedIngestionChunk[] = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    const entryName = entry.entryName || sourceName;
    const entryBuffer = entry.getData();

    if (isZipBuffer(entryBuffer) || extname(entryName).toLowerCase() === ".zip") {
      chunks.push(...extractZipChunks(entryBuffer, entryName));
      continue;
    }

    const content = entryBuffer.toString("utf-8");
    chunks.push({
      format: detectTextFormat(content, entryName),
      content,
      sourceName: entryName
    });
  }

  return chunks;
};

export const resolveIngestionChunks = (buffer: Buffer, sourceName?: string): ResolvedIngestionChunk[] => {
  const name = sourceName ?? "inline";
  if (isZipBuffer(buffer) || extname(name).toLowerCase() === ".zip") {
    return extractZipChunks(buffer, name);
  }

  const content = buffer.toString("utf-8");
  return [
    {
      format: detectTextFormat(content, name),
      content,
      sourceName: name
    }
  ];
};

export const detectFormatFromContent = detectTextFormat;