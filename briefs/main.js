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

async function callClaudeDirect(body, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Anthropic error ${res.status}`)
  }
  return res.json()
}

function briefProgress(msg) {
  console.log('[brief]', msg)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('brief:progress', msg)
  }
}

// Extract hyperlink URIs from raw PDF bytes (URI annotation metadata, not visible text)
function extractPdfUris(buffer) {
  const MUSIC_HOSTS = ['youtube.com/watch', 'youtu.be/', 'open.spotify.com/track', 'open.spotify.com/album',
    'open.spotify.com/playlist', 'soundcloud.com', 'music.apple.com', 's.disco.ac', 'untitled.stream',
    'somespecialmagic.com']
  const raw = buffer.toString('latin1')
  const uris = []
  const re = /\/URI\s*\(([^)]+)\)/g
  let m
  while ((m = re.exec(raw)) !== null) {
    const u = m[1].trim()
    if (MUSIC_HOSTS.some(h => u.includes(h))) uris.push(u)
  }
  return [...new Set(uris)]
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
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: prompt },
      ],
    }],
  }, apiKey)

  briefProgress('Claude responded — parsing JSON…')

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

// Import / parse
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

ipcMain.handle('briefs:openSource', async (_, { filename }) => {
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
    try { await fs.promises.access(p); await shell.openPath(p); return { found: true } } catch {}
  }
  const { filePaths } = await dialog.showOpenDialog({
    title: `Locate "${safe}"`,
    defaultPath: app.getPath('downloads'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  })
  if (filePaths && filePaths[0]) { await shell.openPath(filePaths[0]); return { found: true } }
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
