import { ingestionQueue, sendingQueue } from "./queues.js";

export interface QueueStatus {
  ingestion: Record<string, number>;
  sending: Record<string, number>;
  paused: {
    ingestion: boolean;
    sending: boolean;
  };
}

const normalizeCounts = (counts: Record<string, number>): Record<string, number> => ({
  waiting: counts.waiting ?? 0,
  active: counts.active ?? 0,
  delayed: counts.delayed ?? 0,
  completed: counts.completed ?? 0,
  failed: counts.failed ?? 0,
  paused: counts.paused ?? 0
});

export const getQueueStatus = async (): Promise<QueueStatus> => {
  const [ingestionCounts, sendingCounts, ingestionPaused, sendingPaused] = await Promise.all([
    ingestionQueue.getJobCounts(),
    sendingQueue.getJobCounts(),
    ingestionQueue.isPaused(),
    sendingQueue.isPaused()
  ]);

  return {
    ingestion: normalizeCounts(ingestionCounts),
    sending: normalizeCounts(sendingCounts),
    paused: {
      ingestion: ingestionPaused,
      sending: sendingPaused
    }
  };
};

export const pauseQueues = async (): Promise<void> => {
  await Promise.all([ingestionQueue.pause(), sendingQueue.pause()]);
};

export const resumeQueues = async (): Promise<void> => {
  await Promise.all([ingestionQueue.resume(), sendingQueue.resume()]);
};
