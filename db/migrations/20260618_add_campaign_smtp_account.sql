-- Add nullable smtp_account_id to campaigns for per-campaign SMTP mapping
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS smtp_account_id uuid REFERENCES smtp_accounts(id) ON DELETE SET NULL;
