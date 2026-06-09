export interface DedupStore {
  checkAndInsert: (emailNormalized: string, datasetId?: string | null) => Promise<boolean>;
}

export class InMemoryDedupStore implements DedupStore {
  private readonly seen = new Set<string>();

  async checkAndInsert(emailNormalized: string, datasetId?: string | null): Promise<boolean> {
    if (this.seen.has(emailNormalized)) {
      return false;
    }

    this.seen.add(emailNormalized);
    return true;
  }
}
