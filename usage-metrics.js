const projectUrl = 'https://tuaotxsdvhatdwgcurti.supabase.co'
const publishableKey = 'sb_publishable_Lg-gj43yXfs78IBoNJeuXA_6vZcaNfp'
const browserStorageKey = 'calorieDailyUsageBrowser'
const managerStorageKey = 'calorieDailyManagerSession'
const oauthVerifierKey = 'calorieDailyGitHubVerifier'
const returnUrl = 'https://amosrrr-lab.github.io/calorie-daily/'
const callbackUrl = new URL(location.href)
const authResult = new URLSearchParams(callbackUrl.hash.slice(1))
const authCode = callbackUrl.searchParams.get('code')
const hasAuthResult = Boolean(authCode) || authResult.has('access_token')
  || authResult.has('error_code') || callbackUrl.searchParams.has('error_code')
const adminMode = hasAuthResult || callbackUrl.searchParams.has('usage-admin')
const returnedToken = authResult.get('access_token')
const returnedRefreshToken = authResult.get('refresh_token')
if (hasAuthResult) {
  callbackUrl.hash = ''
  for (const param of ['code', 'error', 'error_code', 'error_description', 'usage-admin']) {
    callbackUrl.searchParams.delete(param)
  }
  history.replaceState(null, '', callbackUrl)
}

async function request(path, payload, token) {
  const headers = { apikey: publishableKey, 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${projectUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    keepalive: !token && path.endsWith('/record_calorie_usage'),
  })
  if (!response.ok) throw new Error(String(response.status))
  return response.status === 204 ? null : response.json()
}

function record(eventName) {
  try {
    let browserId = localStorage.getItem(browserStorageKey)
    if (!browserId) {
      browserId = crypto.randomUUID()
      localStorage.setItem(browserStorageKey, browserId)
    }
    void request('/rest/v1/rpc/record_calorie_usage', {
      event_name: eventName,
      browser_id: browserId,
    }).catch(() => {})
  } catch {
    // Usage measurement must not interfere with using the app.
  }
}

const installButton = document.querySelector('#usageInstall')
let installPrompt
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  installPrompt = event
  installButton.hidden = false
})
installButton.addEventListener('click', async () => {
  if (!installPrompt) return
  const prompt = installPrompt
  installPrompt = null
  installButton.hidden = true
  record('install_click')
  try {
    await prompt.prompt()
  } catch {
    // The browser may cancel the prompt before opening.
  }
})
window.addEventListener('appinstalled', () => {
  installPrompt = null
  installButton.hidden = true
  record('installed')
})

if (!adminMode) record('open')

const panel = document.querySelector('#usageAdmin')
const adminButton = document.querySelector('#usageAdminButton')
const activation = panel.querySelector('#usageActivation')
const githubButton = panel.querySelector('#usageGitHubSignIn')
const status = panel.querySelector('[role="status"]')
const report = panel.querySelector('#usageReport')
const period = report.querySelector('select')
const rows = report.querySelector('tbody')
const signOutButton = panel.querySelector('#usageSignOut')
let session = readSession()
let reportRequest = 0

function readSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(managerStorageKey))
    if (stored?.token && Number.isFinite(stored.expiresAt)) return stored
  } catch {
    // The app still works when browser storage is unavailable.
  }
  return null
}

function saveSession(next) {
  session = next
  try {
    if (next) localStorage.setItem(managerStorageKey, JSON.stringify(next))
    else localStorage.removeItem(managerStorageKey)
  } catch {
    // Continue with the current window's session when storage is unavailable.
  }
}

function clearReport(message = '') {
  reportRequest++
  rows.replaceChildren()
  report.hidden = true
  activation.hidden = false
  status.textContent = message
}

function makeSession(token, refreshToken, expiresIn, expiresAt) {
  const relativeExpiry = Date.now() + (Number(expiresIn) || 3600) * 1000
  return { token, refreshToken, expiresAt: Number(expiresAt) * 1000 || relativeExpiry }
}

async function getSession() {
  async function renewIfNeeded() {
    const current = readSession() ?? session
    if (!current) return null
    if (current.expiresAt > Date.now() + 30_000) return current
    if (!current.refreshToken) {
      saveSession(null)
      return null
    }
    try {
      const result = await request('/auth/v1/token?grant_type=refresh_token', {
        refresh_token: current.refreshToken,
      })
      const latest = readSession() ?? session
      if (latest?.token !== current.token) return latest
      const renewed = makeSession(result.access_token, result.refresh_token, result.expires_in)
      saveSession(renewed)
      return renewed
    } catch (error) {
      const latest = readSession() ?? session
      if (latest?.token !== current.token) return latest
      if (!['400', '401', '403'].includes(error.message)) throw error
      saveSession(null)
      return null
    }
  }

  // Chromium shares storage across the installed app and browser tabs.
  return navigator.locks
    ? navigator.locks.request(managerStorageKey, renewIfNeeded)
    : renewIfNeeded()
}

