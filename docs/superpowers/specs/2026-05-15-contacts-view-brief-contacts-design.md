# Contacts View & Brief Contact Auto-Creation Design

**Goal:** (1) Let users browse and edit all contacts globally without going through an artist. (2) Auto-create contacts from brief PDFs when a named person is listed as "who to contact."

**Architecture:** New `contactsViewActive` boolean state switches the middle column to a flat contact list; existing `renderNotesPanel` reused for editing with a new read-only-by-default mode toggled by a global `contactEditMode` flag. Brief parsing gains a top-level `contacts[]` field; `_processParsedBrief` runs email+name deduplication before creating records. One DB migration adds `extra_emails jsonb`.

**Tech Stack:** Vanilla JS in `index.html`, Supabase (`contacts` table), one SQL migration, `main.js` prompt update.

---

## 1. Global Contacts View

### Entry point

A small person-icon button at the bottom of the sidebar, below all label items:

```html
<div class="sidebar-footer-btn" data-action="toggle-contacts-view">
  <svg><!-- person icon --></svg>
  All Contacts
</div>
```

Styled with purple tint when active (same style as brief filter toggle). State: `let contactsViewActive = false`. Resets to `false` in `loadListArtists()` alongside `briefFilterActive`.

### Middle column in contacts mode

`renderList()` checks `contactsViewActive`. When true, renders a contacts list instead of artist rows:

- Column header: "Contacts" (purple) + count scoped to current filter
- A search input row below the header (not the header search bar — see Search below)
- Rows: initials avatar, name (10px), role as subtitle (9px monospace), status dot on right
- Active row uses same `.active` highlight as artist rows

The existing label filter in the sidebar narrows contacts to those whose `label` field matches `activeLabel` (same normalization as artist label matching).

### Search integration

`⌘F` still focuses the existing header search bar. When `contactsViewActive` is true, `getFiltered()` is replaced by a new `getFilteredContacts()` function that filters `contacts[]` by `searchQuery` across `name`, `role`, `email`, all entries in `extra_emails`, and `label`. The search input visible in the column header is the same `#search` element (focused by ⌘F) — its value drives `searchQuery` which drives both modes.

### Contact detail panel

When `contactsViewActive` is true and `selectedContactId` is set, `renderDetail()` skips the artist workspace and calls `renderNotesPanel(contact)` directly, filling `#detail-content`.

The panel gains a read-only line at the very top:

```
Artists: aespa, SHINee, NCT Dream
```

Derived from `artists.filter(a => contact.artist_ids.includes(a.id)).map(a => a.name)`. Not editable.

### Read-only / edit mode (applies everywhere)

`renderNotesPanel` gains a new global: `let contactEditMode = false`. Reset to `false` whenever `selectedContactId` changes (in `selectArtist()`, in the contacts-view click handler, and in `toggleNotesPanel()`).

**Read-only state (default):**
- Name, role, email(s), phone, social rendered as plain text `<div class="np-val">` elements
- `✎ Edit` button top-right
- Status dots still clickable to change status
- Email/Copy/DM action buttons still functional

**Edit state (after clicking ✎ Edit):**
- Fields become `<input>` elements with `onblur="saveContactField(...)"` — same as today
- Button becomes `✓ Done`
- Clicking Done sets `contactEditMode = false` and calls `renderNotesPanel` / `renderDetail` to re-render read-only

Click handler additions:
```js
else if (action === 'toggle-contact-edit') { contactEditMode = !contactEditMode; renderDetail(); }
```

---

## 2. Extra Emails

### Schema change

```sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS extra_emails jsonb NOT NULL DEFAULT '[]';
```

### Data model

`contacts[]` entries gain `extra_emails: string[]` (default `[]`). Loaded with `c.extra_emails = Array.isArray(c.extra_emails) ? c.extra_emails : []`.

### UI in contact panel

In read-only mode: primary `email` on its own line, then each `extra_emails[i]` on its own line below it, all styled as `.np-val.email`.

