# Contacts View & Brief Contact Auto-Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global contacts view (sidebar button switches middle column to a flat contact list) and auto-create contacts from brief PDFs when named submission people are found.

**Architecture:** All UI changes live in `index.html` (globals, rendering functions, event delegation, CSS). The brief parsing prompt update is in `main.js`. Two new globals (`contactsViewActive`, `contactEditMode`) control render branching in `renderList()`, `renderSidebar()`, and `renderDetail()`. The existing `renderNotesPanel()` gains a read-only default with an edit toggle. The Supabase `contacts` table has already been migrated with `extra_emails jsonb` — the migration SQL file is committed for record-keeping only.

**Tech Stack:** Vanilla JS, Electron 35, Supabase (contacts table), inline CSS. No build step — edit `index.html` and `main.js` directly.

---

## File Map

| File | What changes |
|---|---|
| `migration_v5_contacts_extra_emails.sql` | NEW — SQL record (already run in Supabase) |
| `index.html` | Globals, loadListArtists, helpers, sidebar, renderList, renderDetail, renderNotesPanel, click delegation, CSS |
| `main.js` | Brief parsing prompt schema + rules |

---

### Task 1: New globals, loadListArtists defaults, migration SQL file

**Files:**
- Create: `migration_v5_contacts_extra_emails.sql`
- Modify: `index.html` (globals block ~line 2254, `loadListArtists` ~line 2298, contacts mapping ~line 2301)

- [ ] **Step 1: Create migration SQL file**

Create `migration_v5_contacts_extra_emails.sql` at the repo root:
```sql
-- Adds extra_emails column for storing additional email addresses per contact
-- NOTE: Already applied to production Supabase on 2026-05-15
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS extra_emails jsonb NOT NULL DEFAULT '[]';
```

- [ ] **Step 2: Add two new globals to index.html**

Find this block (after `let archivedExpanded = false;`, around line 2254):
```js
let archivedExpanded = false;  // archived section expanded in briefs tab
let selectedContactId = null; // contact whose notes panel is open
```

Replace with:
```js
let archivedExpanded = false;  // archived section expanded in briefs tab
let contactsViewActive = false; // switches middle column to contact list
let contactEditMode = false;    // notes panel edit vs read-only
let selectedContactId = null; // contact whose notes panel is open
```

- [ ] **Step 3: Reset new globals in loadListArtists()**

Find this block in `loadListArtists()` (~line 2298):
```js
    briefFilterActive = false;
    archivedExpanded = false;
```

Replace with:
```js
    briefFilterActive = false;
    archivedExpanded = false;
    contactsViewActive = false;
    contactEditMode = false;
```

- [ ] **Step 4: Add extra_emails normalization to contacts mapping**

Find the contacts mapping in `loadListArtists()` (~line 2301):
```js
    contacts = loadedContacts.map(c => ({
      ...c,
      status: c.status || 'cold',
      notes_log: Array.isArray(c.notes_log) ? c.notes_log :
        (c.notes ? [{ date: new Date().toISOString().slice(0,10), text: c.notes }] : []),
    }));
```

Replace with:
```js
    contacts = loadedContacts.map(c => ({
      ...c,
      status: c.status || 'cold',
      notes_log: Array.isArray(c.notes_log) ? c.notes_log :
        (c.notes ? [{ date: new Date().toISOString().slice(0,10), text: c.notes }] : []),
      extra_emails: Array.isArray(c.extra_emails) ? c.extra_emails : [],
    }));
```

- [ ] **Step 5: Verify app still loads**

Run: `npm start`
Expected: App opens, lists load, no console errors about undefined `contactsViewActive` or `contactEditMode`. Open devtools (Cmd+Option+I on Mac) and confirm no JS errors.

- [ ] **Step 6: Commit**

```bash
git add migration_v5_contacts_extra_emails.sql index.html
git commit -m "feat: add contactsViewActive/contactEditMode globals + extra_emails normalization"
```

---

### Task 2: Helper functions — emailsOf and getFilteredContacts

**Files:**
- Modify: `index.html` (after `getFiltered()` function ~line 2532)

- [ ] **Step 1: Add emailsOf helper after getFiltered()**

