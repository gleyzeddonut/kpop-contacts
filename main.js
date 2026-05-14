const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const db = require('./db')

// ── Custom protocol for share links (kcontacts://share/{token}) ──
app.setAsDefaultProtocolClient('kcontacts')

let pendingShareToken  = null
let pendingConfirmCode = null  // PKCE auth code from email confirm link

function handleDeepLink(url) {
  // Share invite: kcontacts://share/{uuid}
  const shareMatch = url.match(/kcontacts:\/\/share\/([a-f0-9-]+)/i)
  if (shareMatch) {
    const token = shareMatch[1]
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deep-link:share', token)
    } else {
      pendingShareToken = token
    }
    return
  }

  // Email confirmation: kcontacts://auth/confirm?code=…
  if (url.startsWith('kcontacts://auth/confirm')) {
    let code = null
    try { code = new URL(url).searchParams.get('code') } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deep-link:confirm', { code })
    } else {
      pendingConfirmCode = code
    }
  }
}

// macOS: app already running, link clicked
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

// Windows/Linux: second instance launched with the URL in argv
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_, argv) => {
    const url = argv.find(a => a.startsWith('kcontacts://'))
    if (url) handleDeepLink(url)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

const SUPABASE_URL      = 'https://rzjqfhioljtvhwbokbbo.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_ZE15birmX4UWtUau8MUwLQ_cweDsmiz'
const CLAUDE_PROXY_URL  = `${SUPABASE_URL}/functions/v1/claude-proxy`

// ── Live reload: dev-only ──
if (!app.isPackaged) {
  try {
    require('electron-reload')(__dirname, {
      electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
      hardResetMethod: 'exit',
      ignored: /node_modules|dist/,
    })
  } catch (_) {}
}

// ── Contact filtering helpers ──
const GENERIC_EMAILS = ['info@', 'contact@', 'hello@', 'admin@', 'general@', 'support@', 'inquiry@', 'noreply@']
function isProtectedEmail(email) {
  return email.includes('email-protected') || email.includes('[email') || email.includes('cdn-cgi')
}
const SOCIAL_DOMAINS = ['twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'facebook.com', 'youtube.com', 'tiktok.com', 'weibo.com', 'weverse.io']
function isUsableSocial(s) {
  if (!s) return false
  try { const url = new URL(s); return SOCIAL_DOMAINS.some(d => url.hostname.endsWith(d)) }
  catch { return s.length > 0 }
}

async function callClaude(body) {
  const token = await db.getAccessToken()
  if (!token) throw new Error('Not signed in')
  const res = await fetch(CLAUDE_PROXY_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Proxy error ${res.status}`)
  }
  return res.json()
}

// ── Claude API: find A&R contacts for an artist ──
async function scanContacts(artistName, label) {
  const prompt = `You are a K-pop music industry expert helping a songwriter find submission contacts.

Find direct A&R contacts for pitching songs to "${artistName}" (${label}).

Return ONLY a valid JSON array — no markdown, no code fences, no explanation. Each element:
{
  "name": "person name or specific department",
  "role": "short title (5 words max)",
  "email": "email if publicly known, else empty string",
  "phone": "phone if publicly known, else empty string",
  "social": "handle or URL if useful, else empty string",
  "notes": "1 sentence: how to reach them and why they matter"
}

RULES:
- Only include a contact if it has at least one of: a real email address, a phone number, or a social media profile URL (Twitter/X, Instagram, LinkedIn). A company homepage (e.g. smtown.com, hybe.com) is NOT a contact method — omit it.
- Only named individuals or specific submission portals (e.g. publishing@label.com). No generic info@/contact@/admin@/hello@/support@ addresses.
- notes: MAX 1 sentence. No background, no history, no caveats beyond what's needed to act.
- If you can't find a direct contact, return an empty array rather than a generic one.`

  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
    messages: [{ role: 'user', content: prompt }],
  })

  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  if (!text) throw new Error('No response text from Claude')

  const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/)
  if (!match) throw new Error('Claude did not return a contacts array')

  let contacts
  try { contacts = JSON.parse(match[0]) }
  catch { throw new Error('Claude returned unparseable JSON') }

  return contacts
    .filter(c => {
      const email = String(c.email || '').toLowerCase()
      if (GENERIC_EMAILS.some(p => email.startsWith(p))) return false
      if (email && isProtectedEmail(email)) return false
      return email || String(c.phone || '') || isUsableSocial(String(c.social || ''))
    })
    .map(c => ({
      id: crypto.randomUUID(),
      name: String(c.name || '').trim(),
      role: String(c.role || '').trim(),
      email: String(c.email || '').trim(),
      phone: String(c.phone || '').trim(),
      social: String(c.social || '').trim(),
      notes: String(c.notes || '').trim(),
    }))
}

