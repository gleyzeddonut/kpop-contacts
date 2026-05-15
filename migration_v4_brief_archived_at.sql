-- migration_v4_brief_archived_at.sql
-- Adds archived_at to track when a brief was archived.
-- NULL = active. Set to a timestamp when archived. Briefs are deleted 2 months after this timestamp.
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
