# Briefs Feature Design

**Date:** 2026-05-14  
**Status:** Approved

---

## Overview

Add a "briefs" system to K:CONTACTS. A brief is a structured pitch request issued by a label — typically delivered as a PDF. Each brief covers one or more artists and specifies what kind of song to write, with deadlines, vibes, and YouTube reference tracks.

The user drags a PDF into the app. The app parses it via Claude API, auto-matches or auto-creates artist entries, links the brief's submission contacts to existing contact records, and displays all brief data in a new "Briefs" tab on the artist workspace.

---

## Data Model

### New Supabase table: `briefs`

```sql
CREATE TABLE briefs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id             uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  artist_id           uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  source_pdf          text,               -- original filename, e.g. "2026.05 SM LEAD.pdf"
  label               text,               -- e.g. "SM Entertainment"
  deadline            text,               -- stored as-is: "ASAP", "2026-05-08", "early June"
  general_direction   text,
  track_types         jsonb DEFAULT '[]', -- array of track type objects (see below)
  submission_emails   text[] DEFAULT '{}',-- emails from PDF cover page
  matched_contact_ids uuid[] DEFAULT '{}',-- contacts whose emails matched submission_emails
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;
-- RLS: same owner policy as artists table
```

### `track_types` JSONB element shape

```json
{
  "name": "Track Type A",
  "tags": ["#GenZ_Energy", "#Witty_Crash"],
  "wants": ["High-energy upbeat dance track...", "Bright energetic production..."],
  "avoids": ["Overly high vocal range", "Minor mood in track"],
  "references": [
    { "title": "T-ARA - Bo Peep Bo Peep", "url": "https://youtu.be/t8_I3o5KWfA" },
    { "title": "Aqua - Barbie Girl",       "url": "https://youtu.be/ZyhrYis509A" }
  ]
}
```

`wants` and `avoids` may both be empty arrays. `tags` are hashtags extracted from the track type heading (e.g., `#Nostalgic_Velocity`). `references` may be empty if the PDF says "no specific references."

---

## PDF Import Flow

1. **Trigger** — user clicks "Import Brief PDF" button in the workspace artist header, or drags a PDF file onto the workspace. A file picker opens (or drop is accepted). The selected file path is sent via IPC to `main.js`.

2. **main.js reads and encodes** — reads the PDF file from disk as a buffer, base64-encodes it, and sends it to the Claude API (`claude-sonnet-4-6`) with the PDF as a `document` content block and a structured extraction prompt requesting a specific JSON schema.

3. **Claude returns structured JSON:**
   ```json
   {
     "label": "SM Entertainment",
     "submission_emails": ["mindysong@smtown.com", "izzychoi@smtown.com"],
     "artists": [
       {
         "name": "RIIZE",
         "deadline": "ASAP",
         "general_direction": "...",
         "track_types": [ ... ]
       }
     ]
   }
   ```

4. **Artist matching (renderer)** — for each artist in the JSON, attempt case-insensitive fuzzy match against `artists[]` in current state (strip parentheticals like "of SHINee", "of EXO" before matching). If matched → use existing artist ID. If not matched → auto-create the artist via the existing artist creation flow (name pre-filled, label inferred from PDF label field).

5. **Contact matching** — compare `submission_emails` against `email` field of all contacts in the current list. Collect matching contact IDs into `matched_contact_ids`. No contact records are modified — the link is stored on the brief only.

6. **Write to Supabase** — insert one row per artist into `briefs`. All artists from the PDF share the same `source_pdf`, `label`, `submission_emails`, and `matched_contact_ids`.

7. **UI update** — workspace tab badge updates to show new brief count. Toast: `"Brief imported: 12 artists · 4 contacts matched"`.

---

## Claude Extraction Prompt

Sent in `main.js` alongside the base64 PDF:

```
Extract all brief information from this PDF and return valid JSON matching this schema exactly:
{
  "label": string,
  "submission_emails": string[],
  "artists": [{
    "name": string,
    "deadline": string | null,
    "general_direction": string | null,
    "track_types": [{
      "name": string,
      "tags": string[],
      "wants": string[],
      "avoids": string[],
      "references": [{ "title": string, "url": string }]
    }]
  }]
}
Rules:
- deadline: extract as-is from the PDF (e.g. "ASAP", "By May 8th", "early June"). Null if not stated.
- general_direction: the [General Direction] block text if present, else null.
- tags: hashtags in the track type heading (e.g. #GenZ_Energy).
- wants/avoids: bullet points under "Please include"/"Please avoid" or the main direction bullets.
- If no references are listed, references = [].
Return only the JSON object. No markdown, no explanation.
```

---

## UI Design

### Workspace tabs

Two tabs appear in the artist workspace below the artist header:

```
[ Contacts ]  [ Briefs  2 ]
```

The active tab underlines in pink (`var(--pink)`). The brief count badge is a small pink pill. No badge shown when count is 0.

### Briefs tab layout (per brief, stacked if multiple)

```
┌─────────────────────────────────────────────────────┐
│ SM LEAD · May 2026          [ASAP]                  │
│ mindysong · izzychoi · mintstar · hajin             │
├─────────────────────────────────────────────────────┤
│ GENERAL DIRECTION                                   │
│ A track that strongly showcases performance...      │
├─────────────────────────────────────────────────────┤
│ TRACK TYPES                                         │
│ ┌─────────────────────────────────────────────┐    │
│ │ Track Type A — Groove / Bass-driven          │    │
│ │ · Weighty groove-driven beat...              │    │
│ │ [▶ TVXQ! - MIROTIC] [▶ EXO - Tempo]        │    │
│ └─────────────────────────────────────────────┘    │
│ ┌─────────────────────────────────────────────┐    │
│ │ Track Type B — Hybrid Pop                    │    │
│ │ · Hybrid pop blending genre elements...      │    │
│ │ [▶ bbno$ - 1-800] [▶ Bieber - Confident]   │    │
│ └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
✓ 4 contacts matched (mindysong, izzychoi, mintstar, hajin)
```

- **Deadline badge**: no deadline = no badge; ASAP = yellow; parsed date that has passed = red; future = green
- **Reference pills**: clickable, open YouTube URL in the system browser via `shell.openExternal()`
- **Matched contacts banner**: green, appears once per brief below all track types
- **Multiple briefs**: stacked vertically within the tab, newest first

### Import button placement

"Import Brief PDF" button appears in the artist header row, right-aligned, styled as a secondary button (same as existing secondary actions). It is always visible on the Contacts tab too — import is not tab-gated.

**Important:** clicking this button imports the entire PDF — all artists in it, not just the currently selected artist. The current artist's workspace is a convenient place to trigger import, but the action is list-wide. A confirmation toast makes this clear: "Brief imported: 12 artists · 4 contacts matched."

---

## Error Handling

- **Claude API failure**: show error toast "Brief import failed — Claude API error". No partial writes.
- **Invalid JSON from Claude**: retry once with a stricter prompt; if still invalid, show error toast.
- **No artists found in PDF**: toast "No artist briefs found in this PDF."
- **Artist auto-create fails**: skip that artist, continue with rest, include in error summary toast.
- **File too large** (>10MB): reject before sending to Claude, show "PDF too large to import."

---

## Database Migration

New file: `migration_v3_briefs.sql`

Run after `migration_v2_status_notes.sql` (both are still pending as of 2026-05-14).

RLS policy mirrors the `artists` table: owner of the list can read/write; editors can write; viewers can read.

---

## Out of Scope

- Editing brief content after import (briefs are read-only; re-import a new PDF to update)
- "All briefs" view across all artists (future feature)
- Brief status tracking / marking as "pitched" (future feature)
- CSV export of briefs (future feature)
