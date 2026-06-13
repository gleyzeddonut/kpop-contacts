const { app, BrowserWindow, shell, Menu, ipcMain, dialog, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const store = require('./store')

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

// ── Anthropic API key (used for PDF parsing) ──
// Resolution order: a key the user typed in Settings (encrypted in userData)
// overrides a dev fallback. The dev fallback comes from the ANTHROPIC_API_KEY
// env var, or a gitignored `apikey.local.js` when running from source. Keys are
// never bundled into packaged builds — distributed apps are safe to share, and
// each user pastes their own key into Settings once.
let DEV_API_KEY = ''
try { DEV_API_KEY = String(require('./apikey.local') || '').trim() } catch {}
function getBuiltinApiKey() {
  return String(process.env.ANTHROPIC_API_KEY || '').trim() || DEV_API_KEY
}

let apiKeyFile = null
app.whenReady().then(() => {
  apiKeyFile = path.join(app.getPath('userData'), 'api-key.bin')
  // One-time seed: if no key is in encrypted storage yet but a dev key is
  // available, persist it so packaged builds (which carry no key) find it.
  const dev = getBuiltinApiKey()
  if (dev && !getUserApiKey()) storeApiKey(dev)
})

// The user's typed-in override key, if any.
function getUserApiKey() {
  try {
    if (!apiKeyFile) return null
    const buf = fs.readFileSync(apiKeyFile)
    return safeStorage.decryptString(buf) || null
  } catch { return null }
}

// The key actually used to call Anthropic: user override, else built-in.
function getEffectiveApiKey() {
  return getUserApiKey() || getBuiltinApiKey()
}

function storeApiKey(key) {
  if (!apiKeyFile) return
  if (!key) { try { fs.unlinkSync(apiKeyFile) } catch {} return }
  fs.writeFileSync(apiKeyFile, safeStorage.encryptString(key))
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function callClaudeDirect(body, apiKey) {
  // Retry transient failures (429 rate limit, 5xx, network drop) with backoff.
  // A 4xx other than 429 is a real request problem — fail fast, don't retry.
  const MAX_ATTEMPTS = 3
  let lastErr = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (netErr) {
      lastErr = netErr // network/DNS error — retryable
      if (attempt < MAX_ATTEMPTS) { briefProgress(`Network error — retrying (${attempt}/${MAX_ATTEMPTS})…`); await sleep(attempt * 1500); continue }
      throw new Error('Network error reaching Anthropic: ' + (netErr?.message || netErr))
    }
    if (res.ok) return res.json()

    const retryable = res.status === 429 || res.status >= 500
    const err = await res.json().catch(() => ({}))
    lastErr = new Error(err.error?.message || `Anthropic error ${res.status}`)
    if (retryable && attempt < MAX_ATTEMPTS) {
      const wait = (Number(res.headers.get('retry-after')) || attempt * 2) * 1000
      briefProgress(`Anthropic ${res.status} — retrying in ${Math.round(wait / 1000)}s (${attempt}/${MAX_ATTEMPTS})…`)
      await sleep(wait)
      continue
    }
    throw lastErr
  }
  throw lastErr || new Error('Anthropic request failed')
}

function briefProgress(msg) {
  console.log('[brief]', msg)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('brief:progress', msg)
  }
}

// Extract hyperlink URIs from raw PDF bytes (URI annotation metadata, not visible text)
function extractPdfUris(buffer) {
  // Known music/streaming hosts to keep…
  const MUSIC_HOSTS = ['youtube.com/watch', 'youtu.be/', 'youtube.com/playlist', 'music.youtube.com',
    'open.spotify.com/track', 'open.spotify.com/album', 'open.spotify.com/playlist', 'open.spotify.com/artist',
    'spotify.link/', 'soundcloud.com', 'on.soundcloud.com', 'music.apple.com', 'tidal.com', 'listen.tidal.com',
    'audius.co', 'audiomack.com', 'bandcamp.com', 'deezer.com', 'vimeo.com',
    's.disco.ac', 'disco.ac', 'untitled.stream', 'somespecialmagic.com', 'box.com', 'dropbox.com', 'drive.google.com',
    'wetransfer.com', 'we.tl/']
  // …plus anything that looks like a streaming/sharing link by keyword, so new
  // platforms aren't silently dropped just because they're not in the list.
  const KEYWORDS = /(stream|listen|music|track|album|playlist|audio|song|demo|ref)/i
  const raw = buffer.toString('latin1')
  const uris = []
  const re = /\/URI\s*\(([^)]+)\)/g
  let m
  while ((m = re.exec(raw)) !== null) {
    const u = m[1].trim()
    if (!/^https?:\/\//i.test(u)) continue
    if (MUSIC_HOSTS.some(h => u.includes(h)) || KEYWORDS.test(u)) uris.push(u)
  }
  return [...new Set(uris)]
}

