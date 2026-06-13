const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('briefs', {
  // Config (Anthropic API key, stored encrypted)
  getConfig: ()    => ipcRenderer.invoke('get-config'),
  setConfig: (cfg) => ipcRenderer.invoke('set-config', cfg),

  // Import / parse
  importBriefPdf:         ()         => ipcRenderer.invoke('briefs:import'),
  importBriefPdfFromPath: (filePath) => ipcRenderer.invoke('briefs:importFromPath', { filePath }),
  getPathForFile:         (file)     => webUtils.getPathForFile(file),
  openBriefSource:        (filename) => ipcRenderer.invoke('briefs:openSource', { filename }),

  // Local store
  loadBriefs: ()        => ipcRenderer.invoke('store:load'),
  saveBriefs: (briefs)  => ipcRenderer.invoke('store:save', { briefs }),

  // Parse progress (console only)
  onBriefProgress: (cb) => {
    ipcRenderer.removeAllListeners('brief:progress')
    ipcRenderer.on('brief:progress', (_, msg) => cb(msg))
  },

  // Updates (two-stage: download, then install + restart)
  getUpdateInfo:  () => ipcRenderer.invoke('update:get'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate:  () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (cb) => {
    ipcRenderer.removeAllListeners('update:available')
    ipcRenderer.on('update:available', (_, version) => cb(version))
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.removeAllListeners('update:downloaded')
    ipcRenderer.on('update:downloaded', (_, version) => cb(version))
  },
  onUpdateProgress: (cb) => {
    ipcRenderer.removeAllListeners('update:progress')
    ipcRenderer.on('update:progress', (_, pct) => cb(pct))
  },
  onUpdateError: (cb) => {
    ipcRenderer.removeAllListeners('update:error')
    ipcRenderer.on('update:error', (_, msg) => cb(msg))
  },
})