Find the closing brace of `getFiltered()` (~line 2532):
```js
  return getSorted(filtered);
}
```

Insert after it:
```js

function emailsOf(c) {
  return [c.email, ...(c.extra_emails || [])].map(e => (e || '').toLowerCase()).filter(Boolean);
}

function getFilteredContacts() {
  return contacts.filter(c => {
    if (activeLabel !== 'all' && normalizeLabel(c.label) !== activeLabel) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (c.name || '').toLowerCase().includes(q)
      || (c.role || '').toLowerCase().includes(q)
      || (c.email || '').toLowerCase().includes(q)
      || (c.extra_emails || []).some(e => e.toLowerCase().includes(q))
      || (c.label || '').toLowerCase().includes(q);
  }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
```

- [ ] **Step 2: Verify helpers are available**

Run: `npm start`, open devtools console.
Type `emailsOf` → should print the function.
Type `getFilteredContacts()` → should return an array (empty or with contacts).
No console errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add emailsOf and getFilteredContacts helpers"
```

---

### Task 3: Sidebar footer "All Contacts" button + CSS + click handler

**Files:**
- Modify: `index.html` (HTML ~line 1759, CSS after `#label-list` block ~line 221, click delegation ~line 3621, `renderSidebar` ~line 2556)

- [ ] **Step 1: Add button HTML to sidebar**

Find this in the HTML (~line 1758):
```html
    <div class="sidebar-section">Labels</div>
    <div id="label-list"></div>
  </aside>
```

Replace with:
```html
    <div class="sidebar-section">Labels</div>
    <div id="label-list"></div>
    <div id="sidebar-contacts-btn" class="sidebar-contacts-btn" data-action="toggle-contacts-view">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="4" r="2.2" stroke="currentColor" stroke-width="1.3"/>
        <path d="M1.5 10.5c0-2.485 2.015-4.5 4.5-4.5s4.5 2.015 4.5 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
      All Contacts
    </div>
  </aside>
```

- [ ] **Step 2: Add CSS for the button**

Find this CSS block (~line 217):
```css
  #label-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
```

Insert immediately after it:
```css

  .sidebar-contacts-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    font-size: 10px;
    color: var(--text-dim);
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }
  .sidebar-contacts-btn:hover { color: #a855f7; }
  .sidebar-contacts-btn.active { color: #a855f7; background: rgba(168, 85, 247, 0.12); }
```

Note: `#label-list` has `flex: 1` so it absorbs all available sidebar space, pushing the contacts button to the bottom naturally.

- [ ] **Step 3: Update renderSidebar() to sync the active class**

Find `renderSidebar()` (~line 2556). After the `document.getElementById('label-list').innerHTML = ...` assignment (after the closing backtick + semicolon), add:
```js
  const btn = document.getElementById('sidebar-contacts-btn');
  if (btn) btn.classList.toggle('active', contactsViewActive);
```

The full function should end like:
```js
function renderSidebar() {
  const labels = getLabels();
  document.getElementById('label-list').innerHTML = `
    <div class="label-item ${activeLabel==='all'?'active':''}" data-action="filter" data-label="all">
      <span class="label-name">All Artists</span>
      <span class="label-count">${artists.length}</span>
    </div>
    ${labels.map(([lbl,cnt]) => `
      <div class="label-item ${activeLabel===lbl?'active':''}" data-action="filter" data-label="${h(lbl)}">
        <span class="label-name">${h(lbl)}</span>
        <span class="label-count">${cnt}</span>
      </div>`).join('')}
  `;
  const btn = document.getElementById('sidebar-contacts-btn');
  if (btn) btn.classList.toggle('active', contactsViewActive);
}
```

- [ ] **Step 4: Add toggle-contacts-view to click delegation**

In the click delegation block (~line 3621), find:
```js
  else if (action === 'toggle-brief-filter') { briefFilterActive = !briefFilterActive; render(); }
```

Add before it:
```js
  else if (action === 'toggle-contacts-view') {
    contactsViewActive = !contactsViewActive;
    if (contactsViewActive) { selectedId = null; contactEditMode = false; }
    selectedContactId = null;
    render();
  }
```

- [ ] **Step 5: Verify in app**

