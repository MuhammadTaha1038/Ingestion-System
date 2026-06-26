export interface DedupStore {
  checkAndInsert: (emailNormalized: string, datasetId?: string | null) => Promise<boolean>;
}

export class InMemoryDedupStore implements DedupStore {
  private readonly seen = new Map<string, Set<string>>();

  async checkAndInsert(emailNormalized: string, datasetId?: string | null): Promise<boolean> {
    const key = datasetId ?? "__global__";
    let seenForDataset = this.seen.get(key);
    if (!seenForDataset) {
      seenForDataset = new Set<string>();
      this.seen.set(key, seenForDataset);
    }

    if (seenForDataset.has(emailNormalized)) {
      return false;
    }

    seenForDataset.add(emailNormalized);
    return true;
  }
}
