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
  const showStatus = (message) => {
    status.textContent = message
    notify(message)
  }
  if (currentSource() === 'samsung') source.value = 'samsung'

  sync.addEventListener('click', (event) => {
    if (event.defaultPrevented) return
    try {
      const key = encode(crypto.getRandomValues(new Uint8Array(32)))
      localStorage.setItem(pendingKey, JSON.stringify({key, source:source.value, expires:Date.now() + expiresAfter}))
      const fallback = encodeURIComponent(site + installHash)
      status.textContent = 'ממתין לתוצאת סנכרון מ־Health Connect…'
      sync.href = `intent://activity/workout-sync?key=${key}&source=${source.value}#Intent;scheme=caloriedaily;package=il.amosrrr.calories.sync;S.browser_fallback_url=${fallback};end`
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
      status.textContent = 'כדי להתחבר לשעון, לחץ על ״התקנת רכיב סנכרון״ ועדכן את הרכיב הקיים. לאחר ההתקנה לחץ שוב על ״סנכרון פעילות״.'
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
      localStorage.removeItem(pendingKey)

      if (result.status !== 'ok') {
        const name = result.source === 'zepp' ? 'Zepp' : 'Samsung Health'
        const messages = {
          empty: `לא התקבלו היום צעדים או קלוריות פעילות מ־${name} ב־Health Connect.`,
          permission: 'לא ניתנה לרכיב הסנכרון הרשאת קריאה ב־Health Connect.',
          read: 'Health Connect החזיר שגיאה בקריאת הפעילות. בדוק הרשאות לרכיב הסנכרון.',
          unavailable: 'Health Connect אינו זמין במכשיר הזה.'
        }
        showStatus(messages[result.status] ?? 'סנכרון הפעילות לא הושלם.')
        return
      }

      const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null
      const energy = (value) => Number.isFinite(value) && value >= 0 ? value : null
      const steps = count(result.steps)
      const dailyCalories = energy(result.kcal)
      const workout = energy(result.workoutKcal)
      const regularSteps = count(result.regularSteps)
      const kg = weight()
      const estimateSteps = regularSteps ?? steps
      const stepEstimate = dailyCalories === null && estimateSteps !== null && Number.isFinite(kg) && kg > 0
        ? estimateSteps * kg * .0005 : null
      refreshJournal()
      source.value = result.source
      save({source:result.source, kcal:dailyCalories ?? workout, steps, regularSteps, stepEstimate,
        workoutKcal:workout, workoutState:result.workoutState})
      if (result.workoutState === 'permission') showStatus('הפעילות נקלטה. כדי להפריד אימונים, אשר גם קריאה של אימונים ב־Health Connect.')
      else if (result.workoutState === 'no-calories') showStatus('האימון נקלט, אך אין קלוריות שאפשר לשייך אליו.')
      else if (dailyCalories === null && workout === null) showStatus('נקראו צעדים. אומדן מצעדים מוצג בנפרד מהאימון ומהיתרה.')
      else showStatus('נתוני הפעילות נקלטו והיתרה עודכנה.')
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
