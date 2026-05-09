const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kc', {
  // Config
  getConfig:     ()                         => ipcRenderer.invoke('get-config'),
  setConfig:     (cfg)                      => ipcRenderer.invoke('set-config', cfg),

  // AI scan (legacy API key path)
  scanContacts:  (artistName, label)        => ipcRenderer.invoke('scan-contacts', { artistName, label }),
  scanArtist:    (artistName)               => ipcRenderer.invoke('scan-artist', { artistName }),

  // Auth
  signUp:         (email, password) => ipcRenderer.invoke('auth:signup',        { email, password }),
  signIn:         (email, password) => ipcRenderer.invoke('auth:signin',        { email, password }),
  signOut:        ()                => ipcRenderer.invoke('auth:signout'),
  getSession:     ()                => ipcRenderer.invoke('auth:getSession'),
  resetPassword:  (email)           => ipcRenderer.invoke('auth:resetPassword', { email }),
  exchangeCode:   (code)            => ipcRenderer.invoke('auth:exchangeCode',  { code }),

  // Lists
  getLists:      ()                         => ipcRenderer.invoke('lists:getAll'),
  createList:    (name)                     => ipcRenderer.invoke('lists:create',  { name }),
  renameList:    (id, name)                 => ipcRenderer.invoke('lists:rename',  { id, name }),
  deleteList:    (id)                       => ipcRenderer.invoke('lists:delete',  { id }),

  // Artists
  getArtists:    (listId)                   => ipcRenderer.invoke('artists:getAll', { listId }),
  upsertArtist:  (listId, artist)           => ipcRenderer.invoke('artists:upsert', { listId, artist }),
  deleteArtist:  (artistId)                 => ipcRenderer.invoke('artists:delete', { artistId }),

  // Shares
  getShares:     (listId)                   => ipcRenderer.invoke('shares:get',    { listId }),
  addShare:      (listId, email, role)      => ipcRenderer.invoke('shares:add',    { listId, email, role }),
  removeShare:   (shareId)                  => ipcRenderer.invoke('shares:remove', { shareId }),

  // Realtime
  subscribeToList:    (listId) => ipcRenderer.invoke('realtime:subscribe', { listId }),
  unsubscribeFromList: ()      => ipcRenderer.invoke('realtime:unsubscribe'),
  onArtistChange: (cb) => {
    ipcRenderer.removeAllListeners('realtime:change')
    ipcRenderer.on('realtime:change', (_, payload) => cb(payload))
  },

  // Share tokens
  createShareToken:  (listId, role) => ipcRenderer.invoke('tokens:create',  { listId, role }),
  getShareTokens:    (listId)       => ipcRenderer.invoke('tokens:getAll',  { listId }),
  deleteShareToken:  (tokenId)      => ipcRenderer.invoke('tokens:delete',  { tokenId }),
  resolveShareToken: (tokenId)      => ipcRenderer.invoke('tokens:resolve', { tokenId }),

  // Deep link
  onDeepLink: (cb) => {
    ipcRenderer.removeAllListeners('deep-link:share')
    ipcRenderer.on('deep-link:share', (_, token) => cb(token))
  },
  onDeepLinkConfirm: (cb) => {
    ipcRenderer.removeAllListeners('deep-link:confirm')
    ipcRenderer.on('deep-link:confirm', (_, payload) => cb(payload))
  },
})
