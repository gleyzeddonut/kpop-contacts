// Local persistence — briefs.json in userData. No cloud, no account.
const fs = require('fs')
const path = require('path')

let storeFile = null
let bakFile = null

function init(userDataPath) {
  storeFile = path.join(userDataPath, 'briefs.json')
  bakFile = path.join(userDataPath, 'briefs.bak.json')
}

function readJsonArray(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed : null
}

function loadBriefs() {
  if (!storeFile) return []
  // Try the live file first, then the last-known-good backup. A crash mid-write
  // can leave briefs.json truncated; falling back to .bak avoids silent total loss.
  try {
    const arr = readJsonArray(storeFile)
    if (arr) return arr
  } catch {}
  try {
    const arr = readJsonArray(bakFile)
    if (arr) {
      console.log('[store] briefs.json unreadable — recovered from backup')
      return arr
    }
  } catch {}
  return []
}

function saveBriefs(briefs) {
  if (!storeFile) return false
  const safe = Array.isArray(briefs) ? briefs : []
  const tmpFile = storeFile + '.tmp'
  try {
    // Promote the current good file to backup before we touch it.
    try { if (fs.existsSync(storeFile)) fs.copyFileSync(storeFile, bakFile) } catch {}
    // Atomic write: a full write to a temp file, then an atomic rename over the
    // real one. Readers never see a half-written briefs.json.
    const fd = fs.openSync(tmpFile, 'w')
    try {
      fs.writeFileSync(fd, JSON.stringify(safe, null, 2))
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmpFile, storeFile)
    return true
  } catch (e) {
    console.log('[store] save failed:', e?.message || e)
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile) } catch {}
    return false
  }
}

module.exports = { init, loadBriefs, saveBriefs }
