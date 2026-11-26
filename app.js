import foodRows from './foods-data.js'
import riceCakeRows from './rice-cake-foods.js?v=1'
import israeliMarketRows from './israeli-market-foods.js?v=1'
import {soupRows, commonSoups} from './soups-data.js'
import {searchCatalog} from './catalog.js?v=serving-units-1'
import {isProductCode} from './barcode.js?v=1'
import {retailFoods} from './retail-foods.js?v=serving-units-1'
import {parseVoiceFood, matchesVoiceFood, voiceFoodNames, parseVoiceMeal, voiceIngredientDefault, preferredVoiceIngredient} from './voice-food.js?v=serving-units-1'
import {connectAppleWorkoutImport} from './apple-workout-import.js?v=1'
import {connectWebActivity} from './activity-sync.js?v=watch-sources-1'
import {backupCounts, backupSizeLimit, createBackup, readBackup, restoreBackup} from './journal-backup.js?v=1'
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
function itemCalories(item) {
  const portion = item.serving
  const foodCalories = Number.isFinite(portion?.kcal) && Number.isFinite(portion.count)
    ? portion.count * portion.kcal : item.grams * item.kcal / 100
  return foodCalories + (item.sugarTeaspoons ?? 0) * sugarKcalPerTeaspoon
}
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
// Estimate includes a small amount of the cooking sauce.
const cookedMeatballsWithGreens = ['meatballs-oil-greens', 'קציצות מבושלות עם שמן ועלים', 200,
  [['קציצה בינונית', 65]], 'קציצה קציצות בשר קציצה מבושלת עלים ירוקים עשבי תיבול פטרוזיליה כוסברה סלרי',
  'הערכה לתבשיל ביתי']