Run: `npm start`
Expected:
- "All Contacts" button visible at bottom of sidebar with a person icon
- Clicking toggles it to purple (active state)
- Clicking again deactivates
- No crash (middle column still shows artist list — contact list rendering comes in Task 4)

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: sidebar All Contacts button with toggle-contacts-view handler"
```

---

### Task 4: Contact list rendering in renderList()

**Files:**
- Modify: `index.html` (CSS before `#list-filter-bar` ~line 307, `renderList` ~line 2582, click delegation)

- [ ] **Step 1: Add CSS for contact list rows**

Find this CSS block (~line 307):
```css
  #list-filter-bar {
```

Insert before it:
```css
  .contact-list-header {
    padding: 6px 10px 5px;
    border-bottom: 1px solid var(--border);
    font-size: 10px;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .contact-list-header .cl-title { color: #a855f7; font-weight: 600; }
  .contact-list-header .cl-count { font-size: 9px; color: var(--text-muted); font-family: var(--font-mono); }
  .cl-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    cursor: pointer;
    user-select: none;
  }
  .cl-row:hover { background: rgba(255,255,255,0.03); }
  .cl-row.active { background: var(--surface); }
  .cl-avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 7px;
    font-weight: 700;
    color: white;
    background: linear-gradient(135deg, #5c2d91, #a855f7);
  }
  .cl-info { flex: 1; min-width: 0; }
  .cl-name { font-size: 10px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cl-sub { font-size: 9px; color: var(--text-muted); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cl-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
```

- [ ] **Step 2: Add contacts-view early-return branch at the top of renderList()**

Find the start of `renderList()` (~line 2582):
```js
function renderList() {
  // Render filter bar
  const filterBar = document.getElementById('list-filter-bar');
  if (filterBar) {
    filterBar.innerHTML = briefs.length > 0
      ? `<button class="brief-filter-toggle ${briefFilterActive ? 'on' : ''}" data-action="toggle-brief-filter">◈ Briefs</button>`
      : '';
  }

  const list = getFiltered();

  const cardsEl = document.getElementById('artist-cards');
```

Replace this opening block (up to and including `const cardsEl = ...`) with:
```js
function renderList() {
  const filterBar = document.getElementById('list-filter-bar');
  const cardsEl = document.getElementById('artist-cards');

  if (contactsViewActive) {
    if (filterBar) filterBar.innerHTML = '';
    cardsEl.className = '';
    const filtered = getFilteredContacts();
    const statusColors = { cold: '#6a8aff', reached_out: '#30D158', in_convo: '#FF9500', placed: '#BF5AF2' };
    const labelScope = activeLabel !== 'all' ? `${activeLabel} · ` : '';
    cardsEl.innerHTML = `
      <div class="contact-list-header">
        <span class="cl-title">Contacts</span>
        <span class="cl-count">${h(labelScope)}${filtered.length}</span>
      </div>
      ${filtered.length === 0
        ? `<div class="empty-list"><div class="ei">◈</div><p>no contacts${searchQuery ? ' found' : ''}</p></div>`
        : filtered.map(c => {
            const av = (c.name || '?').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
            const dotColor = statusColors[c.status] || '#3a3a48';
            return `<div class="cl-row ${selectedContactId === c.id ? 'active' : ''}"
                         data-action="select-contact-global" data-contact-id="${h(c.id)}">
              <div class="cl-avatar">${h(av)}</div>
              <div class="cl-info">
                <div class="cl-name">${h(c.name || 'Unnamed')}</div>
                <div class="cl-sub">${h(c.role || c.label || '')}</div>
              </div>
              <div class="cl-status-dot" style="background:${dotColor}"></div>
            </div>`;
          }).join('')
      }`;
    return;
  }

  // Artist list mode
  if (filterBar) {
    filterBar.innerHTML = briefs.length > 0
      ? `<button class="brief-filter-toggle ${briefFilterActive ? 'on' : ''}" data-action="toggle-brief-filter">◈ Briefs</button>`
      : '';
  }

  const list = getFiltered();

```

Note: The original function had `const cardsEl = document.getElementById('artist-cards');` a few lines after `const list = getFiltered();`. Remove that duplicate declaration (keep only the one at the top of the function now).

- [ ] **Step 3: Add select-contact-global to click delegation**

