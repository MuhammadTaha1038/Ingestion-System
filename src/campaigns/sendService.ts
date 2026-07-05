import { randomUUID } from "crypto";
import { Pool } from "pg";
import { getDatabasePool } from "../db/pool.js";
import { JobRepository } from "../db/repositories/jobs.js";
import { sendingQueue } from "../queue/queues.js";
import { jobStore } from "../jobs/store.js";

export interface CampaignSendDefinition {
  id: string;
  name: string;
  status: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  reply_to: string | null;
  smtp_account_id?: string | null;
  smtp_account_email?: string | null;
}

const getPool = (pool?: Pool): Pool => pool ?? getDatabasePool();

export const selectAutoCampaign = async (pool?: Pool): Promise<CampaignSendDefinition | null> => {
  const database = getPool(pool);
  const res = await database.query(
    `SELECT c.id, c.subject, c.body_html, c.body_text, c.reply_to, c.smtp_account_id,
            ea.address AS smtp_account_email
     FROM campaigns c
     LEFT JOIN smtp_accounts sa ON c.smtp_account_id = sa.id
     LEFT JOIN email_accounts ea ON sa.email_account_id = ea.id
     WHERE c.status = 'active'
     ORDER BY c.created_at DESC
     LIMIT 1`
  );

  return (res.rows[0] as CampaignSendDefinition | undefined) ?? null;
};

export const selectCampaignById = async (campaignId: string, pool?: Pool): Promise<CampaignSendDefinition | null> => {
  const database = getPool(pool);
  const res = await database.query(
    `SELECT c.id, c.name, c.status, c.subject, c.body_html, c.body_text, c.reply_to, c.smtp_account_id,
            ea.address AS smtp_account_email
     FROM campaigns c
     LEFT JOIN smtp_accounts sa ON c.smtp_account_id = sa.id
     LEFT JOIN email_accounts ea ON sa.email_account_id = ea.id
     WHERE c.id = $1 AND c.status IN ('active','draft') LIMIT 1`,
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
    `SELECT dr.email_normalized FROM dataset_recipients dr
     LEFT JOIN unsubscribes u ON dr.email_normalized = u.email_normalized
     WHERE dr.dataset_id = $1 AND u.email_normalized IS NULL
     ORDER BY dr.email_normalized ASC`,
    [args.datasetId]
  );

  const emails = res.rows.map((row: { email_normalized: string }) => row.email_normalized);
  const batchSize = 50;
  const jobRepo = new JobRepository(database);

  for (let i = 0; i < emails.length; i += batchSize) {
    const sendJobId = randomUUID();
    const batch = emails.slice(i, i + batchSize).map((email: string) => {
      const baseUrl = process.env.PUBLIC_URL || "http://86.48.0.69:3000";
      const unsubscribeUrl = `${baseUrl}/unsubscribe?email=${encodeURIComponent(email)}`;
      const footerHtml = `<br><br><hr><div style="font-size:12px;color:#666;text-align:center;">
        <p>This email was sent to ${email}. If you no longer wish to receive these emails, you may <a href="${unsubscribeUrl}">unsubscribe here</a>.</p>
        <p>Sender Address: 123 Business Rd, Suite 100, City, Country</p>
      </div>`;
      
      return {
        to: email,
        subject: args.campaign.subject,
        html: args.campaign.body_html + footerHtml,
        text: args.campaign.body_text ? args.campaign.body_text + `\n\nUnsubscribe: ${unsubscribeUrl}` : undefined
      };
    });

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
        replyTo: args.campaign.reply_to ?? undefined,
        recipients: batch,
        smtpAccountId: (args.campaign as any).smtp_account_id ?? undefined
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

export const sendSingleRecipientWithCampaign = async (args: {
  campaignId: string;
  recipientEmail: string;
  pool?: Pool;
}): Promise<{ queued: number; campaignId: string; recipients: number } | null> => {
  const campaign = await selectCampaignById(args.campaignId, args.pool);
  if (!campaign) {
    return null;
  }

  const sendJobId = randomUUID();
  const jobRepo = new JobRepository(getPool(args.pool));
  await jobRepo.createJob({
    id: sendJobId,
    type: "sending",
    status: "pending",
    datasetId: null,
    campaignId: campaign.id
  });

  jobStore.createJob("sending", {
    campaignId: campaign.id,
    recipients: 1
  }, sendJobId);

      const baseUrl = process.env.PUBLIC_URL || "http://86.48.0.69:3000";
      const unsubscribeUrl = `${baseUrl}/unsubscribe?email=${encodeURIComponent(args.recipientEmail)}`;
      const footerHtml = `<br><br><hr><div style="font-size:12px;color:#666;text-align:center;">
        <p>This email was sent to ${args.recipientEmail}. If you no longer wish to receive these emails, you may <a href="${unsubscribeUrl}">unsubscribe here</a>.</p>
        <p>Sender Address: 123 Business Rd, Suite 100, City, Country</p>
      </div>`;

  await sendingQueue.add(
    "send",
    {
      campaignId: campaign.id,
      windowId: "",
      replyTo: campaign.reply_to ?? undefined,
      recipients: [
        {
          to: args.recipientEmail,
          subject: campaign.subject,
          html: campaign.body_html + footerHtml,
          text: campaign.body_text ? campaign.body_text + `\n\nUnsubscribe: ${unsubscribeUrl}` : undefined
        }
      ],
      smtpAccountId: campaign.smtp_account_id ?? undefined
    },
    { jobId: sendJobId, removeOnComplete: true }
  );

  return {
    queued: 1,
    campaignId: campaign.id,
    recipients: 1
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