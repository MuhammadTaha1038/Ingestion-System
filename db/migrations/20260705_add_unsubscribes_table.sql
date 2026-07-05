CREATE TABLE IF NOT EXISTS unsubscribes (
  email_normalized text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
