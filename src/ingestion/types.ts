export type InputFormat = "auto" | "csv" | "json" | "txt" | "raw" | "bulk";

export interface IngestionInput {
  format: InputFormat;
  content: string;
  sourcePath?: string;
}

export interface ParsedRecord {
  email: string | null;
  metadata: Record<string, unknown>;
}

export interface ParsedPayload {
  rawCount: number;
  records: ParsedRecord[];
}

export interface IngestionRecord {
  email: string;
  metadata: Record<string, unknown>;
}

export interface IngestionCounts {
  raw: number;
  valid: number;
  duplicate: number;
  error: number;
}

export interface IngestionResult {
  records: IngestionRecord[];
  counts: IngestionCounts;
  invalidSamples: string[];
}
