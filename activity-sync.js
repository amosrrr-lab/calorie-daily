const pendingKey = 'calorie-daily.health-sync.pending'
const responsePrefix = '#activity-sync='
const installHash = '#install-activity-sync'
const expiresAfter = 10 * 60 * 1000
const site = 'https://amosrrr-lab.github.io/calorie-daily/'

const encode = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const decode = (text) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (character) => character.charCodeAt(0))

export function connectWebActivity({dayKey, weight, journalKey, currentSource, refreshJournal, save, notify}) {
  if (!/Android/i.test(navigator.userAgent) || !globalThis.crypto?.subtle) return

  const get = (id) => document.getElementById(id)
  const source = get('webActivitySource')
  const sync = get('webActivitySync')
  const status = get('webActivityStatus')
  get('webActivityHint').hidden = false
  if (currentSource() === 'samsung') source.value = 'samsung'

  sync.addEventListener('click', (event) => {
    if (event.defaultPrevented) return
    try {
      const key = encode(crypto.getRandomValues(new Uint8Array(32)))
      localStorage.setItem(pendingKey, JSON.stringify({key, source:source.value, expires:Date.now() + expiresAfter}))
      const fallback = encodeURIComponent(site + installHash)
      sync.href = `intent://activity/sync?key=${key}&source=${source.value}#Intent;scheme=caloriedaily;package=il.amosrrr.calories.sync;S.browser_fallback_url=${fallback};end`
    } catch {
      event.preventDefault()
      status.textContent = 'אין גישה לאחסון המקומי בכרום. פתח את האפליקציה מחוץ למצב גלישה בסתר.'
    }
  })

  function clearHash() {
    history.replaceState(history.state, '', location.pathname + location.search)
  }

  function handleHash() {
    if (location.hash === installHash) {
      clearHash()
      status.textContent = 'כדי להתחבר לשעון, לחץ על ״התקנת רכיב סנכרון״ ולאחר ההתקנה לחץ שוב על ״סנכרון פעילות״.'
      const dialog = get('activityDialog')
      if (!dialog.open && !document.querySelector('dialog[open]')) dialog.showModal()
      else notify(status.textContent)
      return
    }
    if (location.hash.startsWith(responsePrefix)) {
      const response = location.hash.slice(responsePrefix.length)
      clearHash()
      receive(response)
    }
  }

  async function receive(response) {
    try {
      if (!/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{24,500}$/.test(response)) return
      const raw = localStorage.getItem(pendingKey)
      const pending = JSON.parse(raw)
      if (!pending || Date.now() > pending.expires) return
      const [iv, ciphertext] = response.split('.').map(decode)
      const key = await crypto.subtle.importKey('raw', decode(pending.key), 'AES-GCM', false, ['decrypt'])
      const json = await crypto.subtle.decrypt({
        name:'AES-GCM', iv, additionalData:new TextEncoder().encode(site)
      }, key, ciphertext)
      const result = JSON.parse(new TextDecoder().decode(json))
      if (result.source !== pending.source || result.date !== dayKey() || localStorage.getItem(pendingKey) !== raw) return
      localStorage.removeItem(pendingKey)

      if (result.status !== 'ok') {
        notify(result.status === 'empty'
          ? 'אין עדיין נתוני פעילות מהמקור שנבחר. בדוק שהוא משתף נתונים עם Health Connect.'
          : 'הסנכרון לא הצליח. בדוק הרשאות קריאה ב־Health Connect.')
        return
      }

      const steps = Number.isSafeInteger(result.steps) && result.steps >= 0 ? result.steps : null
      const calories = Number.isFinite(result.kcal) && result.kcal >= 0 ? result.kcal : null
      refreshJournal()
      const kg = weight()
      if (calories === null && (steps === null || !Number.isFinite(kg) || kg <= 0)) {
        notify('נקראו צעדים בלבד. הזן משקל כדי לקבל הערכת קלוריות.')
        return
      }
      source.value = result.source
      save({source:result.source, kcal:calories ?? steps * kg * .0005, steps, estimated:calories === null})
      notify('הפעילות סונכרנה והיתרה עודכנה')
    } catch {
      notify('לא ניתן לקרוא את תוצאת הסנכרון. לחץ שוב על ״סנכרון פעילות״.')
    }
  }

  addEventListener('hashchange', handleHash)
  addEventListener('storage', (event) => {
    if (event.key === journalKey && document.visibilityState === 'visible') refreshJournal()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshJournal()
  })
  handleHash()
}