// Anthropic caps a request near 32MB and base64 inflates a PDF by ~33%, so the
// raw file has to stay under ~24MB. Cap at 20MB for headroom + a clear message.
const MAX_PDF_BYTES = 20 * 1024 * 1024
function assertPdfSize(filePath) {
  const stat = fs.statSync(filePath)
  if (stat.size > MAX_PDF_BYTES) {
    const mb = (stat.size / 1024 / 1024).toFixed(1)
    throw new Error(`This PDF is ${mb}MB — too large to parse (max 20MB). Try exporting a lighter version or splitting it.`)
  }
}

// ── Claude API: parse a brief PDF ──
async function parseBriefPdf(filePath) {
  const apiKey = getEffectiveApiKey()
  if (!apiKey) {
    const e = new Error('NO_API_KEY')
    e.code = 'NO_API_KEY'
    throw e
  }

  const buffer = fs.readFileSync(filePath)
  briefProgress(`Read file: ${filePath} (${(buffer.length / 1024).toFixed(0)} KB)`)
  const base64 = buffer.toString('base64')

  const musicUris = extractPdfUris(buffer)
  const uriHint = musicUris.length > 0
    ? `\n\nThe following music/reference URLs were extracted from PDF hyperlink annotations (not visible as text). Match them to the reference entries you find in each artist section:\n${musicUris.join('\n')}`
    : ''

  briefProgress(`Encoded to base64 (${(base64.length / 1024).toFixed(0)} KB) — sending to Claude…`)

  const prompt = `Extract all brief information from this PDF and return valid JSON matching this schema exactly:
{
  "label": "string",
  "submission_emails": ["string"],
  "contacts": [{ "name": "string or null", "email": "string", "role": "string or null" }],
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
- label: the issuing label name (e.g. "SM Entertainment"). The source PDF filename is "${path.basename(filePath)}" — if the label is not stated inside the document, infer it from the filename (it often appears as a bracketed prefix like "[STARSHIP]"). Never leave label empty when the filename carries one.
- submission_emails: all email addresses from the cover/intro page.
- contacts: named people listed as submission contacts or "who to contact." Include email. name and role are null if not stated. Omit entries with no email.
- artists: one entry per artist section in the PDF.
- deadline: extract as-is ("ASAP", "By May 8th", "early June"). null if not stated.
- general_direction: the full verbatim text of the [General Direction] block if present, else null. Do NOT summarise, rephrase, or truncate — copy every word exactly as written, including trailing phrases like "for direction" or similar.
- tags: hashtags found in the track type heading (e.g. #GenZ_Energy). Empty array if none.
- wants: bullet points describing what they want. Also include items under "Please include:". Copy each bullet verbatim.
- avoids: bullet points explicitly under a "Please avoid:" heading only. Do NOT move bullets from the General Direction block into avoids even if they contain the word "avoid".
- references: song/music references for each track type. Include any reference that has or can be matched to a URL. Use the extracted hyperlink URLs provided below to supply the url field — match each URL to the reference text near it in the PDF. If a reference has no matchable URL, still include it with url set to "". Empty array only if truly no references exist.
Return ONLY the JSON object. No markdown, no code fences, no explanation.${uriHint}`

  briefProgress('Calling Anthropic…')
  const data = await callClaudeDirect({
    model: 'claude-sonnet-4-6',
    max_tokens: 16384,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: prompt },
      ],
    }],
  }, apiKey)

  briefProgress('Claude responded — parsing JSON…')

  // If the model hit the token ceiling the JSON is cut off mid-object and will
  // fail to parse — give a clear cause instead of a cryptic "unparseable JSON".
  if (data.stop_reason === 'max_tokens') {
    throw new Error('This brief is too long to parse in one pass (response hit the token limit). Try splitting the PDF into fewer artists.')
  }

  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  if (!text) throw new Error('No response from Claude')

  // Strip markdown code fences if present
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const match = stripped.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Claude did not return a JSON object')

  let parsed
  try { parsed = JSON.parse(match[0]) }
  catch (e) {
    console.log('[brief] JSON parse error:', e.message, '— text:', stripped.slice(0, 300))
    throw new Error('Claude returned unparseable JSON: ' + e.message)
  }
  briefProgress(`Parsed: ${parsed.artists?.length ?? 0} artists, label: ${parsed.label}`)
  return parsed
}

