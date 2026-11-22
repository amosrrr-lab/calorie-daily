import foodRows from './foods-data.js'
import {soupRows, commonSoups} from './soups-data.js'
import {searchCatalog} from './catalog.js?v=voice-meals-1'
import {parseVoiceFood, matchesVoiceFood, voiceFoodNames, parseVoiceMeal, voiceIngredientDefault, preferredVoiceIngredient} from './voice-food.js?v=voice-list-1'
import {connectAppleWorkoutImport} from './apple-workout-import.js?v=1'
import {connectWebActivity} from './activity-sync.js?v=watch-sources-1'
import {connectBalanceWidget} from './balance-widget.js?v=lock-guide-1'
const $ = (id) => document.getElementById(id)
const fmt = (number) => Math.round(number).toLocaleString('he-IL')
const bridge = window.CalorieAndroid
const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
let updateBalanceWidget = () => {}

const hotDrinks = new Map([
  [4806, ['נס קפה (קפה נמס)', 'קפה אינסטנט נס קפה קפה נמס']],
  [4808, ['נס קפה, נטול קפאין', 'קפה אינסטנט נס קפה קפה נמס']],
  [4800, ['קפה פילטר', 'קפה טחון קפה רגיל']],
  [4803, ['אספרסו או קפה שחור, לא ממותק', 'קפה טורקי קפה שחור']],
  [4804, ['אספרסו, נטול קפאין', 'קפה שחור']],
  [4814, ['קפה הפוך (קפוצ׳ינו)', 'קפה הפוך קפוצינו קפוצ ינו']],
  [4815, ['קפה הפוך (קפוצ׳ינו), נטול קפאין', 'קפה הפוך קפוצינו קפוצ ינו']],
  [4832, ['תה, לא ממותק', 'תה שחור']],
  [9594, ['תה ירוק, לא ממותק', 'תה ירוק']],
  [4838, ['תה צמחים (חליטה)', 'חליטת צמחים תה צמחים']],
  ['usda-171277', ['שוקו חם, ביתי', 'משקה קקאו שוקו חם']]
])
const sweetenedHotDrinks = new Set([4801, 4802, 4809, 4810, 4811, 4812, 4828, 4829, 4833, 4834, 4835, 4836, 4837])
const acceptsAddedSugar = (id) => hotDrinks.has(id) || sweetenedHotDrinks.has(id)
const sugarKcalPerTeaspoon = 387 * 4 / 100 // White sugar in the catalog, 4 g per level teaspoon.
const storageKey = 'calories-per-day.v1'
let state = {target: null, weight: null, source: 'manual', origin: '', days: {}, customFoods:[], externalFoods:[]}
function dayKey() {
  const date = new Date()
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
}
function today() {
  return state.days[dayKey()] ??= {meals: [], activity: null}
}
function notify(message) {
  $('toast').textContent = message
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { $('toast').hidden = true }, 3200)
}
function persist() {
  const day = state.days[dayKey()]
  if (hasJournalData(day)) day.target = state.target ?? null
  try { localStorage.setItem(storageKey, JSON.stringify(state)) }
  catch { notify('לא ניתן לשמור ביומן במכשיר הזה') }
}
function element(tag, text, className) {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}
function button(text, className, action) {
  const node = element('button', text, className)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}
function activityCalories(activity) {
  const kcal = activity?.source === 'manual' ? activity.kcal : activity?.workoutKcal
  return Number.isFinite(kcal) && kcal >= 0 ? kcal : null
}
const itemCalories = (item) => item.grams * item.kcal / 100 + (item.sugarTeaspoons ?? 0) * sugarKcalPerTeaspoon
const mealCalories = (meal) => meal.items.reduce((sum, item) => sum + itemCalories(item), 0)
function loadJournal() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey))
    if (!saved?.days || typeof saved.days !== 'object') return

    for (const day of Object.values(saved.days)) {
      if (!day?.meals?.some((meal) => meal.items.some((item) => item.kind === 'misc'))) continue
      day.miscEntries ??= []
      day.meals = day.meals.map((meal) => {
        const items = meal.items.filter((item, index) => {
          if (item.kind !== 'misc') return true
          day.miscEntries.push({id:meal.id + '-misc-' + index, kcal:itemCalories(item)})
          return false
        })
        return {...meal, items}
      }).filter((meal) => meal.items.length)
    }
    state = {...state, ...saved}
  } catch { /* Retain the in-memory journal. */ }
}
loadJournal()
function hasJournalData(day) {
  return Boolean(day?.meals?.length || day?.miscEntries?.length) || activityCalories(day?.activity) !== null
}

function summarizeDay(day, target) {
  const miscCalories = (day.miscEntries ?? []).reduce((sum, entry) => sum + entry.kcal, 0)
  const eaten = (day.meals ?? []).reduce((sum, meal) => sum + mealCalories(meal), miscCalories)
  const workoutCalories = activityCalories(day.activity)
  const active = Math.round(workoutCalories ?? 0)
  const available = (target ?? 0) + active
  return {eaten, workoutCalories, active, available, balance:Math.round(available - eaten)}
}

let toastTimer
let currentFood
let draft = []
let editingMeal
let editingMisc
let editingItem = null
let voiceMode = false
let voiceRecognition
let voiceTranscript = ''
let voiceIngredients = []
// Estimate per 100 g: 80 g stewed thigh meat, 15 g green olives, and 5 g sauce with about 2.5 g oil.
const cookedChickenWithOlives = ['chicken-olive-stew', 'חלקי עוף מבושל עם זיתים מבושלים', 200, [],
  'תבשיל עוף זיתים ירוקים עוף וזיתים עוף מבושל בזיתים כרעיים שוקיים ירכיים פרגית',
  'הערכה לתבשיל ביתי']
// Estimate includes a small amount of the cooking sauce.
const cookedMeatballsWithGreens = ['meatballs-oil-greens', 'קציצות מבושלות עם שמן ועלים', 200,
  [['קציצה בינונית', 65]], 'קציצה קציצות בשר קציצה מבושלת קציצות ברוטב עלים ירוקים עשבי תיבול פטרוזיליה כוסברה סלרי',
  'הערכה לתבשיל ביתי']
const foods = [...foodRows, ...soupRows, cookedChickenWithOlives, cookedMeatballsWithGreens].map(([id, name, kcal, portions, aliases, sourceName, sourceUrl]) => ({
  id, name:hotDrinks.get(id)?.[0] ?? name, kcal,
  portions:id === 4803 ? [['אספרסו קצר', 30], ['אספרסו כפול', 60], ['כוס קפה שחור', 130]] : portions ?? [],
  source:sourceName ?? (typeof id === 'string' && id.startsWith('usda-') ? 'USDA' : 'משרד הבריאות'),
  sourceUrl,
  search:normalize([name, aliases, commonSoups.get(id), ...(hotDrinks.get(id) ?? [])].join(' '))
}))
for (const personal of [...(state.customFoods ?? []), ...(state.externalFoods ?? [])]) {
  foods.push({...personal, search:normalize(personal.name)})
}
const spokenFoodNames = new Set(foods.flatMap(food => voiceFoodNames(food).map(normalize)))
let catalogTimer
let catalogController
let catalogQuery = ''
let catalogPage = 0
let catalogItems = []
let photoRun = 0
let objectURL
let syncing = false
let requestVersion = 0
let syncTimer
let chosenSource = 'phone'
let currentDay = dayKey()
let goalDraft = null
let goalStep = 0
let goalReviewMode = ''

