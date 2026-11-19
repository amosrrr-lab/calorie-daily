const pairedKey = 'calorie-daily.widget-token'
const pendingKey = 'calorie-daily.widget-token-pending'
const installHash = '#home-widget-install'
const launchFallback = 'widget-setup-unavailable'
const readyHash = '#home-widget-ready'
const endpoint = 'http://127.0.0.1:38349/balance'

export function connectBalanceWidget() {
  if (!/Android/i.test(navigator.userAgent) || !globalThis.crypto?.subtle) return () => {}
  const settings = document.getElementById('balanceWidgetSettings')
  const status = document.getElementById('balanceWidgetStatus')
  const setup = document.getElementById('setupBalanceWidget')
  const update = document.getElementById('updateBalanceWidgetComponent')
  settings.hidden = false
  const tell = (message) => {
    status.textContent = message
    status.hidden = false
  }

  let paired
  let latest
  let delivered
  let sending = false
  let retryAt = 0
  let announce = false
  let launchTimer

  function showLaunchHelp() {
    clearTimeout(launchTimer)
    tell('חלון הוספת הווידג׳ט לא נפתח. במסך הבית של סמסונג לחץ לחיצה ארוכה ובחר ״יישומונים״. אם ״יתרת קלוריות״ חסר ברשימה, עדכן את רכיב הסנכרון ונסה שוב.')
    update.hidden = false
    settings.scrollIntoView({block:'nearest'})
  }

  try {
    paired = localStorage.getItem(pairedKey)
    const key = paired || localStorage.getItem(pendingKey) || btoa(String.fromCharCode(
      ...crypto.getRandomValues(new Uint8Array(32))
    )).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    const fallbackUrl = new URL(location.href)
    fallbackUrl.hash = ''
    fallbackUrl.searchParams.set(launchFallback, '1')
    const fallback = encodeURIComponent(fallbackUrl.href)
    setup.href = `intent://activity/widget?key=${key}#Intent;scheme=caloriedaily;package=il.amosrrr.calories.sync;S.browser_fallback_url=${fallback};end`
    setup.addEventListener('click', (event) => {
      if (event.defaultPrevented) return
      try {
        localStorage.setItem(pendingKey, key)
      } catch {
        event.preventDefault()
        tell('כדי לחבר את הווידג׳ט, אפשר אחסון מקומי בכרום.')
        return
      }
      update.hidden = true
      tell('פותח את חלון ההוספה של אנדרואיד…')
      clearTimeout(launchTimer)
      launchTimer = setTimeout(() => {
        if (document.visibilityState === 'visible') showLaunchHelp()
      }, 2500)
    })
  } catch {
    tell('כדי להוסיף ווידג׳ט, אפשר אחסון מקומי בכרום.')
    return () => {}
  }

  function handleHash() {
    const url = new URL(location.href)
    if (url.searchParams.has(launchFallback) || url.hash === installHash) {
      url.searchParams.delete(launchFallback)
      if (url.hash === installHash) url.hash = ''
      history.replaceState(history.state, '', url)
      showLaunchHelp()
      return
    }
    if (url.hash !== readyHash) return
    url.hash = ''
    history.replaceState(history.state, '', url)
    clearTimeout(launchTimer)
    update.hidden = true
    const key = localStorage.getItem(pendingKey)
    if (!key) return
    localStorage.setItem(pairedKey, key)
    localStorage.removeItem(pendingKey)
    paired = key
    delivered = undefined
    retryAt = 0
    announce = true
    tell('אם כרום מבקש הרשאת חיבור מקומי, אשר כדי לעדכן את הווידג׳ט.')
    send()
  }

  async function send() {
    if (!paired || !latest || sending || latest === delivered || Date.now() < retryAt) return
    sending = true
    const value = latest
    try {
      const response = await fetch(endpoint, {
        method:'POST', targetAddressSpace:'loopback',
        headers:{'Content-Type':'application/json', 'Authorization':'Bearer ' + paired},
        body:value
      })
      if (!response.ok) throw new Error('Connection rejected')
      delivered = value
      if (announce) {
        tell('הווידג׳ט מחובר ומתעדכן כשהיתרה משתנה.')
        announce = false
      }
    } catch {
      retryAt = Date.now() + 10000
      if (announce) tell('הווידג׳ט ממתין לחיבור. בדוק אם כרום ביקש הרשאה או פתח שוב את הגדרת הווידג׳ט.')
    } finally {
      sending = false
      if (value !== latest && Date.now() >= retryAt) send()
    }
  }

  addEventListener('hashchange', handleHash)
  addEventListener('storage', (event) => {
    if (event.key !== pairedKey) return
    paired = event.newValue
    retryAt = 0
    delivered = undefined
    send()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearTimeout(launchTimer)
    else send()
  })
  setInterval(() => {
    if (document.visibilityState === 'visible') send()
  }, 15000)
  handleHash()
  return (balance) => {
    latest = JSON.stringify(balance)
    send()
  }
}
