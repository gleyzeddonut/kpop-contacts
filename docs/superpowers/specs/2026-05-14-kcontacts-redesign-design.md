# K:CONTACTS Redesign — Design Spec
**Date:** 2026-05-14
**Status:** Approved

---

## Overview

Redesign the K:CONTACTS Electron app UI around an artist-first lookup workflow. The user is a songwriter who needs to quickly find and act on contacts for a specific K-pop artist group. The new design prioritizes contact density, outreach status tracking, and inline editing — eliminating the Labels view and full-screen modals entirely.

**Core workflow:** Open app → find artist (search / browse / label filter) → see all contacts in a compact table → double-click contact to open notes panel → read history, update status, take action.

---

## Layout

3-column CSS grid, always visible:

```
┌─────────────┬──────────────────┬──────────────────────────────────────┐
│  Sidebar    │  Artist List     │  Workspace                           │
│  148px      │  185px           │  1fr                                 │
└─────────────┴──────────────────┴──────────────────────────────────────┘
```

The workspace itself can split internally when the notes panel is open:

```
Workspace (1fr)
├── Contact table (flex: 1)
└── Notes panel (240px, shown only when a contact is double-clicked)
```

**Removed:** The Labels view toggle and its associated 2-panel grid layout (`.app.view-labels`, `selectedLabelName`, `listView` state) are dropped entirely.

---

## Sidebar

- Label list: "All Artists" + one item per unique label in the current list
- Each item shows label name + artist count
- Clicking a label filters the artist list to that label only
- "All Artists" is always first and selected by default
- No changes to existing list-switching (dashboard/list selector stays as-is)

---

## Artist List