function render() {
  const day = today()
  if (hasJournalData(day) && day.target === undefined) persist()
  const {eaten, workoutCalories, active, available, balance} = summarizeDay(day, state.target)
  const activity = day.activity
  $('date').textContent = new Intl.DateTimeFormat('he-IL', {weekday:'long', day:'numeric', month:'long'}).format(new Date())
  const hasTarget = Boolean(state.target)
  $('goalEmpty').hidden = hasTarget
  $('balanceReadout').hidden = !hasTarget
  $('targetStat').hidden = !hasTarget
  $('targetTotal').textContent = hasTarget ? fmt(state.target) : '—'
  $('eaten').textContent = fmt(eaten)
  $('activeTotal').textContent = workoutCalories === null ? '—' : active ? '+' + fmt(active) : '0'
  const mealPlan = state.goal?.times ?? []
  $('todayMealTimes').hidden = !mealPlan.length
  showMealTimes($('todayMealTimes'), mealPlan)
  $('remaining').textContent = hasTarget ? fmt(balance) : '—'
  updateBalanceWidget({date:dayKey(), target:Math.round(state.target ?? 0), balance})
  const progress = hasTarget ? Math.min(100, Math.round(eaten / available * 100)) : 0
  $('meterFill').style.width = progress + '%'
  $('meterFill').parentElement.setAttribute('aria-valuenow', progress)
  $('activityStatus').textContent = workoutCalories !== null
    ? [activity.name, fmt(active) + (hasTarget ? ' קלוריות מאימונים נוספו ליתרה' : ' קלוריות מאימונים נקלטו היום')].filter(Boolean).join(' · ')
    : 'טרם נקלטו קלוריות מאימון להיום'
  $('activityButton').textContent = appleMobile ? 'רישום אימון' : state.origin ? 'מקור האימונים' : 'חיבור אימונים'
  renderMiscEntries($('miscList'), day, true)
  $('mealCount').textContent = day.meals.length ? day.meals.length + (day.meals.length === 1 ? ' ארוחה' : ' ארוחות') : ''
  $('emptyJournal').hidden = day.meals.length > 0
  $('journal').replaceChildren(...[...day.meals].reverse().map((meal) => {
    const row = element('li', '')
    const content = element('div', '', 'entry')
    content.append(element('strong', meal.items.map((item) => item.name).join(' · ')))
    content.append(element('p', [fmt(mealCalories(meal)) + ' קלוריות', meal.items.map(formatQuantity).filter(Boolean).join(' + ')].filter(Boolean).join(' · ')))
    row.append(content, button('עריכה', 'quiet', () => openFood(false, meal)), button('מחיקה', 'remove', () => {
      if (!confirm('למחוק את הארוחה מהיומן?')) return
      day.meals = day.meals.filter((entry) => entry.id !== meal.id)
      persist()
      render()
    }))
    return row
  }))
}
function renderMiscEntries(list, day, editable = false) {
  list.replaceChildren(...[...(day?.miscEntries ?? [])].reverse().map((entry) => {
    const row = element('li', '')
    row.append(element('strong', [entry.description, fmt(entry.kcal) + ' קלוריות'].filter(Boolean).join(' · '), 'entry'))
    if (editable) {
      row.append(button('עריכה', 'quiet', () => openMisc(entry)), button('מחיקה', 'remove', () => {
        if (!confirm('למחוק את הרישום משונות?')) return
        day.miscEntries = day.miscEntries.filter((item) => item.id !== entry.id)
        persist()
        render()
      }))
    }
    return row
  }))
}
function openMisc(entry) {
  editingMisc = entry ? {id:entry.id, date:dayKey()} : null
  $('miscTitle').textContent = entry ? 'עריכת שונות' : 'שונות'
  const input = $('miscEntry')
  input.setCustomValidity('')
  input.value = entry ? [entry.description, entry.kcal].filter(Boolean).join(' ') : ''
  $('miscDialog').showModal()
  input.focus()
}
function parseMiscEntry(text) {
  const match = text.trim().match(/^(?:(.*?)\s+)?(\d+(?:[.,]\d+)?)(?:\s*(?:קלוריות|קלוריה|קל['׳’]?|קק["״]ל))?$/u)
  if (!match) return null
  const [, description = '', amount] = match
  const kcal = Number(amount.replace(',', '.'))
  return Number.isFinite(kcal) && kcal >= 0.01 ? {description:description.trim(), kcal} : null
}
$('miscButton').addEventListener('click', () => openMisc())
$('miscEntry').addEventListener('input', (event) => event.currentTarget.setCustomValidity(''))
$('miscForm').addEventListener('submit', (event) => {
  event.preventDefault()
  const input = $('miscEntry')
  const details = parseMiscEntry(input.value)
  if (!details) {
    input.setCustomValidity('יש לסיים את הרישום במספר הקלוריות, למשל ביס מפיצה 20 קל׳')
    input.reportValidity()
    return
  }
  if (editingMisc) {
    const entry = state.days[editingMisc.date]?.miscEntries?.find((item) => item.id === editingMisc.id)
    if (!entry) {
      $('miscDialog').close()
      notify('הרישום כבר אינו ביומן')
      return
    }
    Object.assign(entry, details)
  } else {
    const day = today()
    day.miscEntries ??= []
    day.miscEntries.push({id:crypto.randomUUID(), ...details})
  }
  persist()
  render()
  $('miscDialog').close()
  notify('הקלוריות נשמרו בשונות')
})
function formatQuantity(item) {
  const quantity = item.grams + (item.unit === 'ml' ? ' מ״ל' : ' גרם')
  return item.sugarTeaspoons ? quantity + ' · ' + item.sugarTeaspoons + ' כפ׳ סוכר' : quantity
}
function normalize(text) {
  return text.normalize('NFKD').replace(/[\u0591-\u05c7]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
    .replace(/לחמנייה/gu, 'לחמניה').replace(/לחמניות/gu, 'לחמניה')
    .replace(/פיתות/g, 'פיתה').replace(/פיתת/g, 'פיתה')
}
function searchRank(food, query) {
  if (normalize(food.name) === query) return 0
  const soupName = commonSoups.get(food.id)
  if (soupName && (query === 'מרק' || query === soupName)) return 1
  if (hotDrinks.has(food.id) && /^(משקאות חמים|קפה|נס קפה|תה|שוקו|הפוך|אספרסו|חליטת צמחים)( |$)/.test(query)) return 1
  if (food.source === 'USDA') return 5
  if (query === 'סלט' && [9704, 3895, 9418, 3898, 9383].includes(food.id)) return 1
  return food.search.startsWith(query) ? 2 : 3
}
function findFoodMatches(name, spoken) {
  const query = normalize(name).replace(/^נסקפה(?= |$)/, 'נס קפה').replace(/^מרקים(?= |$)/, 'מרק')
  if (!query) return []
  const alternate = spoken && ({'הריסה':'אריסה', 'חריסה':'אריסה', 'סלק אדום':'סלק', 'טחינה מוכנה':'טחינה'})[query]
  const terms = (alternate || query).split(' ')
  const matches = []
  for (const food of foods) {
    const exact = spoken && matchesVoiceFood(food, query, normalize)
    if (exact || (query === 'משקאות חמים'
      ? hotDrinks.has(food.id)
      : terms.every((term) => food.search.includes(term)))) {
      matches.push({food, exact, rank:exact ? -1 : searchRank(food, query)})
    }
  }
  return matches.sort((a, b) => a.rank - b.rank || a.food.name.length - b.food.name.length || a.food.name.localeCompare(b.food.name, 'he'))
}
$('appleInstallHelp').hidden = !appleMobile || navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches
$('appleActivityHint').hidden = !appleMobile
if (appleMobile) connectAppleWorkoutImport({
  dayKey,
  save:({name, kcal}) => {
    loadJournal()
    state.origin = 'apple-health'
    storeActivity('watch', kcal, {name, workoutKcal:kcal})
  }
})
function foodSearchInput() {
  const field = $('foodSearch').value.trim()
  return voiceMode ? parseVoiceFood(field) : {query:field}
}
function updateSearch() {
  const spoken = foodSearchInput()
  const results = $('searchResults')
  $('voiceOnlineSingle').hidden = true
  if (voiceMode && voiceMealParts($('foodSearch').value).length > 1) {
    results.replaceChildren()
    clearCatalog()
    return []
  }
  if (!normalize(spoken.query)) { clearCatalog(); results.replaceChildren(); return [] }
  const matches = findFoodMatches(spoken.query, voiceMode).slice(0, 18)
  queueCatalog(spoken.query, voiceMode && !matches.some(entry => entry.exact || entry.rank < 5))
  $('voiceOnlineSingle').hidden = Boolean(bridge?.searchProducts)
  results.replaceChildren(...(matches.length ? matches.map(({food}) => {
    const row = button(food.name, 'secondary', () => {
      if (voiceMode) selectSpokenFood(food, spoken)
      else selectFood(food)
    })
    row.append(element('span', food.source + ' · ' + fmt(food.kcal) + (food.unit === 'ml' ? ' ל־100 מ״ל' : ' ל־100 ג׳')))
    return row
  }) : [element('p', 'אין תוצאות. אפשר לנסות שם כללי יותר.', 'hint')]))
  return matches
}
function setVoiceStatus(message, phase = 'idle') {
  $('voiceFoodStatus').textContent = message
  $('voicePanel').dataset.phase = phase
}
function showVoiceTranscript(transcript, final = false) {
  $('voiceTranscript').textContent = transcript ? (final ? 'זוהה: ' : 'נקלט עד עכשיו: ') + transcript : ''
  $('voiceTranscript').hidden = !transcript
}
function setVoiceControls(listening) {
  $('retryVoice').hidden = listening
  $('stopVoice').hidden = !listening
  $('stopVoice').disabled = false
}
function releaseVoiceRecognition() {
  const recognizer = voiceRecognition
  voiceRecognition = undefined
  return recognizer
}
function selectSpokenFood(food, spoken) {
  releaseVoiceRecognition()?.abort()
  setVoiceControls(false)
  $('retryVoice').hidden = true
  const quantity = voiceIngredientDefault(food, spoken, normalize)
  selectFood(food, quantity)
  if (quantity.unit && !$('quantityUnit').hidden) {
    $('quantityUnit').value = quantity.unit
    updateQuantity()
  }
  setVoiceStatus(quantity.estimated
    ? 'כמות משוערת' + (quantity.portion ? ' · ' + quantity.portion : '') + '. אפשר לשנות לפני השמירה.'
    : quantity.grams ? 'בדוק את המנה והכמות לפני השמירה.' : 'בחר יחידת מידה והזן את הכמות.')
  return Boolean(quantity.grams) && !quantity.estimated
}
function startVoiceMeal() {
  openFood(false, undefined, false)
  $('foodTitle').textContent = 'רישום ארוחה בקול'
  voiceMode = true
  $('voicePanel').hidden = false
  $('voiceSearchMeal').hidden = false
  listenForMeal()
}
const voiceErrors = {
  'not-allowed': 'אין גישה למיקרופון. אם מופיעה בקשת הרשאה, אפשר שימוש במיקרופון ונסה שוב.',
  'service-not-allowed': 'הדפדפן חסם את שירות הזיהוי הקולי.',
  'audio-capture': 'המיקרופון לא זמין לאפליקציה. בדוק את הרשאת המיקרופון ונסה שוב.',
  'network': 'לא ניתן להתחבר לשירות הזיהוי הקולי. בדוק את החיבור לאינטרנט ונסה שוב.',
  'no-speech': 'לא זוהה דיבור. נסה שוב ודבר כשתופיע ההודעה ״המיקרופון פתוח״.',
  'language-not-supported': 'שירות הזיהוי הקולי במכשיר לא תומך בעברית.'
}
function listenForMeal() {
  if (voiceRecognition) return
  const search = $('foodSearch')
  resetVoiceIngredients()
  renderDraft()
  voiceTranscript = ''
  showVoiceTranscript('')
  search.value = ''
  updateSearch()
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Recognition) {
    setVoiceStatus('זיהוי קולי אינו זמין כאן. לחץ בשדה החיפוש והשתמש במיקרופון של המקלדת.')
    $('retryVoice').hidden = true
    return
  }

  let recognizer
  let partial = ''
  setVoiceStatus('מתחבר למיקרופון…')
  $('voiceFoodStatus').focus()
  setVoiceControls(true)
  const active = () => voiceRecognition === recognizer && $('foodDialog').open
  function finishWithoutResult(message) {
    releaseVoiceRecognition()
    setVoiceControls(false)
    if (partial) {
      search.value = partial
      updateSearch()
      setVoiceStatus(message + ' אפשר לבדוק את הטקסט ולבחור מנה.')
    } else {
      setVoiceStatus(message + ' אפשר גם להכתיב דרך המיקרופון של המקלדת.')
    }
  }

  try {
    recognizer = new Recognition()
    voiceRecognition = recognizer
    recognizer.lang = 'he-IL'
    recognizer.interimResults = true
    recognizer.maxAlternatives = 1
    recognizer.onaudiostart = () => {
      if (active()) setVoiceStatus('המיקרופון פתוח. אמור למשל ״שתי ביצים קשות״.', 'listening')
    }
    recognizer.onspeechstart = () => {
      if (active()) setVoiceStatus('דיבור נקלט…', 'speech')
    }
    recognizer.onspeechend = () => {
      if (active()) setVoiceStatus('מזהה את מה שאמרת…')
    }
    recognizer.onresult = (event) => {
      if (!active()) return
      const result = event.results[event.resultIndex]
      const transcript = result?.[0]?.transcript?.trim()
      if (!transcript) return
      showVoiceTranscript(transcript, result.isFinal)
      if (!result.isFinal) {
        partial = transcript
        setVoiceStatus('דיבור נקלט…', 'speech')
        return
      }

      releaseVoiceRecognition()
      setVoiceControls(false)
      search.value = transcript
      processVoiceMeal(true)
    }
    recognizer.onerror = (event) => {
      if (active()) finishWithoutResult(voiceErrors[event.error] || 'הזיהוי הקולי לא הושלם. אפשר לנסות שוב.')
    }
    recognizer.onend = () => {
      if (active()) finishWithoutResult('ההאזנה הסתיימה בלי תמלול סופי.')
    }
    recognizer.start()
  } catch {
    finishWithoutResult('לא ניתן להפעיל את הזיהוי הקולי.')
  }
}
function voiceMealParts(text) {
  const spoken = parseVoiceFood(text)
  if (spokenFoodNames.has(normalize(spoken.query))) return [spoken]
  return parseVoiceMeal(text, query => spokenFoodNames.has(normalize(query)))
}
function processVoiceMeal(autoSave) {
  releaseVoiceRecognition()?.abort()
  setVoiceControls(false)
  const transcript = $('foodSearch').value.trim()
  if (!transcript) return
  showVoiceTranscript(transcript, true)
  const parts = voiceMealParts(transcript)
  if (parts.length > 1) {
    openVoiceIngredients(parts)
    return
  }

  const spoken = foodSearchInput()
  const matches = updateSearch()
  const exact = matches.filter(entry => entry.exact)
  const preferred = exact.length === 0
    ? foods.find(food => food.id === preferredVoiceIngredient(spoken, normalize)) : undefined
  const food = exact.length === 1 ? exact[0].food : preferred
  if (food && !/^(?:טחינה|טחינה מוכנה)$/.test(normalize(spoken.query))) {
    if (selectSpokenFood(food, spoken) && exact.length === 1 && spoken.count !== null && autoSave) {
      voiceTranscript = transcript
      $('foodForm').requestSubmit()
    }
    return
  }
  setVoiceStatus(matches.length
    ? 'בחר את המנה שהתכוונת אליה ובדוק את הכמות.'
    : 'מחפש התאמות בקטלוג המקוון. אפשר גם לערוך את הטקסט.')
}
function resetVoiceIngredients() {
  for (const row of voiceIngredients) row.controller?.abort()
  voiceIngredients = []
  $('voiceIngredients').replaceChildren()
  $('voiceMealTotal').hidden = $('voiceIngredientSection').hidden = true
  $('foodLookup').hidden = false
  $('voiceSearchMeal').hidden = !voiceMode
  $('voiceOnlineSingle').hidden = true
}
function openVoiceIngredients(parts) {
  resetVoiceIngredients()
  clearCatalog()
  clearSelection()
  $('foodLookup').hidden = true
  $('voiceIngredientSection').hidden = false
  setVoiceStatus('בדוק את הרכיבים ואת הכמויות המשוערות. אפשר לתקן כל רכיב בנפרד.')
  voiceIngredients = parts.map(makeVoiceIngredient)
  $('voiceIngredients').replaceChildren(...voiceIngredients.map(row => row.card))
  updateVoiceMealTotal()
  voiceIngredients.filter(row => !row.candidates.some(food => food.source !== 'USDA'))
    .forEach(searchVoiceIngredient)
}
function makeVoiceIngredient(spoken, index) {
  const card = element('fieldset', '', 'voice-ingredient')
  card.append(element('legend', spoken.query))
  const preferred = preferredVoiceIngredient(spoken, normalize)
  const matches = findFoodMatches(spoken.query, true)
  const preferredFood = foods.find(food => food.id === preferred)
  const candidates = [...new Map([...(preferredFood ? [preferredFood] : []), ...matches.map(entry => entry.food).slice(0, 15)]
    .map(food => [food.id, food])).values()]
  const product = element('select', '')
  product.id = 'voiceProduct' + index
  const productLabel = element('label', 'מזון מהמאגר')
  productLabel.htmlFor = product.id
  const quantity = element('input', '')
  Object.assign(quantity, {type:'number', min:'0.01', max:'3000', step:'any', inputMode:'decimal', id:'voiceQuantity' + index})
  const quantityLabel = element('label', 'כמות')
  quantityLabel.htmlFor = quantity.id
  const unit = element('select', '')
  unit.setAttribute('aria-label', 'יחידת מידה עבור ' + spoken.query)
  unit.append(new Option('בחר גרם או מ״ל', ''), new Option('גרם', 'g'), new Option('מ״ל', 'ml'))
  const details = element('p', '', 'hint')
  const networkStatus = element('p', '', 'hint')
  networkStatus.setAttribute('role', 'status')
  const row = {card, spoken, candidates, product, quantity, quantityLabel, unit, details, networkStatus}
  const online = button('חיפוש באינטרנט', 'quiet', () => searchVoiceIngredient(row))
  card.append(productLabel, product, online, networkStatus, quantityLabel, quantity, unit, details)
  setVoiceIngredientOptions(row)
  if (preferredFood || matches[0]?.exact || matches[0]?.rank < 5) product.value = String(candidates[0].id)
  product.addEventListener('change', () => setVoiceIngredientQuantity(row))
  quantity.addEventListener('input', () => {
    row.estimate = ''
    updateVoiceMealTotal()
  })
  unit.addEventListener('change', updateVoiceMealTotal)
  setVoiceIngredientQuantity(row, false)
  return row
}
function setVoiceIngredientOptions(row) {
  const previous = row.product.value
  row.product.replaceChildren(new Option('בחר תוצאה', ''), ...row.candidates.map(food =>
    new Option(food.name + ' · ' + fmt(food.kcal) + ' קל׳ ל־100 · ' + food.source, food.id)))
  row.product.value = row.candidates.some(food => String(food.id) === previous) ? previous : ''
}
function chosenVoiceIngredient(row) {
  return row.candidates.find(food => String(food.id) === row.product.value)
}
function setVoiceIngredientQuantity(row, refresh = true) {
  const food = chosenVoiceIngredient(row)
  const proposed = food ? voiceIngredientDefault(food, row.spoken, normalize) : {}
  const unit = food?.unit ?? (food && food.source !== 'Open Food Facts' ? 'g' : '')
  row.unit.value = unit || proposed.unit || ''
  row.unit.hidden = !food || Boolean(unit)
  row.quantity.hidden = row.quantityLabel.hidden = !food
  row.quantityLabel.textContent = unit === 'ml' ? 'כמות במ״ל' : unit === 'g' ? 'כמות בגרם' : 'כמות לפי היחידה על האריזה'
  row.quantity.value = proposed.grams ?? ''
  row.estimate = proposed.estimated ? (proposed.portion ?? 'מנה משוערת') : ''
  if (refresh) updateVoiceMealTotal()
}
async function searchVoiceIngredient(row) {
  if (row.controller) return
  const controller = new AbortController()
  row.controller = controller
  row.networkStatus.textContent = 'מחפש ב־Open Food Facts…'
  try {
    const {products} = await searchCatalog(row.spoken.query, 1, controller.signal)
    if (controller.signal.aborted) return
    const ids = new Set(row.candidates.map(food => food.id))
    row.candidates.push(...products.filter(food => !ids.has(food.id)))
    setVoiceIngredientOptions(row)
    if (!row.product.value && products.length) {
      row.product.value = String(products[0].id)
      setVoiceIngredientQuantity(row)
    }
    row.networkStatus.textContent = products.length ? 'תוצאות מ־Open Food Facts נוספו לרשימה. בדוק התאמה לאריזה.'
      : 'לא נמצאה התאמה ב־Open Food Facts.'
  } catch {
    if (!controller.signal.aborted) row.networkStatus.textContent = 'החיפוש המקוון לא זמין כרגע. אפשר לנסות שוב.'
  } finally {
    row.controller = undefined
  }
}
function voiceIngredientItem(row) {
  const food = chosenVoiceIngredient(row)
  const grams = row.quantity.valueAsNumber
  const unit = row.unit.value
  if (!food || !unit || !(grams > 0 && grams <= 3000)) return
  return {id:food.id, name:food.name, kcal:food.kcal, grams, unit}
}
function updateVoiceMealTotal() {
  const items = voiceIngredients.map(row => {
    const item = voiceIngredientItem(row)
    row.details.textContent = item ? [row.estimate ? 'הערכת כמות: ' + row.estimate : '', fmt(itemCalories(item)) + ' קלוריות']
      .filter(Boolean).join(' · ') : chosenVoiceIngredient(row) ? 'השלם את הכמות או יחידת המידה.' : 'בחר את המוצר שמתאים לרכיב.'
    return item
  })
  const complete = items.every(Boolean)
  const total = $('voiceMealTotal')
  total.hidden = !items.length
  total.textContent = complete ? 'סה״כ משוער לארוחה: ' + fmt(mealCalories({items})) + ' קלוריות'
    : 'יש להשלים את הרכיבים החסרים כדי לחשב את הסך הכולל.'
  $('saveMeal').disabled = !complete
}
function selectFood(food, savedItem) {
  currentFood = food
  $('grams').disabled = false
  $('selectedFood').textContent = food.name
  $('drinkSugar').hidden = !acceptsAddedSugar(food.id)
  $('sugarTeaspoons').disabled = $('drinkSugar').hidden
  $('sugarTeaspoons').value = food.sugarTeaspoons ?? ''
  const online = food.source === 'Open Food Facts'
  $('quantityUnit').hidden = $('quantityUnitLabel').hidden = !online
  $('quantityUnit').required = online
  $('quantityUnit').value = food.unit ?? (online ? '' : 'g')
  if (online && !foods.some((item) => item.id === food.id)) {
    foods.push({...food, search:normalize(food.name)})
    spokenFoodNames.add(normalize(food.name))
    state.externalFoods ??= []
    state.externalFoods.push(food)
    persist()
  }
  const servingOptions = food.portions
    .filter(([, grams]) => Number.isFinite(grams) && grams > 0)
    .map(([name, grams], index) => {
      const option = new Option(name + ' (' + grams + ' ג׳)', String(index))
      option.dataset.name = name
      option.dataset.grams = grams
      return option
    })
  $('serving').replaceChildren(new Option('גרם', ''), ...servingOptions)
  const savedOption = servingOptions.find((option) =>
    option.dataset.name === savedItem?.serving?.name &&
    Number(option.dataset.grams) === savedItem.serving.grams)
  $('serving').value = savedOption?.value ?? ''
  $('grams').value = savedOption ? savedItem.serving.count : savedItem?.grams ?? ($('photoTools').hidden ? 100 : '')
  updateQuantity()
  $('portion').hidden = $('addItem').hidden = false
  $('addItem').textContent = editingItem === null ? 'הוספת רכיב' : 'עדכון רכיב'
  $('foodSearch').value = ''
  $('voiceOnlineSingle').hidden = true
  $('searchResults').replaceChildren()
  clearCatalog()
  $('saveMeal').disabled = false
}
function clearSelection() {
  currentFood = undefined
  $('grams').disabled = true
  $('grams').value = 100
  $('sugarTeaspoons').disabled = true
  $('sugarTeaspoons').value = ''
  $('quantityUnit').required = false
  $('portion').hidden = $('addItem').hidden = true
  $('saveMeal').disabled = !draft.length
}
function searchForFood(query = '') {
  $('foodSearch').value = query
  updateSearch()
  $('foodSearch').focus()
}
function resetPhoto() {
  photoRun++
  if (objectURL) URL.revokeObjectURL(objectURL)
  objectURL = undefined
  $('cameraInput').value = $('imageInput').value = ''
  $('photoPreview').hidden = true
  $('photoPreview').removeAttribute('src')
  $('photoStatus').textContent = ''
  $('photoCandidates').replaceChildren()
  $('otherPhotoFood').hidden = true
}
function renderDraft() {
  $('draftList').replaceChildren(...draft.map((item, index) => {
    const row = element('li', '')
    row.append(element('span', [item.name, formatQuantity(item), fmt(itemCalories(item)) + ' קלוריות'].filter(Boolean).join(' · ')))
    const actions = element('div', '')
    actions.append(button('עריכה', 'quiet', () => {
      const itemIndex = draft.indexOf(item)
      if (editingItem === itemIndex) {
        $('grams').focus()
        return
      }
      if (!addSelected()) return
      editingItem = itemIndex
      const catalogFood = foods.find((food) => food.id === item.id)
      selectFood({...catalogFood, ...item, portions:catalogFood?.portions ?? []}, item)
      $('grams').focus()
    }), button('הסרה', 'remove', () => {
      if (editingItem === index) {
        editingItem = null
        clearSelection()
      } else if (editingItem !== null && editingItem > index) {
        editingItem--
      }
      draft.splice(index, 1)
      renderDraft()
    }))
    row.append(actions)
    return row
  }))
  $('saveMeal').disabled = !draft.length && !currentFood
}
function openFood(withPhoto, meal, focusSearch = true) {
  voiceMode = false
  resetVoiceIngredients()
  $('voicePanel').hidden = true
  setVoiceStatus('')
  draft = meal ? meal.items.map((item) => ({...item})) : []
  editingMeal = meal?.id
  editingItem = null
  clearSelection()
  resetPhoto()
  $('foodTitle').textContent = meal ? 'עריכת ארוחה' : withPhoto ? 'צילום ארוחה' : 'חיפוש מזון'
  $('photoTools').hidden = !withPhoto
  $('foodSearch').value = ''
  updateSearch()
  renderDraft()
  $('foodDialog').showModal()
  if (focusSearch && !withPhoto && !meal) $('foodSearch').focus()
}
function addSelected() {
  if (!currentFood) return true
  const item = readFoodItem()
  if (!item) return false
  if (editingItem === null) draft.push(item)
  else draft[editingItem] = item
  editingItem = null
  clearSelection()
  renderDraft()
  return true
}
function readFoodItem() {
  updateQuantity()
  if (!$('grams').reportValidity()) return
  const {id, name, kcal} = currentFood
  if (!$('quantityUnit').reportValidity() || !$('sugarTeaspoons').reportValidity()) return
  const sugarTeaspoons = acceptsAddedSugar(id) ? Number($('sugarTeaspoons').value) : 0
  const unit = $('quantityUnit').value || currentFood.unit || 'g'
  if (currentFood.source === 'Open Food Facts') {
    const saved = state.externalFoods?.find((food) => food.id === id)
    if (saved) saved.unit = unit
    const available = foods.find((food) => food.id === id)
    if (available) available.unit = unit
  }
  const serving = selectedServing()
  const count = Number($('grams').value)
  const grams = serving ? Number((serving.grams * count).toFixed(6)) : count
  const item = {id, name, kcal, grams, unit}
  if (serving) item.serving = {...serving, count}
  if (sugarTeaspoons > 0) item.sugarTeaspoons = sugarTeaspoons
  return item
}
function choosePhoto(camera) {
  $('photoStatus').textContent = ''
  if (bridge?.choosePhoto) bridge.choosePhoto(camera)
  else $(camera ? 'cameraInput' : 'imageInput').click()
}
$('photoButton').addEventListener('click', () => {
  openFood(true)
  choosePhoto(true)
})
$('cameraButton').addEventListener('click', () => choosePhoto(true))
$('galleryButton').addEventListener('click', () => choosePhoto(false))
$('manualButton').addEventListener('click', () => openFood(false))
$('voiceMealButton').addEventListener('click', startVoiceMeal)
$('voiceSearchMeal').addEventListener('click', () => processVoiceMeal(false))
$('voiceOnlineSingle').addEventListener('click', () => {
  clearTimeout(catalogTimer)
  loadCatalog(foodSearchInput().query, 1)
})
$('voiceEditMeal').addEventListener('click', () => {
  resetVoiceIngredients()
  renderDraft()
  updateSearch()
  $('foodSearch').focus()
})
$('retryVoice').addEventListener('click', listenForMeal)
$('stopVoice').addEventListener('click', () => {
  if (!voiceRecognition) return
  $('stopVoice').disabled = true
  setVoiceStatus('מזהה את מה שאמרת…')
  voiceRecognition.stop()
})
$('foodSearch').addEventListener('input', () => {
  if (voiceMode) {
    releaseVoiceRecognition()?.abort()
    voiceTranscript = ''
    setVoiceControls(false)
    showVoiceTranscript('')
    setVoiceStatus('בחר תוצאה מהמאגר כדי לרשום אותה ביומן.')
  }
  updateSearch()
})
$('replaceFood').addEventListener('click', () => {
  clearSelection()
  searchForFood()
})
$('otherPhotoFood').addEventListener('click', () => searchForFood())
$('serving').addEventListener('change', () => {
  $('grams').value = selectedServing() ? 1 : 100
  updateQuantity()
})
$('grams').addEventListener('input', updateQuantity)
$('sugarTeaspoons').addEventListener('input', updateQuantity)
$('addItem').addEventListener('click', () => { if (addSelected()) searchForFood() })
$('foodDialog').addEventListener('close', () => {
  releaseVoiceRecognition()?.abort()
  voiceMode = false
  resetVoiceIngredients()
  resetPhoto()
  clearCatalog()
})
$('quantityUnit').addEventListener('change', updateQuantity)
$('foodSearch').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    clearTimeout(catalogTimer)
    if (voiceMode) processVoiceMeal(false)
    else loadCatalog(foodSearchInput().query, 1)
  }
})
$('catalogMore').addEventListener('click', () => loadCatalog(catalogQuery, catalogPage + 1))
$('customProductButton').addEventListener('click', () => {
  $('customProductName').value = $('foodSearch').value.trim()
  $('customProductCalories').value = ''
  $('customProductDialog').showModal()
})
$('customProductForm').addEventListener('submit', (event) => {
  event.preventDefault()
  if (!$('customProductForm').reportValidity()) return
  const name = $('customProductName').value.trim()
  const kcal = Number($('customProductCalories').value)
  if (!name || !Number.isFinite(kcal) || kcal < 0) return
  const unit = $('customProductUnit').value
  state.customFoods ??= []
  const previous = state.customFoods.find((food) => normalize(food.name) === normalize(name) && food.unit === unit)
  const food = {id:previous?.id ?? 'custom-' + crypto.randomUUID(), name, kcal, unit, portions:[], source:'הזנה שלי'}
  state.customFoods = state.customFoods.filter((item) => item.id !== food.id)
  state.customFoods.push(food)
  const index = foods.findIndex((item) => item.id === food.id)
  const searchable = {...food, search:normalize(name)}
  if (index >= 0) foods[index] = searchable
  else foods.push(searchable)
  spokenFoodNames.add(searchable.search)
  persist()
  $('customProductDialog').close()
  selectFood(searchable)
  notify('המוצר נשמר לחיפושים הבאים')
})
function selectedServing() {
  const option = $('serving').selectedOptions[0]
  if (option?.dataset.grams) return {name:option.dataset.name, grams:Number(option.dataset.grams)}
}
function updateQuantity() {
  if (!currentFood) return
  const unit = $('quantityUnit').value || currentFood.unit
  const label = unit === 'ml' ? 'מ״ל' : unit === 'g' ? 'גרם' : 'גרם או מ״ל לפי האריזה'
  $('per100').textContent = fmt(currentFood.kcal) + ' קלוריות ל־100 ' + label

  const servingSelect = $('serving')
  const showServings = unit === 'g' && servingSelect.options.length > 1
  servingSelect.hidden = $('servingLabel').hidden = !showServings
  if (!showServings) servingSelect.value = ''
  const serving = selectedServing()
  $('quantityLabel').textContent = serving
    ? 'כמה אכלת לפי המידה שנבחרה?'
    : unit === 'ml' ? 'כמות במ״ל' : unit === 'g' ? 'כמות בגרם' : 'כמות'

  const input = $('grams')
  const count = input.valueAsNumber
  const grams = serving ? serving.grams * count : count
  input.setCustomValidity(grams > 3000 ? 'הכמות הכוללת לא יכולה לעלות על 3,000 ' + label : '')
  const sugar = $('sugarTeaspoons')
  const sugarTeaspoons = sugar.disabled ? 0 : Number(sugar.value)
  $('quantitySummary').textContent = unit && input.validity.valid && sugar.validity.valid
    ? (serving ? new Intl.NumberFormat('he-IL', {maximumFractionDigits:3}).format(grams) + ' גרם · ' : '') +
      fmt(itemCalories({grams, kcal:currentFood.kcal, sugarTeaspoons})) + ' קלוריות'
    : ''
}
function clearCatalog() {
  clearTimeout(catalogTimer)
  catalogController?.abort()
  catalogQuery = ''
  catalogPage = 0
  catalogItems = []
  $('catalogResults').replaceChildren()
  $('catalogStatus').textContent = ''
  $('catalogMore').hidden = true
}
function queueCatalog(query, webFallback = false) {
  clearTimeout(catalogTimer)
  catalogController?.abort()
  if (query.length < 2) { clearCatalog(); return }
  if (!bridge?.searchProducts && !webFallback) { clearCatalog(); return }
  $('catalogStatus').textContent = 'מחפש גם בקטלוג המוצרים…'
  $('catalogResults').replaceChildren()
  $('catalogMore').hidden = true
  catalogTimer = setTimeout(() => loadCatalog(query, 1), 1100)
}
async function loadCatalog(query, page) {
  if (query.length < 2) return
  catalogController?.abort()
  const controller = new AbortController()
  catalogController = controller
  $('catalogStatus').textContent = 'מחפש מוצרים ומותגים…'
  $('catalogMore').disabled = true
  try {
    const result = await searchCatalog(query, page, controller.signal)
    if (controller.signal.aborted) return
    if (page === 1) catalogItems = []
    catalogQuery = query
    catalogPage = page
    const ids = new Set(catalogItems.map((food) => food.id))
    catalogItems.push(...result.products.filter((food) => !ids.has(food.id)))
    $('catalogResults').replaceChildren(...catalogItems.map((food) => {
      const row = button(food.name, 'secondary', () => {
        if (voiceMode) selectSpokenFood(food, foodSearchInput())
        else selectFood(food)
      })
      row.append(element('span', fmt(food.kcal) + ' ל־100 לפי האריזה'))
      return row
    }))
    $('catalogStatus').replaceChildren(element('span', catalogItems.length ? 'מוצרים מהמאגר הקהילתי. יש לבדוק התאמה לאריזה. ' : 'לא התקבל מוצר עם ערכים תזונתיים בחיפוש הזה. '))
    const attribution = element('a', 'Open Food Facts')
    attribution.href = 'https://world.openfoodfacts.org'
    attribution.target = '_blank'
    attribution.rel = 'noopener'
    $('catalogStatus').append(attribution)
    $('catalogMore').hidden = !result.next
  } catch (error) {
    if (controller.signal.aborted) return
    $('catalogStatus').textContent = error.message || 'קטלוג המוצרים אינו זמין כרגע.'
    $('catalogMore').hidden = true
  } finally {
    if (catalogController === controller) $('catalogMore').disabled = false
  }
}
$('foodForm').addEventListener('submit', (event) => {
  event.preventDefault()
  if (voiceIngredients.length) {
    const items = voiceIngredients.map(voiceIngredientItem)
    if (!items.every(Boolean)) return
    draft.push(...items)
  }
  if (!addSelected() || !draft.length) return
  const day = today()
  const index = day.meals.findIndex((meal) => meal.id === editingMeal)
  if (index >= 0) day.meals[index] = {...day.meals[index], items:draft}
  else day.meals.push({id:crypto.randomUUID(), items:draft})
  persist()
  render()
  const voiceMessage = voiceTranscript ? 'נרשם: ' + voiceTranscript + ' · ' : 'נוספו ליומן '
  const message = voiceMode ? voiceMessage + fmt(mealCalories({items:draft})) + ' קלוריות' : 'הארוחה נשמרה'
  $('foodDialog').close()
  notify(message)
})
const goalSteps = ['goalIntro', 'goalHeightStep', 'goalWeightStep', 'goalAgeStep',
  'goalPurpose', 'goalActivityStep', 'goalRoutine', 'goalReview']
const finalGoalStep = goalSteps.length - 1

function bodyMassIndex() {
  const height = $('goalHeight')
  const weight = $('weightInput')
  if (!height.value || !weight.value || !height.checkValidity() || !weight.checkValidity()) return null
  return Number(weight.value) / (Number(height.value) / 100) ** 2
}

function syncRuler(field, ruler) {
  ruler.value = field.value
  $('liveBmi').textContent = bodyMassIndex()?.toFixed(1) ?? '—'
}

const rulers = [['goalHeight', 'heightRuler'], ['weightInput', 'weightRuler'], ['goalAge', 'ageRuler']]
for (const [fieldId, rulerId] of rulers) {
  const field = $(fieldId)
  const ruler = $(rulerId)
  field.addEventListener('input', () => syncRuler(field, ruler))
  ruler.addEventListener('input', () => {
    field.value = ruler.value
    syncRuler(field, ruler)
  })
}

function showGoalStep(step) {
  goalStep = step
  goalSteps.forEach((id, index) => { $(id).hidden = index !== step })
  $('goalMessage').textContent = ''
  $('goalProgress').textContent = step > 0 && goalReviewMode !== 'manual' ? `שלב ${step} מתוך ${finalGoalStep}` : ''
  $('goalBack').hidden = step === 0
  $('goalNext').hidden = step === finalGoalStep
  $('saveGoalButton').hidden = step !== finalGoalStep
  $('goalNext').textContent = step === 0 ? 'מתחילים ←' : step === finalGoalStep - 1 ? 'לתוכנית שלי ←' : 'המשך ←'
  $('skipGoalButton').hidden = step !== 0
  if ($('settingsDialog').open) $(goalSteps[step]).querySelector('h3').focus({preventScroll:true})
  $('settingsForm').querySelector('.goal-steps').scrollTop = 0
}

function openGoal() {
  const profile = state.goal?.profile ?? {}
  document.querySelectorAll('[name="goalDirection"]').forEach((choice) => {
    choice.checked = choice.value === (state.goal?.direction ?? 'maintain')
  })
  $('goalAge').value = profile.age ?? 30
  $('goalHeight').value = profile.height ?? 170
  $('goalSex').value = profile.sex ?? ''
  $('goalActivity').value = profile.activity ?? ''
  $('favoriteActivity').value = profile.favorite ?? ''
  setMealHourFields($('setupMealHours'), state.goal?.times ?? [])
  $('weightInput').value = state.weight ?? 70
  $('manualWeightInput').value = state.weight ?? ''
  $('skipEstimate').checked = profile.skipEstimate ?? state.goal?.targetMode === 'schedule'
  for (const [field, ruler] of rulers) syncRuler($(field), $(ruler))
  goalDraft = null
  goalReviewMode = ''
  showGoalStep(0)
  $('settingsDialog').showModal()
  $('goalIntro').querySelector('h3').focus({preventScroll:true})
}

function addMealHourField(list, value = '') {
  const number = list.children.length + 1
  const row = element('div', '')
  const input = element('input', '')
  input.id = `${list.id}-${number}`
  input.type = 'time'
  input.dir = 'ltr'
  input.value = value
  const label = element('label', `ארוחה ${number}`)
  label.htmlFor = input.id
  row.append(label, input)
  list.append(row)
  return input
}

function setMealHourFields(list, times) {
  list.replaceChildren()
  for (const time of times) addMealHourField(list, time)
  while (list.children.length < 3) addMealHourField(list)
}

function readMealHours(list) {
  return [...list.querySelectorAll('input')].map((input) => input.value).filter(Boolean)
}

function showMealTimes(list, times) {
  list.replaceChildren(...times.map((time, index) => {
    const row = element('li', '')
    const clock = element('strong', time)
    clock.dir = 'ltr'
    row.append(element('span', `ארוחה ${index + 1}`), clock)
    return row
  }))
}

function reviewGoal(mode, target, note = '') {
  goalReviewMode = mode
  $('targetInput').required = mode !== 'schedule'
  $('targetInput').value = target ?? ''
  $('targetFields').hidden = mode === 'schedule'
  $('planSummary').hidden = mode === 'manual'
  $('goalManualWeight').hidden = mode !== 'manual'
  $('goalReviewTitle').textContent = mode === 'manual' ? 'היעד שקבעתי' : 'התוכנית שלך'
  $('goalReviewHint').textContent = mode === 'estimated'
    ? 'אפשר לערוך את היעד המשוער. קלוריות הפעילות שיירשמו ביומן יתווספו ליתרה.'
    : mode === 'manual' ? 'הפעילות שתירשם ביומן תתווסף ליעד שהזנת.' : ''
  if (mode !== 'manual') {
    $('reviewBmi').textContent = bodyMassIndex().toFixed(1)
    $('planReviewNote').textContent = note
    $('reviewMeals').hidden = !goalDraft.times.length
    showMealTimes($('reviewMeals'), goalDraft.times)
    const favorite = $('favoriteActivity')
    $('reviewActivity').textContent = favorite.value
      ? `אפשר לשריין השבוע זמן לפעילות שבחרת (${favorite.selectedOptions[0].textContent}), בקצב שמתאים לך.`
      : ''
  }
  showGoalStep(finalGoalStep)
}

function calculatePlan() {
  const number = (id) => Number($(id).value)
  const age = number('goalAge')
  const height = number('goalHeight')
  const weight = number('weightInput')
  const sex = $('goalSex').value
  const activity = $('goalActivity').value
  const direction = document.querySelector('[name="goalDirection"]:checked').value
  const favorite = $('favoriteActivity').value
  const times = readMealHours($('setupMealHours'))
  goalDraft = {direction, weight, profile:{...state.goal?.profile, age, height, sex, activity, favorite}, times}
  if ($('skipEstimate').checked) return reviewGoal('schedule', null)
  const resting = 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161)
  const adjustment = direction === 'lose' ? -250 : direction === 'gain' ? 250 : 0
  const target = Math.round((resting * Number(activity) + adjustment) / 25) * 25
  if (target < (sex === 'male' ? 1500 : 1200) || (direction === 'lose' && bodyMassIndex() < 18.5)) {
    return reviewGoal('schedule', null, 'לפי הפרטים שהוזנו, מומלץ לקבוע יעד קלוריות עם איש מקצוע. עדיין אפשר לשמור את שעות הארוחות.')
  }
  reviewGoal('estimated', target)
}

