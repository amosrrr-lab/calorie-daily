import foodRows from './foods-data.js'
import {searchCatalog} from './catalog.js'
import {connectWebActivity} from './activity-sync.js?v=2'
import {connectBalanceWidget} from './balance-widget.js'
const $ = (id) => document.getElementById(id)
const fmt = (number) => Math.round(number).toLocaleString('he-IL')
const bridge = window.CalorieAndroid
let updateBalanceWidget = () => {}
const storageKey = 'calories-per-day.v1'
let state = {target: null, weight: null, source: 'manual', origin: '', days: {}, customFoods:[], externalFoods:[]}
try {
  const saved = JSON.parse(localStorage.getItem(storageKey))
  if (saved && saved.days && typeof saved.days === 'object') state = {...state, ...saved}
} catch { /* The journal starts empty when local storage is unavailable. */ }
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
  if (Number.isFinite(activity?.kcal)) return activity.kcal
  // Recover the central estimate from activity saved by older versions.
  if (Number.isFinite(activity?.low) && Number.isFinite(activity?.high)) {
    return (activity.low + activity.high) / 2
  }
  return 0
}
const itemCalories = (item) => item.grams * item.kcal / 100
const mealCalories = (meal) => meal.items.reduce((sum, item) => sum + itemCalories(item), 0)
let toastTimer
let currentFood
let draft = []
let editingMeal
let editingItem = null
const foods = foodRows.map(([id, name, kcal, portions, aliases, sourceName, sourceUrl]) => ({
  id, name, kcal, portions:portions ?? [],
  source:sourceName ?? (typeof id === 'string' && id.startsWith('usda-') ? 'USDA' : 'משרד הבריאות'),
  sourceUrl,
  search:normalize(name + ' ' + (aliases ?? ''))
}))
for (const personal of [...(state.customFoods ?? []), ...(state.externalFoods ?? [])]) {
  foods.push({...personal, search:normalize(personal.name)})
}
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
  const eaten = day.meals.reduce((sum, meal) => sum + mealCalories(meal), 0)
  const activity = day.activity
  $('date').textContent = new Intl.DateTimeFormat('he-IL', {weekday:'long', day:'numeric', month:'long'}).format(new Date())
  const hasTarget = Boolean(state.target)
  $('goalEmpty').hidden = hasTarget
  $('balanceReadout').hidden = !hasTarget
  $('targetStat').hidden = !hasTarget
  $('targetTotal').textContent = hasTarget ? fmt(state.target) : '—'
  $('eaten').textContent = fmt(eaten)
  const active = Math.round(activityCalories(activity))
  $('activeTotal').textContent = active ? '+' + fmt(active) : '0'
  const mealPlan = state.goal?.times ?? []
  $('routineCard').hidden = !mealPlan.length
  showMealTimes($('todayMealTimes'), mealPlan)
  const available = (state.target ?? 0) + active
  const balance = Math.round(available - eaten)
  $('remaining').textContent = hasTarget ? fmt(balance) : '—'
  updateBalanceWidget({date:dayKey(), target:Math.round(state.target ?? 0), balance})
  const progress = hasTarget ? Math.min(100, Math.round(eaten / available * 100)) : 0
  $('meterFill').style.width = progress + '%'
  $('meterFill').parentElement.setAttribute('aria-valuenow', progress)
  const sources = {phone:'טלפון', watch:'שעון חכם', manual:'ידני'}
  $('activityStatus').textContent = activity ? [
    sources[activity.source], activity.name,
    Number.isFinite(activity.steps) ? fmt(activity.steps) + ' צעדים' : '',
    activity.estimated ? 'הערכה מצעדים' : '',
    fmt(active) + ' קלוריות'
  ].filter(Boolean).join(' · ') : 'טרם נוספה פעילות היום'
  $('activityButton').textContent = activity ? 'עדכון' : 'הגדרה'
  $('mealCount').textContent = day.meals.length ? day.meals.length + (day.meals.length === 1 ? ' ארוחה' : ' ארוחות') : ''
  $('emptyJournal').hidden = day.meals.length > 0
  $('journal').replaceChildren(...[...day.meals].reverse().map((meal) => {
    const row = element('li', '')
    const content = element('div', '', 'entry')
    content.append(element('strong', meal.items.map((item) => item.name).join(' · ')))
    content.append(element('p', fmt(mealCalories(meal)) + ' קלוריות · ' + meal.items.map(formatQuantity).join(' + ')))
    row.append(content, button('עריכה', 'quiet', () => openFood(false, meal)), button('מחיקה', 'remove', () => {
      if (!confirm('למחוק את הארוחה מהיומן?')) return
      day.meals = day.meals.filter((entry) => entry.id !== meal.id)
      persist()
      render()
    }))
    return row
  }))
}
function formatQuantity(item) {
  return item.grams + (item.unit === 'ml' ? ' מ״ל' : ' גרם')
}
function normalize(text) {
  return text.normalize('NFKD').replace(/[\u0591-\u05c7]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
    .replace(/פיתות/g, 'פיתה').replace(/פיתת/g, 'פיתה')
}
function searchRank(food, query) {
  if (normalize(food.name) === query) return 0
  if (food.source === 'USDA') return 5
  if (query === 'קפה' && [4806, 4809, 4810, 4812, 4814, 4800, 4803].includes(food.id)) return 1
  if (query === 'סלט' && [9704, 3895, 9418, 3898, 9383].includes(food.id)) return 1
  return food.search.startsWith(query) ? 2 : 3
}
function updateSearch() {
  const query = normalize($('foodSearch').value).replace(/^נס\s*קפה/, 'קפה')
  const results = $('searchResults')
  queueCatalog($('foodSearch').value.trim())
  if (!query) { results.replaceChildren(); return }
  const terms = query.split(' ')
  const matches = foods.filter((food) => terms.every((term) => food.search.includes(term)))
    .map((food) => ({food, rank:searchRank(food, query)}))
    .sort((a, b) => a.rank - b.rank || a.food.name.length - b.food.name.length || a.food.name.localeCompare(b.food.name, 'he'))
    .slice(0, 18).map(({food}) => food)
  results.replaceChildren(...(matches.length ? matches.map((food) => {
    const row = button(food.name, 'secondary', () => selectFood(food))
    row.append(element('span', food.source + ' · ' + fmt(food.kcal) + (food.unit === 'ml' ? ' ל־100 מ״ל' : ' ל־100 ג׳')))
    return row
  }) : [element('p', 'אין תוצאות. אפשר לנסות שם כללי יותר.', 'hint')]))
}
function selectFood(food, quantity) {
  currentFood = food
  $('selectedFood').textContent = food.name
  const online = food.source === 'Open Food Facts'
  $('quantityUnit').hidden = $('quantityUnitLabel').hidden = !online
  $('quantityUnit').required = online
  $('quantityUnit').value = food.unit ?? (online ? '' : 'g')
  updateQuantity()
  if (online && !foods.some((item) => item.id === food.id)) {
    foods.push({...food, search:normalize(food.name)})
    state.externalFoods ??= []
    state.externalFoods.push(food)
    persist()
  }
  $('grams').value = quantity ?? ($('photoTools').hidden ? 100 : '')
  $('serving').replaceChildren(new Option('כמות בגרמים', ''), ...food.portions.map(([name, grams]) => new Option(name + ' (' + grams + ' ג׳)', grams)))
  $('serving').hidden = $('servingLabel').hidden = food.portions.length === 0
  $('portion').hidden = $('addItem').hidden = false
  $('addItem').textContent = editingItem === null ? 'הוספת רכיב' : 'עדכון רכיב'
  $('foodSearch').value = ''
  $('searchResults').replaceChildren()
  clearCatalog()
  $('saveMeal').disabled = false
}
function clearSelection() {
  currentFood = undefined
  $('grams').value = 100
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
    row.append(element('span', item.name + ' · ' + item.grams + (item.unit === 'ml' ? ' מ״ל · ' : ' גרם · ') + fmt(itemCalories(item)) + ' קלוריות'))
    const actions = element('div', '')
    actions.append(button('עריכה', 'quiet', () => {
      const itemIndex = draft.indexOf(item)
      if (editingItem === itemIndex) { $('grams').focus(); return }
      if (!addSelected()) return
      editingItem = itemIndex
      const catalogFood = foods.find((food) => food.id === item.id)
      selectFood({...catalogFood, ...item, portions:catalogFood?.portions ?? []}, item.grams)
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
function openFood(withPhoto, meal) {
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
  if (!withPhoto && !meal) $('foodSearch').focus()
}
function addSelected() {
  if (!currentFood) return true
  if (!$('grams').reportValidity()) return false
  const {id, name, kcal} = currentFood
  if (!$('quantityUnit').reportValidity()) return false
  const unit = $('quantityUnit').value || currentFood.unit || 'g'
  if (currentFood.source === 'Open Food Facts') {
    const saved = state.externalFoods?.find((food) => food.id === id)
    if (saved) saved.unit = unit
    const available = foods.find((food) => food.id === id)
    if (available) available.unit = unit
  }
  const item = {id, name, kcal, grams:Number($('grams').value), unit}
  if (editingItem === null) draft.push(item)
  else draft[editingItem] = item
  editingItem = null
  clearSelection()
  renderDraft()
  return true
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
$('foodSearch').addEventListener('input', updateSearch)
$('replaceFood').addEventListener('click', () => {
  clearSelection()
  searchForFood()
})
$('otherPhotoFood').addEventListener('click', () => searchForFood())
$('serving').addEventListener('change', () => {
  if ($('serving').value) $('grams').value = $('serving').value
})
$('grams').addEventListener('input', () => { $('serving').value = '' })
$('addItem').addEventListener('click', () => { if (addSelected()) searchForFood() })
$('foodDialog').addEventListener('close', () => { resetPhoto(); clearCatalog() })
$('quantityUnit').addEventListener('change', updateQuantity)
$('foodSearch').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    clearTimeout(catalogTimer)
    loadCatalog($('foodSearch').value.trim(), 1)
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
  persist()
  $('customProductDialog').close()
  selectFood(searchable)
  notify('המוצר נשמר לחיפושים הבאים')
})
function updateQuantity() {
  if (!currentFood) return
  const unit = $('quantityUnit').value || currentFood.unit
  const label = unit === 'ml' ? 'מ״ל' : unit === 'g' ? 'גרם' : 'גרם או מ״ל לפי האריזה'
  $('per100').textContent = fmt(currentFood.kcal) + ' קלוריות ל־100 ' + label
  $('quantityLabel').textContent = unit === 'ml' ? 'כמות במ״ל' : unit === 'g' ? 'כמות בגרם' : 'כמות'
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
function queueCatalog(query) {
  clearTimeout(catalogTimer)
  catalogController?.abort()
  if (query.length < 2) { clearCatalog(); return }
  if (!bridge?.searchProducts) {
    $('catalogStatus').textContent = 'חיפוש מוצרים ומותגים מקוון זמין באפליקציית Android.'
    return
  }
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
      const row = button(food.name, 'secondary', () => selectFood(food))
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
  if (!addSelected() || !draft.length) return
  const day = today()
  const index = day.meals.findIndex((meal) => meal.id === editingMeal)
  if (index >= 0) day.meals[index] = {...day.meals[index], items:draft}
  else day.meals.push({id:crypto.randomUUID(), items:draft})
  persist()
  render()
  $('foodDialog').close()
  notify('הארוחה נשמרה')
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
  $('wakeTime').value = profile.wake ?? '07:00'
  $('sleepTime').value = profile.sleep ?? '23:00'
  $('mealFrequency').value = profile.meals ?? 3
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

function clockMinutes(clock) {
  const [hour, minute] = clock.split(':').map(Number)
  return hour * 60 + minute
}

function awakeMinutes(wake, sleep) {
  return (clockMinutes(sleep) - clockMinutes(wake) + 1440) % 1440
}

function mealTimes(wake, sleep, count) {
  const first = clockMinutes(wake) + 60
  const interval = (awakeMinutes(wake, sleep) - 180) / (count - 1)
  return Array.from({length:count}, (_, index) => {
    const minute = Math.round((first + index * interval) / 15) * 15 % 1440
    return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0')
  })
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
  const wake = $('wakeTime').value
  const sleep = $('sleepTime').value
  const meals = number('mealFrequency')
  const favorite = $('favoriteActivity').value
  goalDraft = {direction, weight, profile:{age, height, sex, activity, wake, sleep, meals, favorite}, times:mealTimes(wake, sleep, meals)}
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
    5:skipEstimate ? [] : ['goalActivity'],
    6:['wakeTime','sleepTime']
  }
  const invalid = (required[goalStep] ?? []).map($).find((field) => !field.value || !field.checkValidity())
  if (invalid) {
    $('goalMessage').textContent = 'יש למלא את השדה כדי להמשיך.'
    invalid.focus()
    return
  }
  if (goalStep === finalGoalStep - 1) {
    const hours = awakeMinutes($('wakeTime').value, $('sleepTime').value)
    if (hours < 6 * 60 || hours > 22 * 60) {
      $('goalMessage').textContent = 'בחר שעות קימה ושינה שביניהן לפחות 6 שעות ועד 22 שעות.'
      return
    }
    calculatePlan()
  } else showGoalStep(goalStep + 1)
}

function previousGoalStep() {
  if (!goalStep) return
  const back = goalReviewMode === 'manual' ? 0 : goalStep - 1
  goalReviewMode = ''
  showGoalStep(back)
}

$('settingsButton').addEventListener('click', openGoal)
$('setupButton').addEventListener('click', openGoal)
$('editPlanButton').addEventListener('click', openGoal)
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
  const meals = state.days[$('historyDate').value]?.meals ?? []
  $('historyList').replaceChildren(...[...meals].reverse().map((meal) => {
    const row = element('li', '')
    const content = element('div', '', 'entry')
    content.append(element('strong', meal.items.map((item) => item.name).join(' · ')))
    content.append(element('p', fmt(mealCalories(meal)) + ' קלוריות · ' + meal.items.map(formatQuantity).join(' + ')))
    row.append(content)
    return row
  }))
}
$('historyButton').addEventListener('click', () => {
  const dates = Object.entries(state.days)
    .filter(([date, day]) => date !== dayKey() && day.meals?.length)
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
    $('photoCandidates').replaceChildren(...choices.map((name) => {
      const query = normalize(name)
      const match = foods.find((food) => normalize(food.name) === query && Number.isFinite(food.kcal))
      const choice = button(name, 'secondary', () => {
        if (match) selectFood(match)
        else searchForFood(name === 'סוגי קפה' ? 'קפה' : name)
      })
      if (match) choice.append(element('span', ' · ' + fmt(match.kcal) + ' קלוריות ל־100 ' + (match.unit === 'ml' ? 'מ״ל' : 'גרם')))
      return choice
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
    storeActivity(result.source, result.kcal, {name:result.name, steps:result.steps, estimated:result.estimated})
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
  weight: () => state.weight,
  currentSource: () => state.origin,
  refreshJournal: () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey))
      if (saved?.days && typeof saved.days === 'object') state = {...state, ...saved}
    } catch { /* Retain the in-memory journal. */ }
    render()
  },
  save: ({source, kcal, steps, estimated}) => {
    state.origin = source
    storeActivity('watch', kcal, {name:source === 'zepp' ? 'Zepp' : 'Samsung Health', steps, estimated})
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
