-- Adds extra_emails column for storing additional email addresses per contact
-- NOTE: Already applied to production Supabase on 2026-05-15
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS extra_emails jsonb NOT NULL DEFAULT '[]';