const abadiRows = [
  ["manufacturer-abadi-sesame","עוגיות מזרחיות עם שומשום, עבאדי",452,[],"עוגיות עבאדי עוגיות מלוחות בייגלה עבדי","עבאדי","https://abadibakery.co.il/products/%D7%A2%D7%95%D7%92%D7%99%D7%95%D7%AA-%D7%9E%D7%96%D7%A8%D7%97%D7%99%D7%95%D7%AA-%D7%A2%D7%9D-%D7%A9%D7%95%D7%9E%D7%A9%D7%95%D7%9D/"],
  ["manufacturer-abadi-salt","עוגיות מזרחיות מלח, עבאדי",452,[],"עוגיות עבאדי עוגיות מלוחות בייגלה עבדי","עבאדי","https://abadibakery.co.il/products/%D7%A2%D7%95%D7%92%D7%99%D7%95%D7%AA-%D7%9E%D7%96%D7%A8%D7%97%D7%99%D7%95%D7%AA-%D7%9E%D7%9C%D7%97-6/"],
  ["manufacturer-abadi-crispy","עוגיות מזרחיות קריספי, עבאדי",452,[],"עוגיות עבאדי עוגיות מלוחות בייגלה עבדי","עבאדי","https://abadibakery.co.il/products/%D7%A2%D7%95%D7%92%D7%99%D7%95%D7%AA-%D7%9E%D7%96%D7%A8%D7%97%D7%99%D7%95%D7%AA-%D7%A7%D7%A8%D7%99%D7%A1%D7%A4%D7%99/"]
]
const foods = [...foodRows, ...israeliMarketRows, ...abadiRows, ...riceCakeRows, ...soupRows, cookedMeatballsWithGreens].map(([id, name, kcal, portions, aliases, sourceName, sourceUrl]) => ({
  id, name:formatRiceCakeSpelling(hotDrinks.get(id)?.[0] ?? name), kcal,
  portions:id === 4803 ? [['אספרסו קצר', 30], ['אספרסו כפול', 60], ['כוס קפה שחור', 130]] : portions ?? [],
  source:sourceName ?? (typeof id === 'string' && id.startsWith('usda-') ? 'USDA' : 'משרד הבריאות'),
  sourceUrl,
  search:normalize([name, aliases, commonSoups.get(id), ...(hotDrinks.get(id) ?? [])].join(' '))
}))
const cookedChickenCuts = new Map([
  ['ירך', 880, 878, 'ירך|ירכי|ירכיים|פרגית|פרגיות'],
  ['שוק', 856, 855, 'שוק|שוקי|שוקיים'],
  ['כרעיים (ירך ושוק)', 841, 839, 'כרע|כרעיים'],
  ['כנפיים', 896, 895, 'כנף|כנפי|כנפיים'],
  ['חזה', 807, 806, 'חזה|פילה'],
  ['חלקים מעורבים', 'usda-171451', 'usda-171051', 'מעורב|חלקים מעורבים']
].flatMap(([cut, withoutSkin, withSkin, aliases]) => {
  const query = new RegExp('^(?:' + aliases + ')(?: עוף)? מבושל(?:ת|ים|ות)?$')
  return [[withoutSkin, 'ללא עור'], [withSkin, 'עם עור']].map(([id, skin]) =>
    [id, {name:'עוף מבושל · ' + cut + ' · ' + skin, cut, skin, query}])
}))
const foodsByBarcode = new Map(retailFoods.map(food => [food.barcode, food]))
foods.push(...retailFoods.map(food => ({...food, search:normalize(food.name + ' ' + food.aliases)})))
for (const personal of [...(state.customFoods ?? []), ...(state.externalFoods ?? [])]) {
  if (personal.barcode) foodsByBarcode.set(personal.barcode, personal)
  foods.push({...personal, search:normalize(personal.name)})
}
const similarSoundNames = new Set(foods.flatMap(food => voiceFoodNames(food).map(name => foldSimilarHebrewLetters(normalize(name)))))
const similarSoundSearch = new WeakMap()
let catalogTimer
let catalogController
let catalogQuery = ''
let catalogPage = 0
let catalogItems = []
let photoRun = 0
let barcodeOnly = false
let photoCatalogController
let photoBarcode
let customProductBarcode
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
  $('balanceProgress').hidden = !hasTarget
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
    content.append(element('strong', meal.items.map((item) => formatRiceCakeSpelling(item.name)).join(' · ')))
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
  const amount = item.grams + (item.unit === 'ml' ? ' מ״ל' : ' גרם')
  const quantity = item.serving ? item.serving.count + ' × ' + item.serving.name + ' (' + amount + ')' : amount
  return item.sugarTeaspoons ? quantity + ' · ' + item.sugarTeaspoons + ' כפ׳ סוכר' : quantity
}
function formatRiceCakeSpelling(text) {
  return text.replace(/(?<!\p{L})([ובלכמשה]{0,2})פר(?:י?כ|ח)י(ות|ת)(?!\p{L})/gu, '$1פרכי$2')
}
function normalize(text) {
  return text.normalize('NFKD').replace(/[\u0591-\u05c7]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
    .replace(/לחמנייה/gu, 'לחמניה').replace(/לחמניות/gu, 'לחמניה')
    .replace(/פיתות/g, 'פיתה').replace(/פיתת/g, 'פיתה')
    .replace(/(?<!\p{L})פר(?:י?כ|ח)י(?:ות|ת)(?!\p{L})/gu, 'פריכיות')
    .replace(/פריכיות של (?=פיטנס|fitness)/g, 'פריכיות ')
    .replace(/(?:עוגיות|אוגיות|עוגיית|עוגיה|הוא גיוטה|גיוטה)(?: של)? (?:עבאדי|אבאדי|באדי|עבדי)(?!\p{L})/gu, 'עוגיות עבאדי')
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
function foldSimilarHebrewLetters(text) {
  return text.replace(/ע/g, 'א').replace(/[חכך]/g, 'ה')
}
function findFoodMatches(name, spoken) {
  const query = normalize(name).replace(/^נסקפה(?= |$)/, 'נס קפה').replace(/^מרקים(?= |$)/, 'מרק')
  if (!query) return []
  const chicken = cookedChickenMatches(query)
  if (chicken.length) return chicken
  if (isProductCode(query)) {
    const food = foodByBarcode(query)
    return food ? [{food, exact:true, rank:-1}] : []
  }
  const alternate = ({'יוגורט באדי':'באדי תנובה', 'באדי יוגורט':'באדי תנובה'})[query] || spoken && ({'הריסה':'אריסה', 'הריסו':'אריסה', 'חריסה':'אריסה', 'סלק אדום':'סלק', 'טחינה מוכנה':'טחינה'})[query]
  const terms = (alternate || query).split(' ')
  const abadi = terms.includes('עבאדי')
  const sound = spoken && !abadi && !alternate && query !== 'משקאות חמים'
    && /[אעהחכך]/.test(query) ? ' ' + foldSimilarHebrewLetters(query) + ' ' : ''
  const matches = []
  for (const food of foods) {
    if (abadi && !food.search.split(' ').includes('עבאדי')) continue
    const exact = spoken && matchesVoiceFood(food, query, normalize)
    if (exact || (query === 'משקאות חמים'
      ? hotDrinks.has(food.id)
      : terms.every((term) => food.search.includes(term)))) {
      matches.push({food, exact, rank:exact ? -1 : searchRank(food, query)})
    } else if (sound) {
      if (!similarSoundSearch.has(food)) {
        const names = [food.search, ...voiceFoodNames(food).map(normalize)]
        similarSoundSearch.set(food, names.map(text => ' ' + foldSimilarHebrewLetters(text) + ' '))
      }
      if (similarSoundSearch.get(food).some(text => text.includes(sound))) {
        matches.push({food, similarSound:true, rank:6})
      }
    }
  }
  const hasSimilarSpelling = matches.some(entry => entry.similarSound)
  const displayRank = entry => entry.rank + (hasSimilarSpelling && !/[א-ת]/.test(entry.food.name) ? 10 : 0)
  return matches.sort((a, b) => displayRank(a) - displayRank(b)
    || a.food.name.length - b.food.name.length || a.food.name.localeCompare(b.food.name, 'he'))
}
function cookedChickenMatches(query) {
  const allCuts = /^(?:(?:חלקי |בשר )?עוף מבושל(?:ים)?(?: (?:בסיר|במים))?|תבשיל עוף)$/.test(query)
  return [...cookedChickenCuts].flatMap(([id, {name, query:cutQuery}]) => {
    if (!allCuts && !cutQuery.test(query)) return []
    const food = foods.find(food => food.id === id)
    return [{food:{...food, name, portions:[]}, rank:0, chickenCut:true}]
  })
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
  results.classList.remove('chicken-options')
  $('voiceOnlineSingle').hidden = true
  if (voiceMode && voiceMealParts($('foodSearch').value).length > 1) {
    results.replaceChildren()
    clearCatalog()
    return []
  }
  if (!normalize(spoken.query)) { clearCatalog(); results.replaceChildren(); return [] }
  const allMatches = findFoodMatches(spoken.query, voiceMode)
  const chooseChicken = allMatches[0]?.chickenCut
  const matches = showAllFoodMatches(spoken.query, allMatches) ? allMatches : allMatches.slice(0, 18)
  if (chooseChicken || (isProductCode(spoken.query) && matches.length)) clearCatalog()
  else queueCatalog(spoken.query, !matches.length || isProductCode(spoken.query)
    || voiceMode && !matches.some(entry => entry.exact || entry.similarSound || entry.rank < 5))
  $('voiceOnlineSingle').hidden = chooseChicken || Boolean(bridge?.searchProducts)
  const selectMatch = food => voiceMode ? selectSpokenFood(food, spoken) : selectFood(food)
  if (chooseChicken) {
    renderChickenOptions(results, matches, selectMatch)
    return matches
  }
  results.replaceChildren(...(matches.length ? matches.map(({food}) => {
    const row = button(formatRiceCakeSpelling(food.name), 'secondary', () => selectMatch(food))
    const declared = food.portions.find(portion => Number.isFinite(portion[2]))
    row.append(element('span', food.source + ' · ' + (declared
      ? 'כ־' + fmt(declared[2]) + ' קל׳ ל' + declared[0]
      : fmt(food.kcal) + (food.unit === 'ml' ? ' ל־100 מ״ל' : ' ל־100 ג׳'))))
    return row
  }) : [element('p', 'אין תוצאות. אפשר לנסות שם כללי יותר.', 'hint')]))
  return matches
}
function renderChickenOptions(results, matches, selectMatch) {
  const heading = element('p', 'איזה חלק אכלת?', 'chicken-options-title')
  const cards = new Map()
  for (const {food} of matches) {
    const {cut, skin} = cookedChickenCuts.get(food.id)
    if (!cards.has(cut)) {
      const card = element('fieldset', '', 'chicken-choice')
      card.append(element('legend', cut))
      cards.set(cut, card)
    }
    const option = button(skin, 'secondary', () => selectMatch(food))
    option.setAttribute('aria-label', cut + ', ' + skin)
    cards.get(cut).append(option)
  }
  results.classList.add('chicken-options')
  results.replaceChildren(heading, ...cards.values())
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
      const matches = updateSearch()
      setVoiceStatus(foodChoiceMessage(matches) || message + ' אפשר לבדוק את הטקסט ולבחור מנה.')
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
      const transcript = formatRiceCakeSpelling(result?.[0]?.transcript?.trim() ?? '')
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
function foodChoiceMessage(matches) {
  if (matches[0]?.chickenCut) {
    return 'בחר את חלק העוף שאכלת, ואז הזן את המשקל ללא עצמות.'
  }
  if (matches.length && normalize(foodSearchInput().query) === 'פריכיות') {
    return 'נמצאו ' + fmt(matches.length) + ' סוגי פרכיות במאגר. בחר את הסוג שאכלת.'
  }
  if (matches.some(entry => entry.similarSound)) {
    return 'נמצאו גם התאמות בכתיב דומה. בחר את המוצר שהתכוונת אליו.'
  }
  return ''
}
function showAllFoodMatches(query, matches) {
  return normalize(query).split(' ').includes('פריכיות') || matches.some(entry => entry.similarSound)
}
function requiresFoodChoice(query) {
  const name = normalize(query)
  return /^(?:פריכיות(?: דקות)?(?: (?:אורז(?: מלא)?|תירס|כוסמת|חיטה(?: מלאה)?|שיפון|קטניות))?(?: דקות)?|באדי|עבאדי|עוגיות עבאדי)$/.test(name)
    || cookedChickenMatches(name).length > 0
}
function voiceMealParts(text) {
  const spoken = parseVoiceFood(text)
  const known = query => similarSoundNames.has(foldSimilarHebrewLetters(normalize(query)))
    || requiresFoodChoice(query) || preferredVoiceIngredient({query}, normalize) !== undefined
  if (known(spoken.query)) return [spoken]
  return parseVoiceMeal(text, known)
}
function processVoiceMeal(autoSave) {
  releaseVoiceRecognition()?.abort()
  setVoiceControls(false)
  const search = $('foodSearch')
  const transcript = formatRiceCakeSpelling(search.value.trim())
  if (!transcript) return
  search.value = transcript
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
  if (food && !matches.some(entry => entry.similarSound) && !requiresFoodChoice(spoken.query) && !/^(?:טחינה|טחינה מוכנה)$/.test(normalize(spoken.query))) {
    if (selectSpokenFood(food, spoken) && exact.length === 1 && spoken.count !== null && autoSave) {
      voiceTranscript = transcript
      $('foodForm').requestSubmit()
    }
    return
  }
  setVoiceStatus(foodChoiceMessage(matches) || (matches.length
    ? 'בחר את המנה שהתכוונת אליה ובדוק את הכמות.'
    : 'מחפש התאמות בקטלוג המקוון. אפשר גם לערוך את הטקסט.'))
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
  voiceIngredients.filter(row => !row.chooseChicken && !row.candidates.some(food => food.source !== 'USDA'))
    .forEach(searchVoiceIngredient)
}
function makeVoiceIngredient(spoken, index) {
  const card = element('fieldset', '', 'voice-ingredient')
  card.append(element('legend', spoken.query))
  const preferred = preferredVoiceIngredient(spoken, normalize)
  const matches = findFoodMatches(spoken.query, true)
  const hasSimilarSpelling = matches.some(entry => entry.similarSound)
  const preferredFood = hasSimilarSpelling ? undefined : foods.find(food => food.id === preferred)
  const matchingFoods = (showAllFoodMatches(spoken.query, matches) ? matches : matches.slice(0, 15)).map(entry => entry.food)
  const candidates = [...new Map([...(preferredFood ? [preferredFood] : []), ...matchingFoods]
    .map(food => [food.id, food])).values()]
  const product = element('select', '')
  product.id = 'voiceProduct' + index
  const chooseChicken = matches[0]?.chickenCut
  const productLabel = element('label', chooseChicken ? 'חלק העוף' : 'מזון מהמאגר')
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
  const row = {card, spoken, candidates, product, quantity, quantityLabel, unit, details, networkStatus, chooseChicken}
  const online = button('חיפוש באינטרנט', 'quiet', () => searchVoiceIngredient(row))
  online.hidden = chooseChicken
  card.append(productLabel, product, online, networkStatus, quantityLabel, quantity, unit, details)
  setVoiceIngredientOptions(row)
  if (!hasSimilarSpelling && !requiresFoodChoice(spoken.query) && (preferredFood || matches[0]?.exact || matches[0]?.rank < 5)) {
    product.value = String(candidates[0].id)
  }
  product.addEventListener('change', () => setVoiceIngredientQuantity(row))
  quantity.addEventListener('input', () => {
    row.estimate = ''
    row.serving = undefined
    updateVoiceMealTotal()
  })
  unit.addEventListener('change', () => {
    row.serving = undefined
    updateVoiceMealTotal()
  })
  setVoiceIngredientQuantity(row, false)
  return row
}
function setVoiceIngredientOptions(row) {
  const previous = row.product.value
  const options = row.candidates.map(food => {
    const chicken = row.chooseChicken && cookedChickenCuts.get(food.id)
    const label = chicken ? chicken.cut + ' · ' + chicken.skin
      : formatRiceCakeSpelling(food.name) + ' · ' + fmt(food.kcal) + ' קל׳ ל־100 · ' + food.source
    return new Option(label, food.id)
  })
  row.product.replaceChildren(new Option(row.chooseChicken ? 'בחר חלק עוף ואם הוא עם עור' : 'בחר תוצאה', ''), ...options)
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
  row.quantityLabel.textContent = row.chooseChicken ? 'משקל בגרמים ללא עצמות'
    : unit === 'ml' ? 'כמות במ״ל' : unit === 'g' ? 'כמות בגרם' : 'כמות לפי היחידה על האריזה'
  if (!row.chooseChicken || !row.quantity.value) row.quantity.value = proposed.grams ?? ''
  row.serving = proposed.serving
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
  const item = {id:food.id, name:formatRiceCakeSpelling(food.name), kcal:food.kcal, grams, unit}
  if (row.serving) item.serving = row.serving
  return item
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
  $('draftMealTotal').hidden = true
  total.hidden = !items.length
  total.textContent = complete ? 'סה״כ משוער לארוחה: ' + fmt(mealCalories({items})) + ' קלוריות'
    : 'יש להשלים את הרכיבים החסרים כדי לחשב את הסך הכולל.'
  $('saveMeal').disabled = !complete
}
const individualPortion = /^(?:יחידה|גביע(?: |$)|בקבוק(?: |$)|פחית(?: |$))/
function selectFood(food, savedItem, preferSingleServing = false) {
  currentFood = {...food, name:formatRiceCakeSpelling(food.name)}
  $('grams').disabled = false
  $('selectedFood').textContent = currentFood.name
  $('drinkSugar').hidden = !acceptsAddedSugar(food.id)
  $('sugarTeaspoons').disabled = $('drinkSugar').hidden
  $('sugarTeaspoons').value = food.sugarTeaspoons ?? ''
  const online = food.source === 'Open Food Facts' && !food.localCatalog
  $('quantityUnit').hidden = $('quantityUnitLabel').hidden = !online
  $('quantityUnit').required = online
  $('quantityUnit').value = food.unit ?? (online ? '' : 'g')
  if (online && !foods.some((item) => item.id === food.id)) {
    foods.push({...food, search:normalize(food.name)})
    similarSoundNames.add(foldSimilarHebrewLetters(normalize(food.name)))
    state.externalFoods ??= []
    state.externalFoods.push(food)
    persist()
  }
  const portions = [...food.portions]
  if (savedItem?.serving && !portions.some(([name, size, kcal]) =>
    name === savedItem.serving.name && size === savedItem.serving.grams && kcal === savedItem.serving.kcal)) {
    const {name, grams, kcal} = savedItem.serving
    portions.push([name, grams, kcal])
  }
  const unit = $('quantityUnit').value
  const servingOptions = portions
    .filter(([, grams]) => Number.isFinite(grams) && grams > 0)
    .map(([name, grams, kcal], index) => {
      const display = /^(גביע|בקבוק|פחית)( |$)/.test(name) ? 'יחידה – ' + name : name
      const option = new Option(display + ' (' + grams + (unit === 'ml' ? ' מ״ל)' : ' גרם)'), String(index))
      option.dataset.name = name
      option.dataset.grams = grams
      if (Number.isFinite(kcal)) option.dataset.kcal = kcal
      return option
    })
  $('serving').replaceChildren(new Option('גרם', ''), ...servingOptions)
  const savedOption = servingOptions.find((option) =>
    option.dataset.name === savedItem?.serving?.name &&
    Number(option.dataset.grams) === savedItem.serving.grams &&
    (option.dataset.kcal === undefined ? undefined : Number(option.dataset.kcal)) === savedItem.serving.kcal)
  const declaredUnit = savedItem ? undefined : preferSingleServing && servingOptions.length === 1
    ? servingOptions[0] : servingOptions.find(option =>
      /^(גביע|בקבוק|פחית)$/.test(option.dataset.name) ||
      (option.dataset.name === 'יחידה' && option.dataset.kcal !== undefined))
  $('serving').value = savedOption?.value ?? declaredUnit?.value ?? ''
  $('grams').value = savedOption ? savedItem.serving.count : declaredUnit ? 1
    : savedItem?.grams ?? ($('photoTools').hidden ? 100 : '')
  updateQuantity()
  $('portion').hidden = $('addItem').hidden = false
  $('addItem').textContent = editingItem !== null ? 'עדכון רכיב'
    : cookedChickenCuts.has(food.id) ? 'הוספת תוספת' : 'הוספת רכיב'
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
  renderDraftTotal()
}
function searchForFood(query = '') {
  $('foodSearch').value = query
  updateSearch()
  $('foodSearch').focus()
}
function resetPhoto() {
  photoRun++
  barcodeOnly = false
  photoBarcode = undefined
  photoCatalogController?.abort()
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
    row.append(element('span', [formatRiceCakeSpelling(item.name), formatQuantity(item), fmt(itemCalories(item)) + ' קלוריות'].filter(Boolean).join(' · ')))
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
  if (currentFood) updateQuantity()
  else renderDraftTotal()
}
function renderDraftTotal(selectedCalories) {
  const summary = $('draftMealTotal')
  const items = draft.filter((_, index) => index !== editingItem)
  summary.hidden = voiceIngredients.length > 0 || (!items.length && selectedCalories === undefined)
  if (!summary.hidden) {
    summary.textContent = 'סה״כ לארוחה · ' + fmt(mealCalories({items}) + (selectedCalories ?? 0)) + ' קלוריות'
  }
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
  if (currentFood.source === 'Open Food Facts' && !currentFood.unit) {
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
function choosePhoto(camera, productBarcode = false) {
  barcodeOnly = productBarcode
  $('photoStatus').textContent = productBarcode ? 'צלם את הברקוד במלואו, מקרוב ובאור טוב.' : ''
  $(camera ? 'cameraInput' : 'imageInput').value = ''
  if (bridge?.choosePhoto) bridge.choosePhoto(camera)
  else $(camera ? 'cameraInput' : 'imageInput').click()
}
$('photoButton').addEventListener('click', () => {
  openFood(true)
  choosePhoto(true)
})
$('homeBarcodeButton').addEventListener('click', () => {
  openFood(true)
  $('foodTitle').textContent = 'צילום ברקוד'
  choosePhoto(true, true)
})
$('cameraButton').addEventListener('click', () => choosePhoto(true))
$('galleryButton').addEventListener('click', () => choosePhoto(false))
$('barcodeButton').addEventListener('click', () => choosePhoto(true, true))
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
function updateFoodSearchFromInput(event) {
  if (event.isComposing) return
  const search = event.currentTarget
  const spelling = formatRiceCakeSpelling(search.value)
  if (spelling !== search.value) {
    const before = search.value
    const start = formatRiceCakeSpelling(before.slice(0, search.selectionStart)).length
    const end = formatRiceCakeSpelling(before.slice(0, search.selectionEnd)).length
    search.value = spelling
    search.setSelectionRange(start, end)
  }
  const matches = updateSearch()
  if (voiceMode) {
    releaseVoiceRecognition()?.abort()
    voiceTranscript = ''
    setVoiceControls(false)
    showVoiceTranscript('')
    setVoiceStatus(foodChoiceMessage(matches) || 'בחר תוצאה מהמאגר כדי לרשום אותה ביומן.')
  }
}
$('foodSearch').addEventListener('input', updateFoodSearchFromInput)
$('foodSearch').addEventListener('compositionend', updateFoodSearchFromInput)
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
  const query = $('foodSearch').value.trim()
  customProductBarcode = isProductCode(query) ? query : photoBarcode
  $('customProductName').value = isProductCode(query) ? '' : query
  $('customProductBarcode').textContent = customProductBarcode ? 'ברקוד ' + customProductBarcode : ''
  $('customProductBarcode').hidden = !customProductBarcode
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
  const previous = state.customFoods.find(food => customProductBarcode
    ? food.barcode === customProductBarcode
    : !food.barcode && normalize(food.name) === normalize(name) && food.unit === unit)
  const food = {id:previous?.id ?? 'custom-' + crypto.randomUUID(), name, kcal, unit, portions:[], source:'הזנה שלי'}
  if (customProductBarcode) {
    food.barcode = customProductBarcode
    foodsByBarcode.set(food.barcode, food)
  }
  state.customFoods = state.customFoods.filter((item) => item.id !== food.id)
  state.customFoods.push(food)
  const index = foods.findIndex((item) => item.id === food.id)
  const searchable = {...food, search:normalize(name)}
  if (index >= 0) foods[index] = searchable
  else foods.push(searchable)
  similarSoundNames.add(foldSimilarHebrewLetters(searchable.search))
  persist()
  $('customProductDialog').close()
  selectFood(searchable)
  notify('המוצר נשמר לחיפושים הבאים')
})
function selectedServing() {
  const option = $('serving').selectedOptions[0]
  if (option?.dataset.grams) {
    const serving = {name:option.dataset.name, grams:Number(option.dataset.grams)}
    if (option.dataset.kcal !== undefined) serving.kcal = Number(option.dataset.kcal)
    return serving
  }
}
function updateQuantity() {
  if (!currentFood) return
  const unit = $('quantityUnit').value || currentFood.unit
  const label = unit === 'ml' ? 'מ״ל' : unit === 'g' ? 'גרם' : 'גרם או מ״ל לפי האריזה'
  $('per100').textContent = fmt(currentFood.kcal) + ' קלוריות ל־100 ' + label

  const servingSelect = $('serving')
  const showServings = Boolean(unit) && (!currentFood.unit || unit === currentFood.unit) && servingSelect.options.length > 1
  servingSelect.options[0].textContent = unit === 'ml' ? 'מ״ל' : 'גרם'
  servingSelect.hidden = $('servingLabel').hidden = !showServings
  if (!showServings) servingSelect.value = ''
  const serving = selectedServing()
  $('quantityLabel').textContent = serving
    ? (individualPortion.test(serving.name) ? 'מספר יחידות' : 'כמה אכלת לפי המידה שנבחרה?')
    : cookedChickenCuts.has(currentFood.id) ? 'משקל בגרמים ללא עצמות'
    : unit === 'ml' ? 'כמות במ״ל' : unit === 'g' ? 'כמות בגרם' : 'כמות'

  const input = $('grams')
  const count = input.valueAsNumber
  const grams = serving ? serving.grams * count : count
  input.setCustomValidity(grams > 3000 ? 'הכמות הכוללת לא יכולה לעלות על 3,000 ' + label : '')
  const sugar = $('sugarTeaspoons')
  const sugarTeaspoons = sugar.disabled ? 0 : Number(sugar.value)
  const calories = unit && input.validity.valid && sugar.validity.valid
    ? itemCalories({grams, kcal:currentFood.kcal, sugarTeaspoons, serving:serving && {...serving, count}})
    : undefined
  $('quantitySummary').textContent = calories !== undefined
    ? (serving ? new Intl.NumberFormat('he-IL', {maximumFractionDigits:3}).format(grams) + ' ' + label + ' · ' : '') +
      fmt(calories) + ' קלוריות'
    : ''
  renderDraftTotal(calories)
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
  if (isProductCode(query) && foodByBarcode(query)) return
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
      const row = button(formatRiceCakeSpelling(food.name), 'secondary', () => {
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
    $('catalogStatus').textContent = error instanceof TypeError || error.name === 'TimeoutError'
      ? 'החיפוש באינטרנט לא זמין כרגע. אפשר לנסות שוב או לחפש כל רכיב במאגר.'
      : error.message || 'קטלוג המוצרים אינו זמין כרגע.'
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
const goalSteps = [
  ['goalIntro'],
  ['goalHeightStep', 'goalWeightStep', 'goalAgeStep'],
  ['goalPurpose', 'goalActivityStep'],
  ['goalRoutine'],
  ['goalReview']
]
const finalGoalStep = goalSteps.length - 1
const goalSections = goalSteps.flat().map($)

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
  const visibleSections = goalSteps[step]
  for (const section of goalSections) section.hidden = !visibleSections.includes(section.id)
  $('settingsForm').dataset.step = step
  $('goalMessage').textContent = ''
  $('goalProgress').textContent = step > 0 && step < finalGoalStep ? `שלב ${step} מתוך ${finalGoalStep - 1}` : ''
  $('goalBack').hidden = step === 0
  $('goalNext').hidden = step === finalGoalStep
  $('saveGoalButton').hidden = step !== finalGoalStep
  $('goalNext').textContent = step === 0 ? 'מתחילים' : step === finalGoalStep - 1 ? 'לתוכנית שלי' : 'המשך'
  $('skipGoalButton').hidden = step !== 0
  if ($('settingsDialog').open) $(visibleSections[0]).querySelector('h3').focus({preventScroll:true})
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
    1:['goalHeight', 'weightInput', 'goalAge'],
    2:skipEstimate ? [] : ['goalSex', 'goalActivity']
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
    content.append(element('strong', meal.items.map((item) => formatRiceCakeSpelling(item.name)).join(' · ')))
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

function foodByBarcode(code) {
  return foodsByBarcode.get(code) ?? foods.find(food => food.id === 'off-' + code)
}

async function showBarcodeProduct(code, run) {
  const status = $('photoStatus')
  status.textContent = 'נקרא ברקוד ' + code + '. מחפש את המוצר…'
  const controller = new AbortController()
  photoCatalogController = controller
  try {
    const local = foodByBarcode(code)
    const food = local ?? (await searchCatalog(code, 1, controller.signal)).products.find(product =>
      product.id.replace(/^off-0*/, '') === code.replace(/^0+/, ''))
    if (run !== photoRun) return
    if (!food) {
      photoBarcode = code
      status.textContent = 'נקרא ברקוד ' + code + ', אבל לא נמצאו ערכים למוצר. אפשר לחפש לפי שם או להזין מהתווית.'
      return
    }
    status.textContent = 'נמצא מוצר לפי ברקוד ' + code + '. בחר אותו ובדוק את הכמות.'
    const choice = button(food.name, 'secondary', () => selectFood(food, undefined, true))
    choice.append(element('span', ' · ' + fmt(food.kcal) + ' קלוריות ל־100 ' + (food.unit === 'ml' ? 'מ״ל' : 'גרם')))
    $('photoCandidates').replaceChildren(choice)
  } catch {
    if (run !== photoRun) return
    photoBarcode = code
    status.textContent = 'נקרא ברקוד ' + code + ', אך החיפוש המקוון לא זמין כרגע. אפשר לחפש לפי שם או להזין מהתווית.'
  }
}

const backupDialog = $('journalBackupDialog')
const backupFile = $('journalBackupFile')
const backupStatus = $('backupImportStatus')
const restoreButton = $('restoreJournalBackup')
let selectedBackup

$('journalBackupButton').addEventListener('click', () => {
  selectedBackup = undefined
  backupFile.value = ''
  backupStatus.textContent = ''
  $('backupExportStatus').textContent = ''
  restoreButton.hidden = true
  backupDialog.showModal()
})
$('saveJournalBackup').addEventListener('click', () => {
  const status = $('backupExportStatus')
  try {
    const data = createBackup(state)
    const filename = 'calorie-daily-backup-' + dayKey() + '.json'
    const url = URL.createObjectURL(new Blob([data], {type:'application/json'}))
    const link = element('a', '')
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
    status.textContent = 'ההורדה התבקשה. אפשר לבחור כאן את הקובץ שהורדת כדי לבדוק אותו.'
  } catch {
    status.textContent = 'לא ניתן היה ליצור קובץ גיבוי.'
  }
})
backupFile.addEventListener('change', async () => {
  const file = backupFile.files[0]
  selectedBackup = undefined
  backupStatus.textContent = ''
  restoreButton.hidden = true
  if (!file) return
  try {
    if (file.size > backupSizeLimit) throw new Error('Backup too large')
    const backup = readBackup(await file.text())
    if (!backupDialog.open || backupFile.files[0] !== file) return
    selectedBackup = backup
    const {days, meals, misc, workouts, foods} = backupCounts(backup.state)
    const date = new Date(backup.exportedAt).toLocaleString('he-IL')
    backupStatus.textContent = `גיבוי תקין מ־${date}. ${fmt(days)} ימים ביומן, ${fmt(meals)} ארוחות, ${fmt(misc)} רישומי שונות, ${fmt(workouts)} רישומי אימון ו־${fmt(foods)} מזונות שמורים.`
    if (!(days || foods || backup.state.target || backup.state.goal)) {
      backupStatus.textContent += ' אין בקובץ רישומים או יעד לשחזור.'
      return
    }
    backupStatus.textContent += ' השחזור יוסיף את הרישומים החסרים וישמור רישומים תואמים שכבר קיימים.'
    restoreButton.hidden = false
  } catch {
    if (backupFile.files[0] === file) backupStatus.textContent = 'הקובץ לא נקרא כגיבוי תקין של ״קלוריות ביום״.'
  }
})
restoreButton.addEventListener('click', () => {
  if (!selectedBackup) return
  try {
    const current = JSON.parse(localStorage.getItem(storageKey))
    const restored = restoreBackup(current ? {...state, ...current} : state, selectedBackup.state)
    localStorage.setItem(storageKey, JSON.stringify(restored))
  } catch {
    backupStatus.textContent = 'השחזור לא נשמר. הנתונים הקיימים נשארו ביומן.'
    return
  }
  location.reload()
})

async function recognize(file) {
  if (!file) return
  const run = ++photoRun
  const scanOnly = barcodeOnly
  photoBarcode = undefined
  photoCatalogController?.abort()
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
    const code = await import('./barcode.js?v=1').then(reader => reader.readProductCode(image)).catch(() => null)
    if (run !== photoRun) return
    if (code) return await showBarcodeProduct(code, run)
    if (scanOnly) {
      $('photoStatus').textContent = 'הברקוד לא נקרא. אפשר לצלם שוב או להקליד את הספרות בחיפוש.'
      return
    }
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
        const choice = button(formatRiceCakeSpelling(food.name), 'secondary', () => selectFood(food))
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
function showInitialGoal() {
  if (!state.target && !state.onboardingSeen && !document.querySelector('dialog[open]')) openGoal()
}
if ($('commercialJournal')?.hidden) {
  document.addEventListener('calorie-access-ready', showInitialGoal, { once: true })
} else {
  showInitialGoal()
}