**Each row:**
- Avatar: 22px circle with first letter of artist name, gradient background (derived from name, consistent per artist)
- Artist name (bold, 11px)
- Label name (muted, 8px, truncated)
- Status dot (6px circle, right edge): color = highest-priority contact status for this artist
  - Orange (#FF9500) = at least one contact "In Convo"
  - Green (#30D158) = at least one contact "Reached Out" (and none In Convo)
  - Blue (#6a8aff) = at least one contact "Cold" (none warmer)
  - Dim (#444) = no contacts yet

**Interactions:**
- Click row → select artist, load workspace
- Arrow keys (↑↓) navigate the list
- Filter input at top of list panel — filters artist names in real time (replaces the header search for this context; global ⌘K search still works across everything)

---

## Workspace

### Artist Header

```
BTS                    HYBE / Big Hit Music          4 contacts
[All 4] [Cold 2] [Reached 1] [In Convo 1]
```

- Artist name: 17–18px, font-weight 800
- Label name: 11px, accent color (#FF2D78)
- Contact count: 9px, muted
- Status filter pills below: clicking a pill filters the contact table to that status. "All" is default.

### Contact Table

Column layout:
```
# | Name | Role | Email | Status | (actions on hover)
```

- `#`: row number, 9px monospace, muted
- `Name`: 11px, font-weight 600
- `Role`: 10px, muted
- `Email`: 10px, accent color — clicking copies to clipboard
- `Status`: colored badge (see Status System below)
- **Hover actions** (appear on row hover, hidden otherwise): Email icon (opens mailto), Edit icon (opens notes panel)

Row interactions:
- Single click: selects the row (highlights it, no other effect)
- Double-click: toggles the notes panel open/closed for that contact
- Double-clicking a different row while panel is open: switches panel to new contact
- Selecting a different artist from the artist list while the panel is open: closes the panel

Hover action behavior:
- Email icon: opens `mailto:` (same as the Email button in the notes panel)
- Edit icon: opens the notes panel for that contact (same as double-click); if the panel is already open for a different contact, switches to this one

"+ Add contact" sits as the last row — clicking it opens a blank notes panel in create mode.

### Status Filter Pills

Clicking a pill filters the visible rows. Active pill has a filled background. Only pills with at least one contact in that status are shown (no empty pills).

---

## Notes Panel

Opens on double-click of a contact row. Closes on double-click of the same row, or clicking a close (×) button in the panel header. Width: 240px, pinned to the right edge of the workspace, separated by a 1px border.

**Panel sections (top to bottom):**

### 1. Identity (always editable inline)
- Name field (13px bold) — click to edit
- Role field (10px muted) — click to edit
- Email field — click to edit
- Phone field — click to edit
- Social field (Instagram / Twitter handle) — click to edit

All fields save on blur (click away) or Enter key.

### 2. Status
- Row of 4 colored dots: Cold (blue) · Reached Out (green) · In Convo (orange) · Placed (purple)
- Active dot is full opacity; others are 30% opacity
- Click any dot to set that status
- Current status label shown in text next to dots

### 3. Quick Actions
Three buttons in a row:
- **Email** — opens `mailto:` with the contact's email
- **Copy** — copies email to clipboard, shows brief "Copied" confirmation
- **DM** — opens the contact's social link (Instagram/Twitter) in the default browser; grayed out if no social set

### 4. Notes Log
- Reverse-chronological list of timestamped note entries
- Each entry: date (YYYY-MM-DD, monospace, muted) + note text (10px, 1.5 line-height)
- Notes are append-only — no editing or deleting individual entries
- **+ Add note** button at bottom: shows a small textarea inline, saves on Enter or clicking away (if non-empty)

---

## Status System

Four statuses, in order:

| Status | Color | Badge bg | Meaning |
|--------|-------|----------|---------|
| Cold | #6a8aff | #0d1230 | Not yet contacted |
| Reached Out | #30D158 | #0d2018 | Sent intro/email, no reply yet |
| In Convo | #FF9500 | #2a1a0a | Active conversation / listening |
| Placed | #BF5AF2 | #1a0d20 | Song placed or deal done |

Stored as a `status` string field on the contact record: `"cold" | "reached_out" | "in_convo" | "placed"`.

Default status for new contacts: `"cold"`.

---

## Data Model Changes

### contacts table (Supabase)
Add one column:
```sql
ALTER TABLE contacts ADD COLUMN status text NOT NULL DEFAULT 'cold'
  CHECK (status IN ('cold', 'reached_out', 'in_convo', 'placed'));
```

Add one column for the notes log (replaces the existing freeform `notes` text field):
```sql
ALTER TABLE contacts ADD COLUMN notes_log jsonb NOT NULL DEFAULT '[]';
-- Format: [{ "date": "2026-05-14", "text": "Emailed re: comeback track" }, ...]
```

The existing `notes` column can be migrated: if `notes` is non-empty, create a single notes_log entry with the current date and the existing text. Then the `notes` column can be dropped or left (ignored).

### JS state
- `contacts[]` array already exists — add `status` and `notes_log` fields to the object shape
- Remove `listView` state variable (Labels view gone)
- Remove `selectedLabelName` state variable

---

## Removed

- Labels view: all CSS, JS, and HTML for `.view-labels`, `buildLabelMap()`, label navigator panel, label panel header with "Add" button
- Contact edit modal: `showContactModal()` function and its HTML — replaced by inline editing in the notes panel
- `listView` toggle button in the header

---

## Navigation

| Method | Behavior |
|--------|----------|
| Sidebar label click | Filters artist list |
| Artist list filter input | Real-time filter on artist names |
| ↑↓ arrow keys | Navigate artist list rows |
| ⌘K | Global search: artists + contacts (existing behavior, keep) |
| Status filter pills | Filter contact table for selected artist |
| Click email in table | Copy to clipboard |
| Double-click contact row | Open/close notes panel |

---

## Visual / Aesthetic

No changes to the color system or typography. Same dark theme (`--bg: #111113`, `--accent: #FF2D78`, Montserrat + Space Mono). Changes are structural and density-focused.

---

## Out of Scope

- CSV export (separate feature, noted in HANDOFF.md)
- Auto-fill / Scan Web behavior (unchanged)
- Auth, lists, sharing (unchanged)
- Dashboard overlay (unchanged)