async function loadReport(callbackSession) {
  const requestId = ++reportRequest
  status.textContent = 'טוען נתוני שימוש…'
  let activeSession
  try {
    activeSession = callbackSession ?? await getSession()
    if (requestId !== reportRequest) return
    if (!activeSession) {
      clearReport()
      return
    }
    const data = await request('/rest/v1/rpc/calorie_usage_summary', {
      days: Number(period.value),
    }, activeSession.token)
    if (requestId !== reportRequest) return
    if (callbackSession) saveSession(callbackSession)
    rows.replaceChildren(...data.map(entry => {
      const row = document.createElement('tr')
      for (const value of [entry.day, entry.opens, entry.browsers, entry.install_clicks, entry.installs]) {
        const cell = row.insertCell()
        cell.textContent = value
      }
      return row
    }))
    report.hidden = false
    activation.hidden = true
    status.textContent = ''
  } catch (error) {
    if (requestId !== reportRequest) return
    if (['401', '403'].includes(error.message)) {
      if (session && session.token === activeSession?.token) saveSession(null)
      clearReport('הכניסה פגה או שאין לחשבון הרשאת מנהל.')
    } else {
      status.textContent = 'לא ניתן לטעון את הנתונים כרגע. אפשר לסגור ולפתוח שוב.'
    }
  }
}

function openAdmin(callbackSession) {
  if (!panel.open) panel.showModal()
  if (callbackSession || session) activation.hidden = true
  void loadReport(callbackSession)
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signInWithGitHub() {
  githubButton.disabled = true
  status.textContent = 'פותח כניסה דרך GitHub…'
  try {
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    localStorage.setItem(oauthVerifierKey, verifier)
    const redirect = new URL('/auth/v1/authorize', projectUrl)
    redirect.search = new URLSearchParams({
      provider: 'github',
      redirect_to: returnUrl,
      scopes: 'user:email',
      code_challenge: base64Url(new Uint8Array(digest)),
      code_challenge_method: 's256',
    })
    location.assign(redirect)
  } catch {
    status.textContent = 'לא ניתן לפתוח כניסה דרך GitHub כרגע.'
    githubButton.disabled = false
  }
}

async function finishGitHubSignIn() {
  if (!panel.open) panel.showModal()
  activation.hidden = true
  status.textContent = 'בודק הרשאת מנהל…'
  try {
    const verifier = localStorage.getItem(oauthVerifierKey)
    if (!verifier) throw new Error('Missing sign-in verifier')
    localStorage.removeItem(oauthVerifierKey)
    const result = await request('/auth/v1/token?grant_type=pkce', {
      auth_code: authCode,
      code_verifier: verifier,
    })
    await loadReport(makeSession(result.access_token, result.refresh_token, result.expires_in))
  } catch {
    clearReport('לא ניתן להשלים את הכניסה. אפשר לנסות שוב דרך GitHub.')
  }
}

adminButton.addEventListener('click', () => {
  if (session) openAdmin()
  else {
    if (!panel.open) panel.showModal()
    void signInWithGitHub()
  }
})
githubButton.addEventListener('click', signInWithGitHub)
signOutButton.addEventListener('click', async () => {
  const current = session
  saveSession(null)
  clearReport()
  if (current) {
    await request('/auth/v1/logout?scope=local', {}, current.token).catch(() => {})
  }
})
period.addEventListener('change', () => { void loadReport() })
window.addEventListener('storage', event => {
  if (event.key !== managerStorageKey && event.key !== null) return
  const next = readSession()
  const changed = next?.token !== session?.token
  session = next
  if (!session) clearReport()
  else if (panel.open && changed) void loadReport()
})

if (adminMode) {
  if (authCode) {
    void finishGitHubSignIn()
  } else if (returnedToken) {
    openAdmin(makeSession(returnedToken, returnedRefreshToken,
      authResult.get('expires_in'), authResult.get('expires_at')))
  } else if (hasAuthResult) {
    if (!panel.open) panel.showModal()
    clearReport('הכניסה דרך GitHub לא הושלמה.')
  } else {
    openAdmin()
  }
}
