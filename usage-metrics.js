const projectUrl = 'https://tuaotxsdvhatdwgcurti.supabase.co'
const publishableKey = 'sb_publishable_Lg-gj43yXfs78IBoNJeuXA_6vZcaNfp'
const browserStorageKey = 'calorieDailyUsageBrowser'
const authResult = new URLSearchParams(location.hash.slice(1))
const hasAuthResult = authResult.has('access_token') || authResult.has('error_code')
const adminMode = hasAuthResult || new URLSearchParams(location.search).has('usage-admin')
const returnedToken = authResult.get('access_token')
if (hasAuthResult) {
  const url = new URL(location.href)
  url.hash = ''
  url.searchParams.set('usage-admin', '1')
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
if (adminMode) {
  panel.hidden = false
  const login = panel.querySelector('form')
  const email = login.querySelector('[name="email"]')
  const submit = login.querySelector('button')
  const status = panel.querySelector('[role="status"]')
  const report = panel.querySelector('#usageReport')
  const period = report.querySelector('select')
  const rows = report.querySelector('tbody')

  async function loadReport() {
    const data = await request('/rest/v1/rpc/calorie_usage_summary', {
      days: Number(period.value),
    }, returnedToken)
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
  }

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
  if (returnedToken) {
    void loadReport().catch(() => {
      status.textContent = 'לא ניתן להציג נתוני שימוש. היכנס עם חשבון המנהל.'
    })
  } else if (hasAuthResult) {
    status.textContent = 'קישור הכניסה פג או אינו תקין. בקש קישור חדש.'
  }

  period.addEventListener('change', () => {
    void loadReport().catch(() => {
      rows.replaceChildren()
      status.textContent = 'לא ניתן לטעון את הנתונים. רענן את הדף והיכנס שוב.'
    })
  })
}
