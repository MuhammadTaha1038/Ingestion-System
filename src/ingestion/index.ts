export { runIngestion } from "./pipeline.js";
export { InMemoryDedupStore } from "./dedupStore.js";
export { PostgresDedupStore } from "./postgresDedupStore.js";
export type { DedupStore } from "./dedupStore.js";
export { startIngestionWorker } from "./worker.js";
export type {
  IngestionInput,
  IngestionResult,
  IngestionRecord,
  IngestionCounts,
  ParsedRecord,
  ParsedPayload
} from "./types.js";