// ── IPC handlers ──

// Config (Anthropic API key)
ipcMain.handle('get-config', () => ({ anthropicApiKey: getUserApiKey() || '', hasKey: !!getEffectiveApiKey() }))
ipcMain.handle('set-config', (_, cfg) => { if ('anthropicApiKey' in cfg) storeApiKey(cfg.anthropicApiKey); return true })

// Local store
ipcMain.handle('store:load', () => store.loadBriefs())
ipcMain.handle('store:save', (_, { briefs }) => store.saveBriefs(briefs))

// Backup / export — local-only app, so give the user a way to get their data out.
ipcMain.handle('store:export', async () => {
  const stamp = new Date().toISOString().slice(0, 10)
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Briefs Backup',
    defaultPath: path.join(app.getPath('downloads'), `briefs-backup-${stamp}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  fs.writeFileSync(filePath, JSON.stringify(store.loadBriefs(), null, 2))
  return { ok: true, filePath }
})

ipcMain.handle('store:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Briefs Backup',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (canceled || !filePaths[0]) return { ok: false, canceled: true }
  let parsed
  try { parsed = JSON.parse(fs.readFileSync(filePaths[0], 'utf8')) }
  catch (e) { return { ok: false, error: 'Not a valid JSON file' } }
  if (!Array.isArray(parsed)) return { ok: false, error: 'Backup file does not contain a briefs array' }
  return { ok: true, briefs: parsed }
})

ipcMain.handle('store:reveal', () => {
  const file = path.join(app.getPath('userData'), 'briefs.json')
  if (fs.existsSync(file)) shell.showItemInFolder(file)
  else shell.openPath(app.getPath('userData'))
  return true
})

// Import / parse
ipcMain.handle('briefs:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Brief PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  })
  if (canceled || filePaths.length === 0) return null
  const filePath = filePaths[0]
  assertPdfSize(filePath)
  const parsed = await parseBriefPdf(filePath)
  parsed._sourcePdf = path.basename(filePath)
  return parsed
})

ipcMain.handle('briefs:importFromPath', async (_, { filePath }) => {
  assertPdfSize(filePath)
  const parsed = await parseBriefPdf(filePath)
  parsed._sourcePdf = path.basename(filePath)
  return parsed
})

ipcMain.handle('briefs:openSource', async (_, { filename, knownPath }) => {
  // If we resolved this PDF's full path before, try it first so we don't
  // re-prompt every time the file lives outside the standard folders.
  if (knownPath) {
    try { await fs.promises.access(knownPath); await shell.openPath(knownPath); return { found: true, path: knownPath } } catch {}
  }
  // Strip any path components — only ever resolve a bare filename inside known dirs.
  const safe = path.basename(String(filename || ''))
  if (!safe) return { found: false }
  const home = app.getPath('home')
  const candidates = [
    path.join(home, 'Downloads', safe),
    path.join(home, 'Desktop', safe),
    path.join(home, 'Documents', safe),
  ]
  for (const p of candidates) {
    try { await fs.promises.access(p); await shell.openPath(p); return { found: true, path: p } } catch {}
  }
  const { filePaths } = await dialog.showOpenDialog({
    title: `Locate "${safe}"`,
    defaultPath: app.getPath('downloads'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  })
  if (filePaths && filePaths[0]) { await shell.openPath(filePaths[0]); return { found: true, path: filePaths[0] } }
  return { found: false }
})

// ── Window ──
// ── Updates (packaged builds only; pulls from GitHub releases) ──
// Checks happen automatically, but nothing downloads or installs until the
// user explicitly clicks Update (Settings button or the app menu).
// Two-stage flow: click once to download, click again to install + restart.
// Download state lives here (not in the renderer) so reopening Settings
// mid-download shows the real progress instead of resetting.
let updater = null
let availableVersion = null
let downloading = false
let downloadProgress = null
let downloaded = false
let menuDownload = false // download was started from the app-menu dialog

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function setupAutoUpdate() {
  if (!app.isPackaged) return
  try { updater = require('electron-updater').autoUpdater } catch { return }
  updater.autoDownload = false
  updater.on('update-available', (info) => {
    availableVersion = info.version
    sendToWindow('update:available', info.version)
  })
  updater.on('download-progress', (p) => {
    downloadProgress = Math.round(p.percent)
    sendToWindow('update:progress', downloadProgress)
  })
  updater.on('update-downloaded', async () => {
    downloading = false
    downloaded = true
    sendToWindow('update:downloaded', availableVersion)
    if (menuDownload) {
      menuDownload = false
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: `Briefs ${availableVersion} downloaded`,
        detail: 'The app will restart to finish updating.',
        buttons: ['Update & Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      if (response === 0) updater.quitAndInstall()
    }
  })
  updater.on('error', (err) => {
    console.log('[update]', err?.message || err)
    if (downloading) {
      downloading = false
      downloadProgress = null
      sendToWindow('update:error', String(err?.message || err))
    }
  })
  updater.checkForUpdates().catch(() => {})
  setInterval(() => updater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000)
}

function downloadUpdate() {
  if (!updater || !availableVersion) return false
  if (downloaded) { sendToWindow('update:downloaded', availableVersion); return true }
  if (downloading) return true
  downloading = true
  downloadProgress = null
  updater.downloadUpdate().catch((err) => {
    console.log('[update]', err?.message || err)
    if (downloading) {
      downloading = false
      downloadProgress = null
      sendToWindow('update:error', String(err?.message || err))
    }
  })
  return true
}

function installUpdate() {
  if (!updater || !downloaded) return false
  updater.quitAndInstall()
  return true
}

async function checkForUpdatesManually() {
  if (!updater) {
    dialog.showMessageBox({ message: 'Updates only work in the installed app, not when running from source.' })
    return
  }
  try {
    const res = await updater.checkForUpdates()
    const latest = res?.updateInfo?.version
    if (!latest || latest === app.getVersion()) {
      dialog.showMessageBox({ message: "You're up to date", detail: `Briefs ${app.getVersion()} is the latest version.` })
    } else {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: `Briefs ${latest} is available`,
        detail: `You have ${app.getVersion()}. You'll be asked to confirm once the download finishes.`,
        buttons: ['Download Update', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      if (response === 0) {
        menuDownload = true
        downloadUpdate()
      }
    }
  } catch (err) {
    dialog.showMessageBox({ type: 'error', message: 'Update check failed', detail: String(err?.message || err) })
  }
}

ipcMain.handle('update:get', () => ({
  current: app.getVersion(),
  available: availableVersion,
  downloading,
  progress: downloadProgress,
  downloaded,
}))
ipcMain.handle('update:download', () => downloadUpdate())
ipcMain.handle('update:install', () => installUpdate())
ipcMain.handle('update:check', () => checkForUpdatesManually())

let mainWindow = null

function createWindow() {
  const win = new BrowserWindow({
    width: 880,
    height: 840,
    minWidth: 620,
    minHeight: 500,
    title: 'Briefs',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#0E0C0A',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow = win
  win.on('closed', () => { mainWindow = null })
  win.loadFile('index.html')

  // window.open() (ref-pill links, mailto) goes to the default browser / mail client
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
        { label: 'Check for Updates…', click: checkForUpdatesManually },
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
  store.init(app.getPath('userData'))
  buildMenu()
  createWindow()
  setupAutoUpdate()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