function nextGoalStep() {
  if (goalStep >= finalGoalStep) return
  const skipEstimate = $('skipEstimate').checked
  const required = {
    1:['goalHeight'], 2:['weightInput'], 3:['goalAge'],
    4:skipEstimate ? [] : ['goalSex'],
    5:skipEstimate ? [] : ['goalActivity']
  }
  const invalid = (required[goalStep] ?? []).map($).find((field) => !field.value || !field.checkValidity())
  if (invalid) {
    $('goalMessage').textContent = 'יש למלא את השדה כדי להמשיך.'
    invalid.focus()
    return
  }
  if (goalStep === finalGoalStep - 1) calculatePlan()
  else showGoalStep(goalStep + 1)
}

function previousGoalStep() {
  if (!goalStep) return
  const back = goalReviewMode === 'manual' ? 0 : goalStep - 1
  goalReviewMode = ''
  showGoalStep(back)
}

$('settingsButton').addEventListener('click', openGoal)
$('setupButton').addEventListener('click', openGoal)
$('editPlanButton').addEventListener('click', () => {
  setMealHourFields($('editMealHours'), state.goal?.times ?? [])
  $('mealHoursDialog').showModal()
})
$('addSetupMealHour').addEventListener('click', () => addMealHourField($('setupMealHours')).focus())
$('addEditMealHour').addEventListener('click', () => addMealHourField($('editMealHours')).focus())
$('mealHoursForm').addEventListener('submit', (event) => {
  event.preventDefault()
  const times = readMealHours($('editMealHours'))
  state.goal = {...state.goal, times}
  persist()
  render()
  $('mealHoursDialog').close()
  notify('שעות הארוחות נשמרו')
})
$('goalNext').addEventListener('click', nextGoalStep)
$('goalBack').addEventListener('click', previousGoalStep)
$('manualGoalButton').addEventListener('click', () => reviewGoal('manual', state.target))
$('skipGoalButton').addEventListener('click', () => $('settingsDialog').close())
$('settingsDialog').addEventListener('close', () => {
  if (!state.onboardingSeen) {
    state.onboardingSeen = true
    persist()
  }
})