In the click delegation block, add alongside the other handlers:
```js
  else if (action === 'select-contact-global') {
    const contactId = el.dataset.contactId;
    if (contactId) {
      selectedContactId = selectedContactId === contactId ? null : contactId;
      contactEditMode = false;
      renderList();
      renderDetail();
    }
  }
```

- [ ] **Step 4: Verify in app**

Run: `npm start`
Expected:
1. Click "All Contacts" → middle column shows "Contacts" header + contact rows (initials circle, name, role, status dot)
2. Clicking a contact row highlights it active
3. ⌘F → typing filters the list live
4. Clicking a label (e.g., "SM") narrows to contacts with that label
5. Clicking "All Artists" in sidebar → artist list returns

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: contact list rendering in renderList() when contactsViewActive"
```

---

### Task 5: renderDetail() contacts-view branch

**Files:**
- Modify: `index.html` (`renderDetail` ~line 2643)

**Context:** When `contactsViewActive` is true and a contact is selected, `renderDetail()` bypasses the artist workspace and renders a notes panel directly into `#detail-content`. When no contact is selected, shows the empty state. `renderNotesPanel` receives `{ showArtists: true }` as the second argument (implemented in Task 6).

- [ ] **Step 1: Add contacts-view branch at top of renderDetail()**

Find the start of `renderDetail()` (~line 2643):
```js
function renderDetail() {
  const empty = document.getElementById('detail-empty');
  const content = document.getElementById('detail-content');

  if (!selectedId) {
    empty.style.display = 'flex';
    content.style.display = 'none';
    return;
  }
  const a = artists.find(x => x.id === selectedId);
  if (!a) {
    empty.style.display = 'flex';
    content.style.display = 'none';
    return;
  }
```

Replace with:
```js
function renderDetail() {
  const empty = document.getElementById('detail-empty');
  const content = document.getElementById('detail-content');

  if (contactsViewActive) {
    if (!selectedContactId) {
      empty.style.display = 'flex';
      content.style.display = 'none';
      return;
    }
    const contact = contacts.find(c => c.id === selectedContactId);
    if (!contact) {
      empty.style.display = 'flex';
      content.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.height = '100%';
    content.innerHTML = '<div id="notes-panel" class="workspace-notes-panel open" style="flex:1;max-width:none;width:100%"></div>';
    renderNotesPanel(contact, { showArtists: true });
    return;
  }

  if (!selectedId) {
    empty.style.display = 'flex';
    content.style.display = 'none';
    return;
  }
  const a = artists.find(x => x.id === selectedId);
  if (!a) {
    empty.style.display = 'flex';
    content.style.display = 'none';
    return;
  }
```

- [ ] **Step 2: Verify partial behavior**

