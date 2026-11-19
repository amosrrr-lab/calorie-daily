const pendingKey = 'calorie-daily.health-sync.pending'
const sourceKey = 'calorie-daily.health-sync.source'
const responsePrefix = '#activity-sync='
const installHash = '#install-activity-sync'
const workoutFallback = '#workout-sync-unavailable'
const expiresAfter = 10 * 60 * 1000
const site = 'https://amosrrr-lab.github.io/calorie-daily/'

const encode = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const decode = (text) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (character) => character.charCodeAt(0))

export function connectWebActivity({dayKey, journalKey, currentSource, refreshJournal, save, notify}) {
  if (!/Android/i.test(navigator.userAgent) || !globalThis.crypto?.subtle) return

  const get = (id) => document.getElementById(id)
  const source = get('webActivitySource')
  const sync = get('webWorkoutSync')
  const status = get('webActivityStatus')
  get('webActivityHint').hidden = false
  const showStatus = (message) => {
    status.textContent = message
    notify(message)
  }
  let lastSource = currentSource()
  try { lastSource = localStorage.getItem(sourceKey) || lastSource } catch { /* Keep the journal source. */ }
  if (lastSource === 'samsung') source.value = 'samsung'

  const install = get('webSyncInstall')
  let responseTimer
  function bind(link, path, fallbackHash) {
    let key
    const prepare = () => {
      key = encode(crypto.getRandomValues(new Uint8Array(32)))
      const fallback = encodeURIComponent(site + fallbackHash)
      link.href = `intent://activity/${path}?key=${key}&source=${source.value}#Intent;scheme=caloriedaily;package=il.amosrrr.calories.sync;S.browser_fallback_url=${fallback};end`
    }
    prepare()
    source.addEventListener('change', prepare)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') prepare()
    })
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented) return
      try {
        const request = JSON.stringify({key, source:source.value, expires:Date.now() + expiresAfter})
        localStorage.setItem(sourceKey, source.value)
        localStorage.setItem(pendingKey, request)
        status.textContent = 'ממתין לתוצאת סנכרון מ־Health Connect…'
        clearTimeout(responseTimer)
        responseTimer = setTimeout(() => {
          if (localStorage.getItem(pendingKey) === request && document.visibilityState === 'visible') {
            status.textContent = 'עדיין לא חזרה תשובה מרכיב הסנכרון. אם נפתח מסך הרשאות, השלם אותו וחזור ליומן.'
          }
        }, 16000)
      } catch {
        event.preventDefault()
        status.textContent = 'אין גישה לאחסון המקומי בכרום. פתח את האפליקציה מחוץ למצב גלישה בסתר.'
      }
    })
  }

  bind(sync, 'workout-sync', workoutFallback)

  function clearHash() {
    history.replaceState(history.state, '', location.pathname + location.search)
  }

  function handleHash() {
    if (location.hash === installHash || location.hash === workoutFallback) {
      clearTimeout(responseTimer)
      localStorage.removeItem(pendingKey)
      clearHash()
      install.hidden = false
      status.textContent = 'כדי לסנכרן אימונים, התקן או עדכן פעם אחת את רכיב הסנכרון וחזור ליומן.'
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
      if (!pending || Date.now() > pending.expires) {
        showStatus('הסנכרון הקודם לא זוהה בכרום. לחץ שוב על סנכרון פעילות.')
        return
      }
      const [iv, ciphertext] = response.split('.').map(decode)
      const key = await crypto.subtle.importKey('raw', decode(pending.key), 'AES-GCM', false, ['decrypt'])
      const json = await crypto.subtle.decrypt({
        name:'AES-GCM', iv, additionalData:new TextEncoder().encode(site)
      }, key, ciphertext)
      const result = JSON.parse(new TextDecoder().decode(json))
      if (localStorage.getItem(pendingKey) !== raw || result.source !== pending.source) return
      if (result.date !== dayKey()) {
        showStatus('התחיל יום חדש. לחץ שוב על סנכרון פעילות.')
        return
      }
      clearTimeout(responseTimer)
      localStorage.removeItem(pendingKey)
      const name = result.source === 'zepp' ? 'Zepp' : 'Samsung Health'
      const noWorkout = 'טרם התקבל אימון להיום מ־' + name + '. אפשר לסנכרן באפליקציית הכושר ולנסות שוב.'
      if (result.status !== 'ok') {
        const messages = {
          empty: noWorkout,
          permission: 'לא ניתנה לרכיב הסנכרון הרשאת קריאה ב־Health Connect.',
          read: 'Health Connect החזיר שגיאה בקריאת הפעילות. בדוק הרשאות לרכיב הסנכרון.',
          unavailable: 'Health Connect אינו זמין במכשיר הזה.'
        }
        showStatus(messages[result.status] ?? 'סנכרון הפעילות לא הושלם.')
        return
      }

      const workoutKcal = result.workoutKcal
      if (result.workoutState !== 'measured' || !Number.isFinite(workoutKcal) || workoutKcal < 0) {
        const messages = {
          none: noWorkout,
          permission: 'אשר קריאת אימונים ב־Health Connect ולחץ שוב על סנכרון.',
          'no-calories': 'התקבל אימון, אך טרם שויכו לו קלוריות.',
          read: 'קריאת האימונים נכשלה. אפשר לנסות שוב.'
        }
        showStatus(messages[result.workoutState] ?? 'טרם נקלטו קלוריות מאימונים.')
        return
      }
      refreshJournal()
      source.value = result.source
      save({source:result.source, workoutKcal})
      showStatus('אימוני היום מ־' + name + ' נקלטו והיתרה עודכנה.')
    } catch {
      showStatus('לא ניתן לקרוא את תוצאת הסנכרון. לחץ שוב על ״סנכרון פעילות״.')
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
