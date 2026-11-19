const pairedKey = 'calorie-daily.widget-token'
const pendingKey = 'calorie-daily.widget-token-pending'
const installHash = '#home-widget-install'
const readyHash = '#home-widget-ready'
const endpoint = 'http://127.0.0.1:38349/balance'

export function connectBalanceWidget() {
  if (!/Android/i.test(navigator.userAgent) || !globalThis.crypto?.subtle) return () => {}
  const settings = document.getElementById('balanceWidgetSettings')
  const status = document.getElementById('balanceWidgetStatus')
  const setup = document.getElementById('setupBalanceWidget')
  const install = document.getElementById('installBalanceWidget')
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

  try {
    paired = localStorage.getItem(pairedKey)
    const key = paired || localStorage.getItem(pendingKey) || btoa(String.fromCharCode(
      ...crypto.getRandomValues(new Uint8Array(32))
    )).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    const fallback = encodeURIComponent(new URL(installHash, location.href).href)
    setup.href = `intent://activity/widget?key=${key}#Intent;scheme=caloriedaily;package=il.amosrrr.calories.sync;S.browser_fallback_url=${fallback};end`
    setup.addEventListener('click', () => localStorage.setItem(pendingKey, key))
  } catch {
    tell('כדי להוסיף ווידג׳ט, אפשר אחסון מקומי בכרום.')
    return () => {}
  }

  function handleHash() {
    if (location.hash !== installHash && location.hash !== readyHash) return
    const hash = location.hash
    history.replaceState(history.state, '', location.pathname + location.search)
    if (hash === installHash) {
      install.hidden = false
      tell('התקן את העדכון לרכיב הסנכרון, ואז לחץ שוב על הוספת ווידג׳ט.')
      settings.scrollIntoView({block:'nearest'})
      return
    }
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
    if (document.visibilityState === 'visible') send()
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
