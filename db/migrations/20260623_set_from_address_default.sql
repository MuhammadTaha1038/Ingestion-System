-- Set from_address to have a default value since it's no longer user-configurable
ALTER TABLE campaigns 
  ALTER COLUMN from_address SET DEFAULT 'noreply@example.com';
