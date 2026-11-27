const sessionKey = 'calorieDailyCustomerSession'
const dateFormat = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeZone: 'Asia/Jerusalem' })

export function initCustomerAccess({ request, getManagerSession, recordTrialStep }) {
  const byId = id => document.getElementById(id)
  const journal = byId('commercialJournal')
  const visitorLanding = byId('visitorLanding')
  const settings = byId('settingsButton')
  const title = byId('accessTitle')
  const terms = byId('accessTerms')
  const status = byId('accessStatus')
  const login = byId('accessLogin')
  const email = byId('accessEmail')
  const code = byId('accessCode')
  const codeLabel = byId('accessCodeLabel')
  const signIn = byId('accessLoginButton')
  const changeEmail = byId('accessChangeEmail')
  const retry = byId('accessRetry')
  const payment = byId('accessPayment')
  const paymentForm = byId('accessPaymentForm')
  const payer = byId('accessPayer')
  const managerPanel = byId('accessManagerPayments')
  const managerList = byId('accessManagerList')
  const managerStatus = byId('accessManagerStatus')
  let session = readSession()
  let sentTo
  let expiryTimer
  let loading
  let version = 0
  let managerVersion = 0

  function rpc(name, body, auth) {
    return request('/rest/v1/rpc/' + name, body, auth.token)
  }

  function readSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(sessionKey))
      return saved?.token && Number.isFinite(saved.expiresAt) ? saved : null
    } catch {
      return null
    }
  }

  function saveSession(result) {
    session = result ? {
      token: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: Date.now() + Number(result.expires_in) * 1000,
    } : null
    try {
      if (session) localStorage.setItem(sessionKey, JSON.stringify(session))
      else localStorage.removeItem(sessionKey)
    } catch {
      // The current browser tab can still use the verified session.
    }
  }

  async function customerSession() {
    async function renew() {
      const current = readSession() ?? session
      if (!current || current.expiresAt > Date.now() + 30_000) return current
      if (!current.refreshToken) {
        saveSession(null)
        return null
      }
      try {
        const result = await request('/auth/v1/token?grant_type=refresh_token', {
          refresh_token: current.refreshToken,
        })
        saveSession(result)
        return session
      } catch (error) {
        if (!['400', '401', '403'].includes(error.message)) throw error
        saveSession(null)
        return null
      }
    }
    return navigator.locks ? navigator.locks.request(sessionKey, renew) : renew()
  }

  function setJournalAccess(active) {
    const opened = active && journal.hidden
    journal.inert = journal.hidden = settings.hidden = !active
    if (opened) document.dispatchEvent(new Event('calorie-access-ready'))
    if (!active) {
      for (const dialog of document.querySelectorAll('dialog[open]')) {
        if (!['usageAdmin', 'journalBackupDialog'].includes(dialog.id)) dialog.close()
      }
    }
  }

  function showAccess(access) {
    clearTimeout(expiryTimer)
    visitorLanding.hidden = Boolean(access)
    login.hidden = Boolean(access)
    setJournalAccess(Boolean(access?.active))
    payment.hidden = access?.state !== 'expired'
    terms.hidden = ['manager', 'paid', 'expired'].includes(access?.state)
    retry.hidden = true
    status.textContent = ''
    if (access?.state === 'manager') {
      title.textContent = 'חשבון מנהל'
      return
    }
    title.textContent = access?.state === 'paid' ? 'המנוי שלך'
      : access?.state === 'expired' ? 'תקופת הניסיון או המנוי הסתיימה'
        : '7 ימי ניסיון חינם'
    if (access?.active) {
      const end = new Date(access.access_until)
      status.textContent = `הגישה פתוחה עד ${dateFormat.format(end)}.`
      expiryTimer = setTimeout(() => {
        if (end.getTime() <= Date.now()) setJournalAccess(false)
        void refresh()
      }, Math.max(0, Math.min(86_400_000, end.getTime() - Date.now())))
    } else if (access) {
      byId('accessPaymentCode').textContent = access.payment_code.slice(0, 8)
      paymentForm.hidden = access.payment_pending
      status.textContent = access.payment_pending ? 'הדיווח התקבל ומחכה לאישור העברה.' : ''
      retry.hidden = !access.payment_pending
    }
  }

  function refresh() {
    if (loading) return loading
    const currentVersion = version
    loading = (async () => {
      try {
        const auth = await getManagerSession() ?? await customerSession()
        const access = auth ? await rpc('calorie_access_status', {}, auth) : null
        if (version === currentVersion && (auth || !sentTo)) showAccess(access)
      } catch {
        if (version === currentVersion) {
          status.textContent = 'בדיקת הגישה נכשלה. נסו שוב בעוד רגע.'
          retry.hidden = false
        }
      } finally {
        loading = null
      }
    })()
    return loading
  }

  async function refreshAfterSessionChange() {
    version++
    await loading
    return refresh()
  }

  function resetCodeForm() {
    sentTo = undefined
    code.value = ''
    email.readOnly = false
    codeLabel.hidden = code.hidden = changeEmail.hidden = true
    code.required = false
    signIn.textContent = 'שליחת קוד למייל'
  }

  changeEmail.addEventListener('click', () => {
    resetCodeForm()
    status.textContent = ''
    email.focus()
  })
  login.addEventListener('submit', async event => {
    event.preventDefault()
    signIn.disabled = true
    try {
      if (!sentTo) {
        const address = email.value.trim()
        recordTrialStep('code_request')
        await request('/auth/v1/otp', { email: address, create_user: true })
        recordTrialStep('code_sent')
        sentTo = address
        email.readOnly = true
        codeLabel.hidden = code.hidden = changeEmail.hidden = false
        code.required = true
        signIn.textContent = 'אימות וכניסה'
        status.textContent = 'הקוד נשלח למייל. הזינו אותו כאן.'
        code.focus()
      } else {
        const result = await request('/auth/v1/verify', { email: sentTo, token: code.value, type: 'email' })
        saveSession(result)
        resetCodeForm()
        await refreshAfterSessionChange()
      }
    } catch {
      status.textContent = sentTo ? 'הקוד שגוי או שפג תוקפו.' : 'לא הצלחנו לשלוח קוד. נסו שוב מאוחר יותר.'
    } finally {
      signIn.disabled = false
    }
  })

  retry.addEventListener('click', () => { void refresh() })
  paymentForm.addEventListener('submit', async event => {
    event.preventDefault()
    const submit = paymentForm.querySelector('button')
    submit.disabled = true
    try {
      const auth = await customerSession()
      if (!auth) throw new Error('Sign in required')
      const access = await rpc('calorie_report_payment', { payer_name: payer.value.trim() }, auth)
      payer.value = ''
      showAccess(access)
    } catch {
      status.textContent = 'הדיווח לא נשלח. אפשר לנסות שוב.'
    } finally {
      submit.disabled = false
    }
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh()
  })

  async function loadPayments() {
    const currentVersion = ++managerVersion
    try {
      const manager = await getManagerSession()
      if (!manager) return
      const pending = await rpc('calorie_pending_payments', {}, manager)
      if (currentVersion !== managerVersion) return
      managerList.replaceChildren(...pending.map(item => {
        const li = document.createElement('li')
        const details = document.createElement('p')
        details.textContent = `${item.payer_name} · ${dateFormat.format(new Date(item.requested_at))} · קוד ${item.payment_code.slice(0, 8)}`
        const approve = document.createElement('button')
        approve.type = 'button'
        approve.className = 'secondary'
        approve.textContent = 'אשר העברה'
        approve.addEventListener('click', async () => {
          if (!window.confirm('האם בדקת ב־PayBox שקיבלת 19.90 ₪ עם קוד התשלום הזה?')) return
          approve.disabled = true
          try {
            const currentManager = await getManagerSession()
            if (!currentManager) throw new Error('Manager sign-in required')
            await rpc('calorie_approve_payment', { request_id: item.id }, currentManager)
            await loadPayments()
          } catch {
            managerStatus.textContent = 'האישור לא נשמר. בדוק שוב את מצב הבקשה.'
            approve.disabled = false
          }
        })
        li.append(details, approve)
        return li
      }))
      managerStatus.textContent = pending.length ? '' : 'אין בקשות שממתינות לאישור.'
      managerPanel.hidden = false
    } catch {
      if (currentVersion !== managerVersion) return
      managerPanel.hidden = false
      managerStatus.textContent = 'לא ניתן לטעון את בקשות התשלום.'
    }
  }

  byId('accessManagerRefresh').addEventListener('click', () => { void loadPayments() })
  void refresh()
  return {
    managerSignedIn() {
      void refreshAfterSessionChange()
      void loadPayments()
    },
    managerSignedOut() {
      managerVersion++
      managerPanel.hidden = true
      managerList.replaceChildren()
      showAccess(null)
      void refreshAfterSessionChange()
    },
  }
}
