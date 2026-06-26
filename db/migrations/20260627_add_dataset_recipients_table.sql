-- Add a per-dataset recipient table so duplicate detection is scoped to each ingest.

CREATE TABLE IF NOT EXISTS dataset_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  email_domain text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dataset_recipients_dataset_email_uq
  ON dataset_recipients(dataset_id, email_normalized);