Run: `npm start`
Expected: Clicking "All Contacts" then a contact row should attempt to render the notes panel in the right column. It may call `renderNotesPanel(contact, { showArtists: true })` which still has the old signature — the `opts` arg will be silently ignored. You may see the existing notes panel render (with inputs). That's acceptable until Task 6 adds read-only mode.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: renderDetail contacts-view branch"
```

---

### Task 6: renderNotesPanel read-only/edit mode + Artists line + extra_emails UI

**Files:**
- Modify: `index.html` (CSS, `renderNotesPanel` ~line 2907, new helpers after it, click delegation, `selectArtist` ~line 3031, `toggleNotesPanel` ~line 2898)

**Context:** `renderNotesPanel(contact, opts = {})` gains read-only-by-default behavior driven by the global `contactEditMode`. When `opts.showArtists` is true, a non-editable "Artists: X, Y" line appears at the top. The `✎ Edit` button sets `contactEditMode = true`; `✓ Done` sets it back to false. `contactEditMode` resets to false whenever `selectedContactId` changes.

- [ ] **Step 1: Add CSS for read-only view + extra emails**

Find the CSS section that contains `.np-field` and `.np-field-name`. Add after those rules:
```css
  .np-val {
    font-size: 10px;
    color: var(--text);
    padding: 4px 0 3px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    min-height: 22px;
  }
  .np-val.np-val-name { font-size: 12px; font-weight: 600; border-bottom: none; padding-bottom: 2px; }
  .np-val.dim { color: var(--text-dim); }
  .np-val.email { color: #5a8aff; }
  .np-edit-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 9px;
    padding: 2px 8px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .np-edit-btn:hover { color: #a855f7; border-color: #a855f7; }
  .np-artists-line {
    font-size: 9px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    margin-bottom: 4px;
  }
  .np-artists-line span { color: #5a8aff; }
  .np-extra-email-row { display: flex; align-items: center; gap: 4px; }
  .np-remove-email {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    padding: 0 3px;
    line-height: 1;
  }
  .np-remove-email:hover { color: #FF5555; }
  .np-add-email-link {
    font-size: 9px;
    color: var(--text-dim);
    cursor: pointer;
    font-family: var(--font-mono);
    padding: 2px 0;
    display: inline-block;
  }
  .np-add-email-link:hover { color: #a855f7; }
```

- [ ] **Step 2: Rewrite renderNotesPanel()**

Replace the entire `renderNotesPanel(contact)` function with this new version:

```js
function renderNotesPanel(contact, opts = {}) {
  const panel = document.getElementById('notes-panel');
  if (!panel) return;

  const statusColors = { cold: '#6a8aff', reached_out: '#30D158', in_convo: '#FF9500', placed: '#BF5AF2' };
  const currentStatus = ['cold','reached_out','in_convo','placed'].includes(contact.status) ? contact.status : 'cold';
  const notesLog = Array.isArray(contact.notes_log) ? contact.notes_log : [];
  const extraEmails = Array.isArray(contact.extra_emails) ? contact.extra_emails : [];

  const statusDotsHTML = Object.entries(statusColors).map(([s, color]) => `
    <button class="np-status-dot ${currentStatus===s?'active':''}"
         style="background:${color};width:10px;height:10px;border-radius:50%"
         title="${statusLabel(s)}"
         onclick="setContactStatus('${h(contact.id)}','${s}')"></button>
  `).join('');

  const logsHTML = notesLog.length === 0
    ? `<div style="font-size:10px;color:var(--text-dim)">No notes yet.</div>`
    : [...notesLog].reverse().map(entry => `
        <div class="np-note-entry">
          <div class="np-note-date">${h(entry.date)}</div>
          <div class="np-note-text">${h(entry.text)}</div>
        </div>`).join('');

  const artistNames = opts.showArtists
    ? artists.filter(a => Array.isArray(contact.artist_ids) && contact.artist_ids.includes(a.id)).map(a => a.name)
    : [];
  const artistsLine = artistNames.length > 0
    ? `<div class="np-artists-line">Artists: ${artistNames.map(n => `<span>${h(n)}</span>`).join(', ')}</div>`
    : '';

  let fieldsHTML;
  if (contactEditMode) {
    const extraInputs = extraEmails.map((em, i) => `
      <div class="np-extra-email-row">
        <input class="np-field np-field-sm" value="${h(em)}"
               placeholder="Email"
               onblur="saveExtraEmail('${h(contact.id)}',${i},this.value)">
        <button class="np-remove-email" onclick="removeExtraEmail('${h(contact.id)}',${i})" title="Remove">×</button>
      </div>`).join('');
    fieldsHTML = `
      <input class="np-field np-field-name" value="${h(contact.name)}"
             placeholder="Name"
             onblur="saveContactField('${h(contact.id)}','name',this.value)">
      <input class="np-field np-field-sm" value="${h(contact.role||'')}"
             placeholder="Role"
             onblur="saveContactField('${h(contact.id)}','role',this.value)">
      <input class="np-field np-field-sm" value="${h(contact.email||'')}"
             placeholder="Email"
             onblur="saveContactField('${h(contact.id)}','email',this.value)">
      ${extraInputs}
      <span class="np-add-email-link" onclick="addExtraEmailInput('${h(contact.id)}')">+ Add email</span>
      <input class="np-field np-field-sm" value="${h(contact.phone||'')}"
             placeholder="Phone"
             onblur="saveContactField('${h(contact.id)}','phone',this.value)">
      <input class="np-field np-field-sm" value="${h(contact.social||'')}"
             placeholder="Instagram / Twitter"
             onblur="saveContactField('${h(contact.id)}','social',this.value)">`;
  } else {
    const extraEmailsHTML = extraEmails.filter(Boolean).map(em =>
      `<div class="np-val email">${h(em)}</div>`).join('');
    fieldsHTML = `
      <div class="np-val np-val-name">${h(contact.name || '')}</div>
      <div class="np-val dim">${h(contact.role || '')}</div>
      <div class="np-val email">${h(contact.email || '')}</div>
      ${extraEmailsHTML}
      <div class="np-val dim">${h(contact.phone || '')}</div>
      <div class="np-val dim">${h(contact.social || '')}</div>`;
  }

  const editBtnHTML = contactEditMode
    ? `<button class="np-edit-btn" data-action="toggle-contact-edit" data-contact-id="${h(contact.id)}">✓ Done</button>`
    : `<button class="np-edit-btn" data-action="toggle-contact-edit" data-contact-id="${h(contact.id)}">✎ Edit</button>`;

  const deleteBtn = `<button class="np-close" style="color:#FF5555;margin-right:2px" data-action="delete-contact" data-contact-id="${h(contact.id)}" title="Delete contact">🗑</button>`;
  const closeBtn = contactsViewActive
    ? ''
    : `<button class="np-close" onclick="toggleNotesPanel('${h(contact.id)}')">✕</button>`;

  panel.innerHTML = `
    <div class="np-header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px;margin-bottom:6px">
        <div style="flex:1;min-width:0">${artistsLine}</div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          ${deleteBtn}${closeBtn}${editBtnHTML}
        </div>
      </div>
      ${fieldsHTML}
      <div class="np-status-row">
        ${statusDotsHTML}
        <span class="np-status-label-text" style="color:${statusColors[currentStatus]}">${statusLabel(currentStatus)}</span>
      </div>
    </div>
    <div class="np-actions">
      <button class="np-action-btn" ${contact.email?'':'disabled'}
        data-action="np-email" data-value="${h(contact.email||'')}">✉ Email</button>
      <button class="np-action-btn" ${contact.email?'':'disabled'}
        data-action="np-copy" data-value="${h(contact.email||'')}">⎘ Copy</button>
      <button class="np-action-btn" ${contact.social?'':'disabled'}
        data-action="np-dm" data-value="${h(contact.social||'')}">↗ DM</button>
    </div>
    <div class="np-notes-area">
      <div class="np-notes-section-label">Notes</div>
      ${logsHTML}
      <button class="np-add-note-btn" onclick="showAddNoteInput('${h(contact.id)}')">+ Add note</button>
    </div>`;
}
```

- [ ] **Step 3: Add saveExtraEmail, removeExtraEmail, addExtraEmailInput helpers**

Insert these three functions immediately after `renderNotesPanel()`:

```js
function saveExtraEmail(contactId, index, value) {
  const idx = contacts.findIndex(c => c.id === contactId);
  if (idx < 0) return;
  const emails = [...(contacts[idx].extra_emails || [])];
  const trimmed = value.trim();
  if (emails[index] === trimmed) return;
  emails[index] = trimmed;
  contacts[idx] = { ...contacts[idx], extra_emails: emails };
  syncContact(contacts[idx]);
}

function removeExtraEmail(contactId, index) {
  const idx = contacts.findIndex(c => c.id === contactId);
  if (idx < 0) return;
  const emails = [...(contacts[idx].extra_emails || [])];
  emails.splice(index, 1);
  contacts[idx] = { ...contacts[idx], extra_emails: emails };
  renderDetail();
  syncContact(contacts[idx]);
}

function addExtraEmailInput(contactId) {
  const idx = contacts.findIndex(c => c.id === contactId);
  if (idx < 0) return;
  contacts[idx] = { ...contacts[idx], extra_emails: [...(contacts[idx].extra_emails || []), ''] };
  renderDetail();
  setTimeout(() => {
    const inputs = document.querySelectorAll('.np-extra-email-row input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }, 50);
}
```

- [ ] **Step 4: Add toggle-contact-edit to click delegation**

In the click delegation block, add:
```js
  else if (action === 'toggle-contact-edit') {
    contactEditMode = !contactEditMode;
    renderDetail();
  }
```

- [ ] **Step 5: Reset contactEditMode when contact changes in selectArtist()**

Find `selectArtist()` (~line 3031):
```js
function selectArtist(id) {
  selectedId = id;
  selectedContactId = null;
  wsStatusFilter = 'all';
  wsTab = 'contacts';
  archivedExpanded = false;
  render();
```

Replace with:
```js
function selectArtist(id) {
  selectedId = id;
  selectedContactId = null;
  contactEditMode = false;
  wsStatusFilter = 'all';
  wsTab = 'contacts';
  archivedExpanded = false;
  render();
```

- [ ] **Step 6: Reset contactEditMode when notes panel is toggled**

Find `toggleNotesPanel()` (~line 2898):
```js
function toggleNotesPanel(contactId) {
  if (selectedContactId === contactId) {
    selectedContactId = null;
  } else {
    selectedContactId = contactId;
  }
  renderDetail();
}
```

Replace with:
```js
function toggleNotesPanel(contactId) {
  if (selectedContactId === contactId) {
    selectedContactId = null;
  } else {
    selectedContactId = contactId;
    contactEditMode = false;
  }
  renderDetail();
}
```

- [ ] **Step 7: Verify in app**

Run: `npm start`
Expected:
1. In artist workspace: click a contact's ✎ (notes) button → panel opens in read-only view (plain text fields, not inputs), with `✎ Edit` button top-right
2. Click `✎ Edit` → fields become inputs, button becomes `✓ Done`
3. Edit a field and tab away → field saves (contact name updates in the list)
4. Click `✓ Done` → back to read-only
5. Status dots still clickable and change status in both modes
6. In contacts view: click a contact → right column fills with read-only panel, "Artists: X, Y" line at top if contact has artist_ids
7. Clicking `✎ Edit` then `✓ Done` works in contacts view too
8. `+ Add email` in edit mode → new input appears, focused
9. `×` next to extra email removes it

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: renderNotesPanel read-only/edit mode + extra_emails UI + Artists line"
```

---

### Task 7: main.js prompt update + _processParsedBrief contact auto-creation

**Files:**
- Modify: `main.js` (brief parsing prompt ~line 310)
- Modify: `index.html` (`_processParsedBrief` ~line 3341)

**Context:** The brief parsing prompt gains a top-level `contacts` field. Claude returns named people listed as "who to contact" with their email and role. In `_processParsedBrief`, after all brief records are written, the new contacts loop runs: email-only entries are created if not seen before; name+email entries are deduplicated against existing contacts by email first (skip), then by name+label (add email to `extra_emails`), then created fresh. Toast updated to mention new contacts.

- [ ] **Step 1: Add contacts field to brief parsing prompt schema in main.js**

Find the `prompt` constant in `parseBriefPdf()` (~line 310). The schema currently starts:
```js
  const prompt = `Extract all brief information from this PDF and return valid JSON matching this schema exactly:
{
  "label": "string",
  "submission_emails": ["string"],
  "artists": [
```

Replace with:
```js
  const prompt = `Extract all brief information from this PDF and return valid JSON matching this schema exactly:
{
  "label": "string",
  "submission_emails": ["string"],
  "contacts": [{ "name": "string or null", "email": "string", "role": "string or null" }],
  "artists": [
```

- [ ] **Step 2: Add contacts rule to the Rules section in main.js**

Find this in the Rules block:
```
- submission_emails: all email addresses from the cover/intro page.
- artists: one entry per artist section in the PDF.
```

Replace with:
```
- submission_emails: all email addresses from the cover/intro page.
- contacts: named people listed as submission contacts or "who to contact." Include email. name and role are null if not stated. Omit entries with no email.
- artists: one entry per artist section in the PDF.
```

- [ ] **Step 3: Add contact auto-creation logic in _processParsedBrief in index.html**

Find the end of `_processParsedBrief` (~line 3380). Currently the loop ends and immediately calls `render()` and shows the toast:
```js
  render();
  if (errors.length > 0) {
    toast(`Imported ${importedCount} briefs · ${errors.length} failed`, true);
  } else {
    const contactNote = matchedContactIds.length > 0
      ? ` · ${matchedContactIds.length} contact${matchedContactIds.length !== 1 ? 's' : ''} matched`
      : '';
    toast(`Brief imported: ${importedCount} artist${importedCount !== 1 ? 's' : ''}${contactNote}`);
  }
}
```

Replace with:
```js
  // Auto-create contacts from brief contacts list
  const parsedContacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];
  const allBriefArtistIds = briefArtists
    .map(ba => matchArtistByName(ba.name))
    .filter(Boolean)
    .map(a => a.id);
  let newContactCount = 0;

  for (const pc of parsedContacts) {
    if (!pc.email) continue;
    const email = pc.email.toLowerCase().trim();

    if (!pc.name) {
      // Email-only: create if not already in any contact's emails
      const exists = contacts.some(c => emailsOf(c).includes(email));
      if (!exists) {
        const nc = {
          id: uid(),
          list_id: currentListId,
          label: label || '',
          artist_ids: allBriefArtistIds,
          name: '',
          role: pc.role || '',
          email: pc.email.trim(),
          phone: '',
          social: '',
          status: 'cold',
          notes_log: [],
          extra_emails: [],
        };
        contacts.push(nc);
        syncContact(nc);
        newContactCount++;
      }
    } else {
      // Name + email: check email first (skip if any contact already has it)
      const byEmail = contacts.some(c => emailsOf(c).includes(email));
      if (byEmail) continue;

      // Check name within same label
      const byNameIdx = contacts.findIndex(c =>
        c.label === (label || '') &&
        (c.name || '').toLowerCase() === pc.name.toLowerCase()
      );
      if (byNameIdx >= 0) {
        // Name exists but email isn't on it — add to extra_emails
        const emails = [...(contacts[byNameIdx].extra_emails || [])];
        if (!emailsOf(contacts[byNameIdx]).includes(email)) {
          emails.push(pc.email.trim());
          contacts[byNameIdx] = { ...contacts[byNameIdx], extra_emails: emails };
          syncContact(contacts[byNameIdx]);
        }
      } else {
        // New person — create contact
        const nc = {
          id: uid(),
          list_id: currentListId,
          label: label || '',
          artist_ids: allBriefArtistIds,
          name: pc.name,
          role: pc.role || '',
          email: pc.email.trim(),
          phone: '',
          social: '',
          status: 'cold',
          notes_log: [],
          extra_emails: [],
        };
        contacts.push(nc);
        syncContact(nc);
        newContactCount++;
      }
    }
  }

  render();
  if (errors.length > 0) {
    toast(`Imported ${importedCount} briefs · ${errors.length} failed`, true);
  } else {
    const contactNote = newContactCount > 0
      ? ` · ${newContactCount} new contact${newContactCount !== 1 ? 's' : ''} added`
      : matchedContactIds.length > 0
        ? ` · ${matchedContactIds.length} contact${matchedContactIds.length !== 1 ? 's' : ''} matched`
        : '';
    toast(`Brief imported: ${importedCount} artist${importedCount !== 1 ? 's' : ''}${contactNote}`);
  }
}
```

- [ ] **Step 4: Verify in app**

Run: `npm start`

**Test A — new contact from brief:**
1. Import a brief PDF that contains a named "who to contact" person not already in your contacts list
2. Expected: Toast says "Brief imported: N artists · M new contacts added"
3. Click "All Contacts" → new contact visible in the list with correct name, role, and email

**Test B — deduplication:**
1. Import the same brief again
2. Expected: Toast shows 0 new contacts added (no duplicates)
3. Contact list unchanged

**Test C — email added to existing contact:**
1. Manually verify: if a brief has "Jane Park, jane2@sment.com" and contacts[] already has "Jane Park" (same label) with email "jane@sment.com" — after import, Jane's contact should have `extra_emails: ["jane2@sment.com"]` (visible in edit mode or Supabase dashboard)

- [ ] **Step 5: Commit**

```bash
git add main.js index.html
git commit -m "feat: brief contact auto-creation + updated PDF parsing prompt"
```

---

## Done

After Task 7 is complete, all features from the spec are implemented:
- Global contacts view with sidebar toggle, label filter, ⌘F search
- Read-only contact panel with ✎ Edit / ✓ Done toggle in both contexts
- Extra emails per contact (stored in Supabase, shown in UI)
- Brief → contact auto-creation with full email+name deduplication
