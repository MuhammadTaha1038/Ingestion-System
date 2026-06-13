import { randomUUID } from "crypto";
import { Pool } from "pg";
import { getDatabasePool } from "../db/pool.js";
import { JobRepository } from "../db/repositories/jobs.js";
import { sendingQueue } from "../queue/queues.js";
import { jobStore } from "../jobs/store.js";

export interface CampaignSendDefinition {
  id: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  from_address: string;
  reply_to: string | null;
}

const getPool = (pool?: Pool): Pool => pool ?? getDatabasePool();

export const selectAutoCampaign = async (pool?: Pool): Promise<CampaignSendDefinition | null> => {
  const database = getPool(pool);
  const res = await database.query(
    `SELECT id, subject, body_html, body_text, from_address, reply_to
     FROM campaigns
     WHERE status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`
  );

  return (res.rows[0] as CampaignSendDefinition | undefined) ?? null;
};

export const selectCampaignById = async (campaignId: string, pool?: Pool): Promise<CampaignSendDefinition | null> => {
  const database = getPool(pool);
  const res = await database.query(
    `SELECT id, subject, body_html, body_text, from_address, reply_to
     FROM campaigns
     WHERE id = $1 AND status IN ('active','draft') LIMIT 1`,
    [campaignId]
  );

  return (res.rows[0] as CampaignSendDefinition | undefined) ?? null;
};

export const enqueueCampaignSendForDataset = async (args: {
  datasetId: string;
  campaign: CampaignSendDefinition;
  pool?: Pool;
}): Promise<{ queued: number; campaignId: string; recipients: number }> => {
  const database = getPool(args.pool);
  const res = await database.query(
    `SELECT r.email_normalized FROM recipients r WHERE r.first_dataset_id = $1 ORDER BY r.email_normalized ASC`,
    [args.datasetId]
  );

  const emails = res.rows.map((row: { email_normalized: string }) => row.email_normalized);
  const batchSize = 50;
  const jobRepo = new JobRepository(database);

  for (let i = 0; i < emails.length; i += batchSize) {
    const sendJobId = randomUUID();
    const batch = emails.slice(i, i + batchSize).map((email: string) => ({
      to: email,
      subject: args.campaign.subject,
      html: args.campaign.body_html,
      text: args.campaign.body_text ?? undefined
    }));

    await jobRepo.createJob({
      id: sendJobId,
      type: "sending",
      status: "pending",
      campaignId: args.campaign.id,
      datasetId: args.datasetId
    });

    jobStore.createJob("sending", {
      campaignId: args.campaign.id,
      datasetId: args.datasetId,
      recipients: batch.length
    }, sendJobId);

    await sendingQueue.add(
      "send",
      {
        campaignId: args.campaign.id,
        windowId: "",
        fromAddress: args.campaign.from_address,
        replyTo: args.campaign.reply_to ?? undefined,
        recipients: batch
      },
      { jobId: sendJobId, removeOnComplete: true }
    );
  }

  return {
    queued: Math.ceil(emails.length / batchSize),
    campaignId: args.campaign.id,
    recipients: emails.length
  };
};

export const sendDatasetWithCampaign = async (args: {
  datasetId: string;
  campaignId: string;
  pool?: Pool;
}): Promise<{ queued: number; campaignId: string; recipients: number } | null> => {
  const campaign = await selectCampaignById(args.campaignId, args.pool);
  if (!campaign) {
    return null;
  }

  return await enqueueCampaignSendForDataset({ datasetId: args.datasetId, campaign, pool: args.pool });
};

export const autoSendDatasetIfPossible = async (datasetId: string, pool?: Pool, campaignId?: string): Promise<{ queued: number; campaignId: string; recipients: number } | null> => {
  if (campaignId) {
    return await sendDatasetWithCampaign({ datasetId, campaignId, pool });
  }

  const campaign = await selectAutoCampaign(pool);
  if (!campaign) {
    return null;
  }

  return await enqueueCampaignSendForDataset({ datasetId, campaign, pool });
};

export const autoSendLatestCompletedDataset = async (pool?: Pool): Promise<{ queued: number; campaignId: string; datasetId: string; recipients: number } | null> => {
  const database = getPool(pool);
  const datasetRes = await database.query(
    `SELECT id FROM datasets WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1`
  );

  const datasetId = datasetRes.rows[0] ? String(datasetRes.rows[0].id) : null;
  if (!datasetId) {
    return null;
  }

  const result = await autoSendDatasetIfPossible(datasetId, database);
  if (!result) {
    return null;
  }

  return { ...result, datasetId };
};