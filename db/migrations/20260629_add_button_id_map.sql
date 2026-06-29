-- Create persistent mapping for short custom IDs used in Discord buttons
CREATE TABLE IF NOT EXISTS button_id_map (
  token text PRIMARY KEY,
  raw_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL
);

-- Optional index to help cleanup by expires_at
CREATE INDEX IF NOT EXISTS idx_button_id_map_expires_at ON button_id_map (expires_at);