let goalTouch
$('settingsForm').addEventListener('touchstart', (event) => {
  const point = event.touches[0]
  goalTouch = event.touches.length === 1 && !event.target.closest('input, select, label, button')
    ? {x:point.clientX, y:point.clientY}
    : null
}, {passive:true})
$('settingsForm').addEventListener('touchend', (event) => {
  if (!goalTouch) return
  const point = event.changedTouches[0]
  const dx = point.clientX - goalTouch.x
  const dy = point.clientY - goalTouch.y
  goalTouch = null
  if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.6) return
  if (dx > 0) nextGoalStep()
  else previousGoalStep()
}, {passive:true})
$('settingsForm').addEventListener('touchcancel', () => { goalTouch = null })

$('settingsForm').addEventListener('submit', (event) => {
  event.preventDefault()
  if (goalStep !== finalGoalStep) return
  const target = $('targetInput')
  const weight = $('manualWeightInput')
  if (goalReviewMode !== 'schedule' && !target.reportValidity()) return
  if (goalReviewMode === 'manual' && !weight.reportValidity()) return
  if (goalReviewMode !== 'schedule') state.target = Number(target.value)
  if (goalReviewMode === 'manual') {
    state.weight = weight.value ? Number(weight.value) : null
    state.goal = {...state.goal, targetMode:'manual'}
  } else {
    const targetMode = goalReviewMode === 'schedule' && state.target ? state.goal?.targetMode ?? 'manual' : goalReviewMode
    state.weight = goalDraft.weight
    state.goal = {...goalDraft, targetMode}
    state.goal.profile.skipEstimate = goalReviewMode === 'schedule'
  }
  state.onboardingSeen = true
  if (bridge) bridge.setWeight(state.weight ?? 0)
  persist()
  render()
  $('settingsDialog').close()
  notify(goalReviewMode === 'manual' ? 'היעד נשמר' : 'התוכנית נשמרה')
})

