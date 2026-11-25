const projectUrl = 'https://tuaotxsdvhatdwgcurti.supabase.co'
const publishableKey = 'sb_publishable_Lg-gj43yXfs78IBoNJeuXA_6vZcaNfp'
const browserStorageKey = 'calorieDailyUsageBrowser'
const managerStorageKey = 'calorieDailyManagerSession'
const authResult = new URLSearchParams(location.hash.slice(1))
const hasAuthResult = authResult.has('access_token') || authResult.has('error_code')
const adminMode = hasAuthResult || new URLSearchParams(location.search).has('usage-admin')
const returnedToken = authResult.get('access_token')
if (hasAuthResult) {
  const url = new URL(location.href)
  url.hash = ''
  url.searchParams.delete('usage-admin')
  history.replaceState(null, '', url)
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
const login = panel.querySelector('form')
const email = login.querySelector('[name="email"]')
const submit = login.querySelector('button')
const status = panel.querySelector('[role="status"]')
const report = panel.querySelector('#usageReport')
const period = report.querySelector('select')
const rows = report.querySelector('tbody')
const signOutButton = panel.querySelector('#usageSignOut')
let session = readSession()
let expiryTimer
let reportRequest = 0

function readSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(managerStorageKey))
    if (stored?.token && stored.expiresAt > Date.now()) return stored
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
  updateAdminButton()
}

function clearReport(message = '') {
  reportRequest++
  rows.replaceChildren()
  report.hidden = true
  login.hidden = false
  status.textContent = message
}

function updateAdminButton() {
  adminButton.textContent = session ? 'נתוני שימוש' : 'כניסת מנהל'
  clearTimeout(expiryTimer)
  if (session) {
    expiryTimer = setTimeout(() => {
      saveSession(null)
      clearReport('פג תוקף הכניסה. אפשר לבקש קישור חדש.')
    }, Math.max(0, session.expiresAt - Date.now()))
  }
}

async function loadReport(token) {
  const requestId = ++reportRequest
  status.textContent = 'טוען נתוני שימוש…'
  try {
    const data = await request('/rest/v1/rpc/calorie_usage_summary', {
      days: Number(period.value),
    }, token)
    if (requestId !== reportRequest) return
    if (session?.token !== token) {
      const expiresAt = Number(authResult.get('expires_at')) * 1000
      const duration = Number(authResult.get('expires_in')) * 1000
      const fallback = duration > 0 ? Date.now() + duration : Date.now() + 60 * 60 * 1000
      const deadline = Math.min(expiresAt > 0 ? expiresAt : fallback, Date.now() + 60 * 60 * 1000)
      if (deadline > Date.now()) saveSession({ token, expiresAt: deadline })
    }
    rows.replaceChildren(...data.map(entry => {
      const row = document.createElement('tr')
      for (const value of [entry.day, entry.opens, entry.browsers, entry.install_clicks, entry.installs]) {
        const cell = row.insertCell()
        cell.textContent = value
      }
      return row
    }))
    report.hidden = false
    login.hidden = true
    status.textContent = ''
  } catch (error) {
    if (requestId !== reportRequest) return
    if (error.message === '401' || error.message === '403') {
      if (session?.token === token) saveSession(null)
      clearReport('אין גישה לנתוני השימוש. היכנס שוב עם מייל המנהל.')
    } else {
      status.textContent = 'לא ניתן לטעון את הנתונים כרגע. אפשר לסגור ולפתוח שוב.'
    }
  }
}

function openAdmin() {
  if (!panel.open) panel.showModal()
  if (session?.expiresAt <= Date.now()) saveSession(null)
  if (session) void loadReport(session.token)
  else email.focus()
}

adminButton.addEventListener('click', openAdmin)
signOutButton.addEventListener('click', () => {
  saveSession(null)
  clearReport()
  email.focus()
})
period.addEventListener('change', () => {
  if (session) void loadReport(session.token)
})
window.addEventListener('storage', event => {
  if (event.key !== managerStorageKey && event.key !== null) return
  session = readSession()
  updateAdminButton()
  if (!session) clearReport()
  else if (panel.open) void loadReport(session.token)
})
login.addEventListener('submit', async event => {
  event.preventDefault()
  submit.disabled = true
  try {
    await request('/auth/v1/otp', { email: email.value.trim(), create_user: true })
    status.textContent = 'פתח את קישור הכניסה שנשלח אליך במייל.'
  } catch {
    status.textContent = 'לא ניתן לשלוח קישור כניסה. בדוק את כתובת המייל ונסה שוב.'
  } finally {
    submit.disabled = false
  }
})

updateAdminButton()
if (adminMode) {
  if (returnedToken) {
    panel.showModal()
    void loadReport(returnedToken)
  } else {
    openAdmin()
    if (hasAuthResult) status.textContent = 'קישור הכניסה פג או אינו תקין. בקש קישור חדש.'
  }
}
