const { createClient } = require('@supabase/supabase-js')
const path = require('path')
const fs = require('fs')

let supabase = null

function makeStorage(filePath) {
  return {
    getItem(key) {
      try { return JSON.parse(fs.readFileSync(filePath, 'utf8'))[key] ?? null }
      catch { return null }
    },
    setItem(key, value) {
      let d = {}
      try { d = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch {}
      d[key] = value
      fs.writeFileSync(filePath, JSON.stringify(d))
    },
    removeItem(key) {
      let d = {}
      try { d = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch {}
      delete d[key]
      fs.writeFileSync(filePath, JSON.stringify(d))
    },
  }
}

function init(userDataPath, supabaseUrl, supabaseAnonKey) {
  const sessionFile = path.join(userDataPath, 'sb-session.json')
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: makeStorage(sessionFile),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
}

function client() {
  if (!supabase) throw new Error('DB not initialised')
  return supabase
}

// ── Auth ──────────────────────────────────────────────────────────────────
async function signUp(email, password) {
  const { data, error } = await client().auth.signUp({
    email, password,
    options: { emailRedirectTo: 'kcontacts://auth/confirm' },
  })
  if (error) throw error
  return { user: data.user, session: data.session }
}

async function exchangeCodeForSession(code) {
  const { data, error } = await client().auth.exchangeCodeForSession(code)
  if (error) throw error
  return data.session ? { id: data.session.user.id, email: data.session.user.email } : null
}

async function signIn(email, password) {
  const { data, error } = await client().auth.signInWithPassword({ email, password })
  if (error) throw error
  return { user: data.user, session: data.session }
}

async function signOut() {
  const { error } = await client().auth.signOut()
  if (error) throw error
}

async function resetPassword(email) {
  const { error } = await client().auth.resetPasswordForEmail(email)
  if (error) throw error
}

async function getSession() {
  const { data: { session } } = await client().auth.getSession()
  if (!session) return null
  return { id: session.user.id, email: session.user.email }
}

async function getAccessToken() {
  const { data: { session } } = await client().auth.getSession()
  return session?.access_token ?? null
}

// ── Lists ─────────────────────────────────────────────────────────────────
async function getLists() {
  const sb = client()
  const { data: owned, error: e1 } = await sb
    .from('lists').select('*').order('created_at')
  if (e1) throw e1

  const { data: sharedRows, error: e2 } = await sb
    .from('list_shares').select('role, lists(*)')
  if (e2) throw e2

  const ownedWithRole = (owned || []).map(l => ({ ...l, role: 'owner' }))
  const sharedWithRole = (sharedRows || [])
    .filter(s => s.lists)
    .map(s => ({ ...s.lists, role: s.role }))

  // Dedupe (owner of a list that is also shared back)
  const seen = new Set()
  return [...ownedWithRole, ...sharedWithRole].filter(l => {
    if (seen.has(l.id)) return false
    seen.add(l.id); return true
  })
}

async function createList(name) {
  const { data: { user } } = await client().auth.getUser()
  const { data, error } = await client()
    .from('lists').insert({ name, owner_id: user.id }).select().single()
  if (error) throw error
  return { ...data, role: 'owner' }
}

async function renameList(id, name) {
  const { error } = await client().from('lists').update({ name }).eq('id', id)
  if (error) throw error
}

async function deleteList(id) {
  const { error } = await client().from('lists').delete().eq('id', id)
  if (error) throw error
}

// ── Artists ───────────────────────────────────────────────────────────────
async function getArtists(listId) {
  const { data, error } = await client()
    .from('artists').select('id, data').eq('list_id', listId).order('updated_at', { ascending: false })
  if (error) throw error
  return (data || []).map(r => ({ ...r.data, id: r.id }))
}

async function upsertArtist(listId, artist) {
  const { id, _scanning, ...rest } = artist
  const { error } = await client().from('artists').upsert({
    id,
    list_id: listId,
    data: rest,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (error) throw error
}

async function deleteArtistDb(artistId) {
  const { error } = await client().from('artists').delete().eq('id', artistId)
  if (error) throw error
}

// ── Share Tokens ──────────────────────────────────────────────────────────
async function createShareToken(listId, role) {
  const { data: { user } } = await client().auth.getUser()
  const { data, error } = await client()
    .from('share_tokens')
    .insert({ list_id: listId, role, created_by: user.id })
    .select('id')
    .single()
  if (error) throw error
  return data.id  // UUID used directly as the token
}

async function getShareTokens(listId) {
  const { data, error } = await client()
    .from('share_tokens')
    .select('*')
    .eq('list_id', listId)
    .order('created_at')
  if (error) throw error
  return data || []
}

async function deleteShareToken(tokenId) {
  const { error } = await client().from('share_tokens').delete().eq('id', tokenId)
  if (error) throw error
}

async function resolveShareToken(tokenId) {
  // Look up the token
  const { data: token, error } = await client()
    .from('share_tokens')
    .select('list_id, role, lists(name)')
    .eq('id', tokenId)
    .single()
  if (error || !token) throw new Error('Invalid or expired share link')

  // Get current user
  const { data: { user } } = await client().auth.getUser()
  if (!user) throw new Error('You must be signed in to use this link')

  // Check they don't already own this list
  const { data: owned } = await client()
    .from('lists').select('id').eq('id', token.list_id).eq('owner_id', user.id).maybeSingle()
  if (owned) return { listId: token.list_id, listName: token.lists?.name, role: 'owner', alreadyHad: true }

  // Add to list_shares
  const { error: shareErr } = await client()
    .from('list_shares')
    .upsert(
      { list_id: token.list_id, shared_with_email: user.email, role: token.role },
      { onConflict: 'list_id,shared_with_email' }
    )
  if (shareErr) throw shareErr

  return { listId: token.list_id, listName: token.lists?.name, role: token.role, alreadyHad: false }
}

// ── Contacts ──────────────────────────────────────────────────────────────
async function getContacts(listId) {
  const { data, error } = await client()
    .from('contacts').select('*').eq('list_id', listId).order('created_at')
  if (error) throw error
  return data || []
}

async function upsertContact(listId, contact) {
  const { list_id, created_at, ...rest } = contact
  const { error } = await client().from('contacts').upsert(
    { ...rest, list_id: listId, updated_at: new Date().toISOString() },
    { onConflict: 'id' }
  )
  if (error) throw error
}

async function deleteContact(contactId) {
  const { error } = await client().from('contacts').delete().eq('id', contactId)
  if (error) throw error
}

// ── Briefs ────────────────────────────────────────────────────────────────
async function getBriefs(listId) {
  const { data, error } = await client()
    .from('briefs').select('*').eq('list_id', listId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function upsertBrief(listId, brief) {
  const { list_id, created_at, ...rest } = brief
  const { error } = await client().from('briefs').upsert(
    { ...rest, list_id: listId },
    { onConflict: 'id' }
  )
  if (error) throw error
}

async function deleteBrief(briefId) {
  const { error } = await client().from('briefs').delete().eq('id', briefId)
  if (error) throw error
}

// ── Realtime ──────────────────────────────────────────────────────────────
let realtimeChannel = null
let contactsChannel = null

function subscribeArtists(listId, onEvent) {
  const sb = client()
  if (realtimeChannel) sb.removeChannel(realtimeChannel)
  realtimeChannel = sb
    .channel(`artists_${listId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'artists', filter: `list_id=eq.${listId}` }, onEvent)
    .subscribe()
}

function unsubscribeArtists() {
  if (!supabase || !realtimeChannel) return
  supabase.removeChannel(realtimeChannel)
  realtimeChannel = null
}

function subscribeContacts(listId, onEvent) {
  const sb = client()
  if (contactsChannel) sb.removeChannel(contactsChannel)
  contactsChannel = sb
    .channel(`contacts_${listId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter: `list_id=eq.${listId}` }, onEvent)
    .subscribe()
}

function unsubscribeContacts() {
  if (!supabase || !contactsChannel) return
  supabase.removeChannel(contactsChannel)
  contactsChannel = null
}

// ── Shares ────────────────────────────────────────────────────────────────
async function getShares(listId) {
  const { data, error } = await client()
    .from('list_shares').select('*').eq('list_id', listId).order('created_at')
  if (error) throw error
  return data || []
}

async function addShare(listId, email, role) {
  const { error } = await client().from('list_shares').upsert(
    { list_id: listId, shared_with_email: email.toLowerCase().trim(), role },
    { onConflict: 'list_id,shared_with_email' }
  )
  if (error) throw error
}

async function removeShare(shareId) {
  const { error } = await client().from('list_shares').delete().eq('id', shareId)
  if (error) throw error
}

module.exports = {
  init, signUp, signIn, signOut, resetPassword, getSession, getAccessToken, exchangeCodeForSession,
  getLists, createList, renameList, deleteList,
  getArtists, upsertArtist, deleteArtistDb,
  getContacts, upsertContact, deleteContact,
  getBriefs, upsertBrief, deleteBrief,
  getShares, addShare, removeShare,
  createShareToken, getShareTokens, deleteShareToken, resolveShareToken,
  subscribeArtists, unsubscribeArtists,
  subscribeContacts, unsubscribeContacts,
}
