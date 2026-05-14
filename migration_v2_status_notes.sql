-- migration_v2_status_notes.sql
-- Run in Supabase SQL Editor

-- 1. Add status column
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'cold'
  CHECK (status IN ('cold', 'reached_out', 'in_convo', 'placed'));

-- 2. Add notes_log column (replaces freeform notes string)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS notes_log jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. Migrate existing notes text → first notes_log entry (skip if already blank)
UPDATE contacts
SET notes_log = jsonb_build_array(
  jsonb_build_object(
    'date', to_char(NOW(), 'YYYY-MM-DD'),
    'text', notes
  )
)
WHERE notes IS NOT NULL AND notes <> '' AND notes_log = '[]'::jsonb;
