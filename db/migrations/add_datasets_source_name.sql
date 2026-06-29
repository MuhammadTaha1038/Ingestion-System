-- Migration: add source_name column to datasets table
-- Run this against an existing database that was created before this column was added.
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS source_name text;