// ── Claude API: full artist profile lookup ──
async function scanArtist(artistName) {
  const prompt = `You are a K-pop music industry expert helping a songwriter quickly look up an artist.

Look up "${artistName}" and return ONLY a valid JSON object — no markdown, no code fences, no explanation:
{
  "name": "official romanized artist name",
  "label": "current record label (short form, e.g. HYBE, JYP Entertainment)",
  "type": "group OR solo OR duo OR unit",
  "country": "country of origin",
  "genres": ["genre1", "genre2"],
  "notes": "2 sentences MAX: current status + best submission approach for external writers",
  "contacts": [
    {
      "name": "person name or specific department",
      "role": "short title (5 words max)",
      "email": "email if publicly known, else empty string",
      "phone": "phone if publicly known, else empty string",
      "social": "handle or URL if useful, else empty string",
      "notes": "1 sentence: how to reach them and why they matter"
    }
  ]
}

RULES:
- notes (artist level): 2 sentences MAX. Current activity + pitch approach only. No member lists, no discography, no background.
- contacts: only named individuals or specific submission portals (e.g. publishing@label.com). No generic info@/contact@/admin@/hello@/support@ addresses.
- Only include a contact if it has at least one of: a real email address, a phone number, or a social media profile URL (Twitter/X, Instagram, LinkedIn). A company homepage (e.g. smtown.com, hybe.com) is NOT a contact method — omit it entirely.
- contact notes: 1 sentence MAX. Action-oriented only.
- If no direct contact exists, return an empty contacts array.`

  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
    messages: [{ role: 'user', content: prompt }],
  })

  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  if (!text) throw new Error('No response text from Claude')

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Claude did not return artist data')

  let artist
  try { artist = JSON.parse(match[0]) }
  catch { throw new Error('Claude returned unparseable JSON') }
  function isActionableContact(c) {
    const email = String(c.email || '').toLowerCase()
    if (GENERIC_EMAILS.some(p => email.startsWith(p))) return false
    return email || String(c.phone || '') || isUsableSocial(String(c.social || ''))
  }

  return {
    name: String(artist.name || artistName).trim(),
    label: String(artist.label || '').trim(),
    type: String(artist.type || 'group').trim(),
    country: String(artist.country || 'South Korea').trim(),
    genres: Array.isArray(artist.genres) ? artist.genres.map(g => String(g).trim()) : [],
    notes: String(artist.notes || '').trim(),
    contacts: (Array.isArray(artist.contacts) ? artist.contacts : [])
      .filter(isActionableContact)
      .map(c => ({
        name: String(c.name || '').trim(),
        role: String(c.role || '').trim(),
        email: String(c.email || '').trim(),
        phone: String(c.phone || '').trim(),
        social: String(c.social || '').trim(),
        notes: String(c.notes || '').trim(),
      })),
  }
}

function briefProgress(msg) {
  console.log('[brief]', msg)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('brief:progress', msg)
  }
}

// ── Claude API: parse a brief PDF ──
async function parseBriefPdf(filePath) {
  const buffer = fs.readFileSync(filePath)
  briefProgress(`Read file: ${filePath} (${(buffer.length / 1024).toFixed(0)} KB)`)
  const base64 = buffer.toString('base64')
  briefProgress(`Encoded to base64 (${(base64.length / 1024).toFixed(0)} KB) — sending to Claude…`)

  const prompt = `Extract all brief information from this PDF and return valid JSON matching this schema exactly:
{
  "label": "string",
  "submission_emails": ["string"],
  "artists": [
    {
      "name": "string",
      "deadline": "string or null",
      "general_direction": "string or null",
      "track_types": [
        {
          "name": "string",
          "tags": ["string"],
          "wants": ["string"],
          "avoids": ["string"],
          "references": [{ "title": "string", "url": "string" }]
        }
      ]
    }
  ]
}

Rules:
- label: the issuing label name (e.g. "SM Entertainment").
- submission_emails: all email addresses from the cover/intro page.
- artists: one entry per artist section in the PDF.
- deadline: extract as-is ("ASAP", "By May 8th", "early June"). null if not stated.
- general_direction: the [General Direction] block if present, else null.
- tags: hashtags found in the track type heading (e.g. #GenZ_Energy). Empty array if none.
- wants: bullet points describing what they want. Also include items under "Please include:".
- avoids: bullet points under "Please avoid:" or explicit negations in direction text.
- references: YouTube/music URLs with their track title. Empty array if "No specific references provided".
Return ONLY the JSON object. No markdown, no code fences, no explanation.`

  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64,
          },
        },
        { type: 'text', text: prompt },
      ],
    }],
  })

  briefProgress('Claude responded — parsing JSON…')
  console.log('[brief] raw response content blocks:', JSON.stringify(data.content?.map(b => ({ type: b.type, len: b.text?.length }))))

  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  if (!text) throw new Error('No response from Claude')

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Claude did not return a JSON object')

  let parsed
  try { parsed = JSON.parse(match[0]) }
  catch { throw new Error('Claude returned unparseable JSON') }
  briefProgress(`Parsed: ${parsed.artists?.length ?? 0} artists, label: ${parsed.label}`)
  return parsed
}

// ── IPC handlers ──

