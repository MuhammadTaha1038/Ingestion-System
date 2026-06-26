-- Remove the no-longer-used campaign from_address column.

ALTER TABLE campaigns
  DROP COLUMN IF EXISTS from_address;