function renderHistory() {
  const day = state.days[$('historyDate').value]
  $('historySummary').hidden = !day
  const meals = day?.meals ?? []
  $('historyMisc').hidden = !day?.miscEntries?.length
  renderMiscEntries($('historyMiscList'), day)
  $('historyNoMeals').hidden = !day || meals.length > 0
  if (day) {
    const historicalTarget = day.target !== undefined
    const target = historicalTarget ? day.target : state.target
    const {eaten, workoutCalories, active, balance} = summarizeDay(day, target)
    $('historyTarget').textContent = target ? fmt(target) : '—'
    $('historyEaten').textContent = fmt(eaten)
    $('historyWorkout').textContent = workoutCalories === null ? '—' : fmt(active)
    $('historyBalanceLabel').textContent = target && balance < 0 ? 'חריגה מהיעד' : 'יתרה לסוף היום'
    $('historyBalance').textContent = target ? fmt(Math.abs(balance)) : '—'
    $('historyNote').hidden = historicalTarget || !target
  }
  $('historyList').replaceChildren(...[...meals].reverse().map((meal) => {
    const row = element('li', '')
    const content = element('div', '', 'entry')
    content.append(element('strong', meal.items.map((item) => item.name).join(' · ')))
    content.append(element('p', [fmt(mealCalories(meal)) + ' קלוריות', meal.items.map(formatQuantity).filter(Boolean).join(' + ')].filter(Boolean).join(' · ')))
    row.append(content)
    return row
  }))
}
$('historyButton').addEventListener('click', () => {
  const dates = Object.entries(state.days)
    .filter(([date, day]) => date !== dayKey() && hasJournalData(day))
    .map(([key]) => {
      const [year, month, day] = key.split('-').map(Number)
      return {key, date:new Date(year, month - 1, day)}
    }).sort((a, b) => b.date - a.date)
  const dateFormat = new Intl.DateTimeFormat('he-IL', {year:'numeric', month:'long', day:'numeric'})
  $('historyDate').replaceChildren(...dates.map(({key, date}) => new Option(dateFormat.format(date), key)))
  $('historyDate').hidden = dates.length === 0
  document.querySelector('[for="historyDate"]').hidden = dates.length === 0
  $('historyEmpty').hidden = dates.length > 0
  renderHistory()
  $('historyDialog').showModal()
})
$('historyDate').addEventListener('change', renderHistory)
for (const control of document.querySelectorAll('[data-close]')) {
  control.addEventListener('click', () => $(control.dataset.close).close())
}