In edit mode: primary `email` input, then one input per `extra_emails[i]`, plus a small `+ Add email` link that appends an empty entry. Removing an extra email: small `×` button next to each extra email input. Saving an extra email input calls a new `saveExtraEmail(contactId, index, value)` helper.

### Deduplication check

When checking if an email is already associated with a contact, scan both `c.email` and `c.extra_emails` (all entries).

---

## 3. Brief → Contact Auto-Creation

### Prompt schema addition

Add to the brief parsing prompt schema at the top level (alongside `label`, `submission_emails`, `artists`):

```json
"contacts": [{ "name": "string or null", "email": "string", "role": "string or null" }]
```

Prompt rule:
```
- contacts: named people listed as submission contacts or "who to contact." Include email. 
  name and role are null if not stated. Omit entries with no email.
```

### Processing logic in `_processParsedBrief`

After building the brief records, loop over `parsed.contacts || []`:

```
for each pc in parsed.contacts:
  if !pc.email → skip

  if !pc.name:
    // Email-only: check primary + extra_emails for duplicate
    exists = contacts.find(c => emailsOf(c).includes(pc.email.toLowerCase()))
    if exists → skip
    else → createContact({ email: pc.email, name: '', role: pc.role || '' })

  else:
    // Name + email: two-step lookup scoped to same label
    byEmail = contacts.find(c => emailsOf(c).includes(pc.email.toLowerCase()))
    if byEmail → skip (already have this email)

    byName = contacts.find(c =>
      c.label === label &&
      c.name.toLowerCase() === pc.name.toLowerCase()
    )
    if byName:
      // Name exists but this email isn't on it — add to extra_emails
      if !emailsOf(byName).includes(pc.email.toLowerCase()):
        byName.extra_emails.push(pc.email)
        await syncContact(byName)
    else:
      → createContact({ name: pc.name, email: pc.email, role: pc.role || '' })
```

`emailsOf(c)` helper: `[c.email, ...c.extra_emails].map(e => e.toLowerCase()).filter(Boolean)`

New contacts created with:
- `artist_ids`: all artist IDs matched/created in this brief import
- `label`: the brief's label
- `status: 'cold'`
- `extra_emails: []`
- `created_at: new Date().toISOString()`

### Toast update

After import: `"Imported N brief${N!==1?'s':''} · M new contact${M!==1?'s':''} added"` (only show contact count if M > 0).

---

## 4. New Globals

```js
let contactsViewActive = false;  // switches middle col to contacts list
let contactEditMode = false;     // notes panel edit vs read-only
```

Both reset in `loadListArtists()`. `contactEditMode` also resets when `selectedContactId` changes.

---

## 5. Files Changed

| File | Change |
|---|---|
| `migration_v5_contacts_extra_emails.sql` | New: adds `extra_emails` column |
| `main.js` | Add `contacts` to brief parsing prompt schema + rules |
| `index.html` | All UI and logic changes (see sections above) |

### index.html changes in detail

- Add `contactsViewActive`, `contactEditMode` globals
- `loadListArtists()`: reset both new globals; default `extra_emails: []` on loaded contacts
- `renderSidebar()`: add sidebar footer "All Contacts" button
- `renderList()`: when `contactsViewActive`, render contact rows instead of artist rows
- `getFilteredContacts()`: new function filtering `contacts[]` by label + search
- `renderDetail()`: when `contactsViewActive` + contact selected, show notes panel directly
- `renderNotesPanel()`: read-only default, ✎ Edit / ✓ Done toggle, extra_emails display, artists line
- `saveExtraEmail(contactId, index, value)`: new helper for extra email fields
- `_processParsedBrief()`: new contact deduplication + creation logic, updated toast
- Click delegation: `toggle-contacts-view`, `toggle-contact-edit`

---

## 6. Out of Scope

- Promoting an `extra_emails` entry to primary email
- Merging duplicate contact records
- Filtering the contacts list by status
- Showing which artists a contact belongs to in the contact list row (only in detail panel)
