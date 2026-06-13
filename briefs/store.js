// Local persistence — briefs.json in userData. No cloud, no account.
const fs = require('fs')
const path = require('path')

let storeFile = null

function init(userDataPath) {
  storeFile = path.join(userDataPath, 'briefs.json')
}

function loadBriefs() {
  try {
    if (!storeFile) return []
    const raw = fs.readFileSync(storeFile, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveBriefs(briefs) {
  if (!storeFile) return false
  const safe = Array.isArray(briefs) ? briefs : []
  fs.writeFileSync(storeFile, JSON.stringify(safe, null, 2))
  return true
}

module.exports = { init, loadBriefs, saveBriefs }