// Config (API key + Supabase credentials)
ipcMain.handle('get-config', () => ({}))
ipcMain.handle('set-config', () => true)

// AI scan
ipcMain.handle('scan-contacts', async (_, { artistName, label }) => {
  return await scanContacts(artistName, label)
})

ipcMain.handle('scan-artist', async (_, { artistName }) => {
  return await scanArtist(artistName)
})

// Briefs
ipcMain.handle('briefs:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Brief PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  })
  if (canceled || filePaths.length === 0) return null
  const filePath = filePaths[0]
  const stat = fs.statSync(filePath)
  if (stat.size > 10 * 1024 * 1024) throw new Error('PDF too large (max 10MB)')
  const parsed = await parseBriefPdf(filePath)
  parsed._sourcePdf = path.basename(filePath)
  return parsed
})

ipcMain.handle('briefs:importFromPath', async (_, { filePath }) => {
  const stat = fs.statSync(filePath)
  if (stat.size > 10 * 1024 * 1024) throw new Error('PDF too large (max 10MB)')
  const parsed = await parseBriefPdf(filePath)
  parsed._sourcePdf = path.basename(filePath)
  return parsed
})

ipcMain.handle('briefs:getAll',  (_, { listId })          => db.getBriefs(listId))
ipcMain.handle('briefs:upsert',  (_, { listId, brief })   => db.upsertBrief(listId, brief))
ipcMain.handle('briefs:delete',  (_, { briefId })         => db.deleteBrief(briefId))

// Auth
ipcMain.handle('auth:signup',          (_, { email, password }) => db.signUp(email, password))
ipcMain.handle('auth:signin',          (_, { email, password }) => db.signIn(email, password))
ipcMain.handle('auth:signout',         ()                       => db.signOut())
ipcMain.handle('auth:getSession',      ()                       => db.getSession())
ipcMain.handle('auth:resetPassword',   (_, { email })           => db.resetPassword(email))
ipcMain.handle('auth:exchangeCode',    (_, { code })            => db.exchangeCodeForSession(code))

// Lists
ipcMain.handle('lists:getAll',  ()              => db.getLists())
ipcMain.handle('lists:create',  (_, { name })   => db.createList(name))
ipcMain.handle('lists:rename',  (_, { id, name }) => db.renameList(id, name))
ipcMain.handle('lists:delete',  (_, { id })     => db.deleteList(id))

// Artists
ipcMain.handle('artists:getAll', (_, { listId })         => db.getArtists(listId))
ipcMain.handle('artists:upsert', (_, { listId, artist }) => db.upsertArtist(listId, artist))
ipcMain.handle('artists:delete', (_, { artistId })       => db.deleteArtistDb(artistId))

// Contacts
ipcMain.handle('contacts:getAll',  (_, { listId })           => db.getContacts(listId))
ipcMain.handle('contacts:upsert',  (_, { listId, contact })  => db.upsertContact(listId, contact))
ipcMain.handle('contacts:delete',  (_, { contactId })        => db.deleteContact(contactId))

// Shares
ipcMain.handle('shares:get',    (_, { listId })                    => db.getShares(listId))
ipcMain.handle('shares:add',    (_, { listId, email, role })       => db.addShare(listId, email, role))
ipcMain.handle('shares:remove', (_, { shareId })                   => db.removeShare(shareId))

// Share tokens
ipcMain.handle('tokens:create',  (_, { listId, role })  => db.createShareToken(listId, role))
ipcMain.handle('tokens:getAll',  (_, { listId })         => db.getShareTokens(listId))
ipcMain.handle('tokens:delete',  (_, { tokenId })        => db.deleteShareToken(tokenId))
ipcMain.handle('tokens:resolve', (_, { tokenId })        => db.resolveShareToken(tokenId))

// ── Realtime IPC ──
ipcMain.handle('realtime:subscribe', (_, { listId }) => {
  db.subscribeArtists(listId, (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('realtime:change', payload)
    }
  })
})

ipcMain.handle('realtime:unsubscribe', () => {
  db.unsubscribeArtists()
})

ipcMain.handle('realtime:subscribeContacts', (_, { listId }) => {
  db.subscribeContacts(listId, (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('realtime:contactChange', payload)
    }
  })
})

ipcMain.handle('realtime:unsubscribeContacts', () => {
  db.unsubscribeContacts()
})

// ── Window ──
let mainWindow = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'K:CONTACTS',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#09090E',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow = win
  win.on('closed', () => { mainWindow = null })
  win.loadFile('index.html')

  win.webContents.once('did-finish-load', () => {
    if (pendingShareToken) {
      win.webContents.send('deep-link:share', pendingShareToken)
      pendingShareToken = null
    }
    if (pendingConfirmCode !== null) {
      win.webContents.send('deep-link:confirm', { code: pendingConfirmCode })
      pendingConfirmCode = null
    }
  })

  // All window.open() calls (e.g. fallback browser searches) go to default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  db.init(app.getPath('userData'), SUPABASE_URL, SUPABASE_ANON_KEY)
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