async function recognize(file) {
  if (!file) return
  const run = ++photoRun
  if (objectURL) URL.revokeObjectURL(objectURL)
  objectURL = URL.createObjectURL(file)
  const image = $('photoPreview')
  image.src = objectURL
  image.hidden = false
  $('photoCandidates').replaceChildren()
  $('otherPhotoFood').hidden = false
  $('photoStatus').textContent = 'מנתח את התמונה במכשיר…'
  try {
    await image.decode()
    if (run !== photoRun) return
    $('photoStatus').textContent = 'טוען את זיהוי המזון. בפעם הראשונה זה עשוי לקחת מעט זמן…'
    const model = await import('./vision.js?v=2')
    if (run !== photoRun) return
    const suggestions = await model.predict(image)
    if (run !== photoRun) return
    const names = [...new Set(suggestions.map(({label}) => model.foodNames[label]).filter(Boolean))]
    $('photoStatus').textContent = names.length
      ? suggestions[0]?.label === 'coffee'
        ? 'ייתכן שזה קפה. בחר סוג קפה ובדוק גם את החלב והסוכר לפני השמירה.'
        : 'הצעת זיהוי לבדיקה. בחר את המזון ובדוק את הכמות לפני השמירה.'
      : 'הזיהוי לא מספיק ברור. חפש את המזון במאגר כדי להמשיך.'
    const choices = names.includes('פיתה') ? ['פיתה', 'פיתה כוסמין']
      : suggestions[0]?.label === 'coffee' ? ['נס קפה', 'סוגי קפה'] : names
    $('photoCandidates').replaceChildren(...choices.flatMap((name) => {
      if (name === 'סוגי קפה' || name === 'נס קפה') {
        return [button(name, 'secondary', () => searchForFood(name === 'נס קפה' ? name : 'קפה'))]
      }
      const query = normalize(name)
      const exact = foods.find((food) => normalize(food.name) === query && Number.isFinite(food.kcal))
      const matches = exact ? [exact] : foods.filter((food) => {
        const label = normalize(food.name)
        return label.startsWith(query + ' ') && Number.isFinite(food.kcal)
          && !/(^| )(לא אפוי|לא מבושל|לא מוכן|בצק)( |$)/.test(label)
      }).sort((a, b) => searchRank(a, query) - searchRank(b, query) || a.name.length - b.name.length).slice(0, 2)
      if (!matches.length) return [button(name, 'secondary', () => searchForFood(name))]
      return matches.map((food) => {
        const choice = button(food.name, 'secondary', () => selectFood(food))
        choice.append(element('span', ' · ' + fmt(food.kcal) + ' קלוריות ל־100 ' + (food.unit === 'ml' ? 'מ״ל' : 'גרם')))
        return choice
      })
    }))
  } catch {
    if (run === photoRun) $('photoStatus').textContent = 'לא הצלחנו לנתח את התמונה. אפשר להמשיך בחיפוש במאגר.'
  }
}
window.onCaloriePhoto = (dataURL, error) => {
  if (error) {
    $('photoStatus').textContent = error
    return
  }
  if (!dataURL || !$('foodDialog').open) return
  const encoded = dataURL.slice(dataURL.indexOf(',') + 1)
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  recognize(new File([bytes], 'meal.jpg', {type:'image/jpeg'}))
}
for (const id of ['cameraInput', 'imageInput']) {
  $(id).addEventListener('change', () => recognize($(id).files[0]))
}
function storeActivity(source, kcal, details = {}) {
  today().activity = {source, kcal, ...details}
  state.source = source
  persist()
  render()
}
function renderSource() {
  const watch = chosenSource === 'watch'
  $('phoneSource').className = watch ? 'secondary' : 'primary'
  $('watchSource').className = watch ? 'primary' : 'secondary'
  $('phoneSource').setAttribute('aria-pressed', String(!watch))
  $('watchSource').setAttribute('aria-pressed', String(watch))
  $('watchOrigin').hidden = $('originLabel').hidden = !watch
  $('refreshActivity').disabled = syncing
}
function startSync(source, origin, initiated) {
  syncing = true
  renderSource()
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncing = false
    renderSource()
    $('nativeStatus').textContent = 'הסנכרון התעכב. אפשר לנסות שוב.'
  }, 30000)
  bridge.synchronize(source, origin, initiated, ++requestVersion)
}
$('activityButton').addEventListener('click', () => {
  $('manualCalories').value = ''
  $('activityDialog').showModal()
  if (!bridge) return
  chosenSource = state.source === 'watch' ? 'watch' : 'phone'
  bridge.listOrigins()
  renderSource()
})
$('openHealthSettings').addEventListener('click', () => bridge?.openHealthSettings?.())
$('openWatchApp').addEventListener('click', () => bridge?.openWatchApp?.($('watchOrigin').value))
$('phoneSource').addEventListener('click', () => { chosenSource = 'phone'; renderSource() })
$('watchSource').addEventListener('click', () => { chosenSource = 'watch'; renderSource() })
$('refreshActivity').addEventListener('click', () => {
  $('nativeStatus').textContent = 'בודק הרשאות ומסנכרן…'
  startSync(chosenSource, $('watchOrigin').value, true)
})
$('activityForm').addEventListener('submit', (event) => {
  event.preventDefault()
  if (!$('manualCalories').value) { $('manualCalories').focus(); return }
  requestVersion++
  syncing = false
  clearTimeout(syncTimer)
  storeActivity('manual', Number($('manualCalories').value))
  $('activityDialog').close()
  notify('הפעילות עודכנה')
})
window.onCalorieNative = (raw) => {
  const result = JSON.parse(raw)
  if (result.kind === 'origins') {
    const select = $('watchOrigin')
    const selected = select.value || state.origin
    select.replaceChildren(new Option('בחר אפליקציה', ''), ...result.items.map(({id, name, hasData}) => new Option(name + (hasData ? '' : ' · דרוש שיתוף נתונים'), id)))
    if (result.items.some(({id}) => id === selected)) select.value = selected
    else if (result.items.length === 1) select.value = result.items[0].id
    return
  }
  if (result.requestId !== requestVersion) return
  syncing = false
  clearTimeout(syncTimer)
  renderSource()
  $('nativeStatus').textContent = result.message ?? ''
  if (result.ok && result.hasData !== false && (result.userInitiated || result.source === state.source) && result.date === dayKey()) {
    state.origin = result.origin ?? ''
    storeActivity(result.source, result.kcal, {name:result.name, steps:result.steps, estimated:result.estimated, workoutKcal:result.workoutKcal})
  }
  if (result.ok && result.hasData === false && result.userInitiated) {
    state.source = result.source
    state.origin = result.origin ?? ''
    persist()
    $('activityStatus').textContent = result.source === 'watch' ? 'ממתין לשיתוף נתונים מאפליקציית השעון' : 'ממתין לנתוני פעילות מהטלפון'
  }
  if (result.userInitiated) bridge.listOrigins()
}
function resume() {
  if (currentDay !== dayKey()) { currentDay = dayKey(); render() }
  if (bridge && !syncing && state.source !== 'manual') startSync(state.source, state.origin, false)
}
window.calorieResume = resume
$('nativeControls').hidden = !bridge
if (!bridge) connectWebActivity({
  dayKey,
  journalKey: storageKey,
  currentSource: () => state.origin,
  refreshJournal: () => {
    loadJournal()
    render()
  },
  save: ({source, name, workoutKcal}) => {
    state.origin = source
    storeActivity('watch', workoutKcal, {workoutKcal, name})
  },
  notify
})
if (!bridge) updateBalanceWidget = connectBalanceWidget()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resume()
})
setInterval(() => {
  if (document.visibilityState === 'visible') resume()
}, 60000)
render()
if (bridge) { bridge.setWeight(state.weight ?? 0); resume() }
if (!state.target && !state.onboardingSeen) openGoal()
