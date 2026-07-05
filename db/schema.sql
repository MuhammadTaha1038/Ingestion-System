CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_path text NOT NULL,
  source_name text,
  status text NOT NULL DEFAULT 'pending',
  raw_count integer NOT NULL DEFAULT 0,
  valid_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  processed_path text,
  report_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  reply_to text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL UNIQUE,
  email_domain text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_dataset_id uuid REFERENCES datasets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dataset_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  email_domain text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX dataset_recipients_dataset_email_uq ON dataset_recipients(dataset_id, email_normalized);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  dataset_id uuid REFERENCES datasets(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  total_count integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE TABLE cpanel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subdomains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cpanel_account_id uuid NOT NULL REFERENCES cpanel_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subdomain_id uuid NOT NULL REFERENCES subdomains(id) ON DELETE CASCADE,
  address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE smtp_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  host text NOT NULL,
  port integer NOT NULL,
  username text NOT NULL,
  password_encrypted text NOT NULL,
  use_tls boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  max_per_window integer NOT NULL DEFAULT 50,
  max_concurrent integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sending_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sending_windows_start_uq
  ON sending_windows (window_start);

CREATE TABLE smtp_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  smtp_account_id uuid NOT NULL REFERENCES smtp_accounts(id) ON DELETE CASCADE,
  window_id uuid NOT NULL REFERENCES sending_windows(id) ON DELETE CASCADE,
  used_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX smtp_usage_account_window_uq
  ON smtp_usage (smtp_account_id, window_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER datasets_set_updated_at
BEFORE UPDATE ON datasets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER campaigns_set_updated_at
BEFORE UPDATE ON campaigns
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Track consecutive failures for SMTP accounts so we can auto-disable unhealthy accounts
CREATE TABLE smtp_failures (
  smtp_account_id uuid PRIMARY KEY REFERENCES smtp_accounts(id) ON DELETE CASCADE,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_failure_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unsubscribes (
  email_normalized text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
