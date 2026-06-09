import { normalizeEmail } from "./emailNormalizer.js";
import { isValidEmail } from "./emailValidator.js";
import { parseInputContent } from "./parsers.js";
import { DedupStore } from "./dedupStore.js";
import { IngestionInput, IngestionRecord, IngestionResult } from "./types.js";

const MAX_INVALID_SAMPLES = 25;

export const runIngestion = async (
  input: IngestionInput,
  dedupStore: DedupStore,
  options?: { datasetId?: string | null }
): Promise<IngestionResult> => {
  const parsed = parseInputContent(input.format, input.content);
  const records: IngestionRecord[] = [];
  const invalidSamples: string[] = [];

  let validCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;

  for (const record of parsed.records) {
    if (!record.email) {
      errorCount += 1;
      if (invalidSamples.length < MAX_INVALID_SAMPLES) {
        invalidSamples.push("missing-email");
      }
      continue;
    }

    const normalized = normalizeEmail(record.email);
    if (!isValidEmail(normalized)) {
      errorCount += 1;
      if (invalidSamples.length < MAX_INVALID_SAMPLES) {
        invalidSamples.push(normalized);
      }
      continue;
    }

    const isNew = await dedupStore.checkAndInsert(normalized, options?.datasetId ?? null);
    if (!isNew) {
      duplicateCount += 1;
      continue;
    }

    records.push({
      email: normalized,
      metadata: record.metadata
    });
    validCount += 1;
  }

  return {
    records,
    counts: {
      raw: parsed.rawCount,
      valid: validCount,
      duplicate: duplicateCount,
      error: errorCount
    },
    invalidSamples
  };
};
