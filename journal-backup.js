const format = 'calorie-daily-journal'
export const backupSizeLimit = 16 * 1024 * 1024

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const list = (value, check) => Array.isArray(value) && value.every(check)
const optional = (value, check) => value == null || check(value)
const nonnegative = value => Number.isFinite(value) && value >= 0
const string = value => typeof value === 'string'
const identifier = value => (string(value) && value.length > 0) || Number.isSafeInteger(value)
const record = value => object(value) && identifier(value.id)
const food = value => record(value) && string(value.name) && nonnegative(value.kcal)
const serving = value => object(value) && string(value.name)
  && nonnegative(value.grams) && nonnegative(value.count) && optional(value.kcal, nonnegative)
const meal = value => record(value) && list(value.items, item => food(item)
  && nonnegative(item.grams) && optional(item.sugarTeaspoons, nonnegative)
  && optional(item.serving, serving))
const day = value => object(value)
  && optional(value.meals, entries => list(entries, meal))
  && optional(value.miscEntries, entries => list(entries, entry => record(entry)
    && nonnegative(entry.kcal) && optional(entry.description, string)))
  && optional(value.activity, entry => object(entry) && string(entry.source)
    && optional(entry.kcal, nonnegative) && optional(entry.workoutKcal, nonnegative))
  && optional(value.target, nonnegative)
const savedFood = value => food(value) && list(value.portions, portion =>
  Array.isArray(portion) && string(portion[0]) && nonnegative(portion[1]) && optional(portion[2], nonnegative))
  && optional(value.barcode, string) && optional(value.source, string) && optional(value.unit, string)
const goal = value => object(value) && optional(value.times, times => list(times, string))
  && optional(value.profile, object)

function validState(value) {
  return object(value) && object(value.days)
    && Object.entries(value.days).every(([date, entry]) => /^\d{4}-\d{1,2}-\d{1,2}$/.test(date) && day(entry))
    && optional(value.target, nonnegative) && optional(value.weight, nonnegative)
    && optional(value.goal, goal) && optional(value.source, string) && optional(value.origin, string)
    && optional(value.customFoods, foods => list(foods, savedFood))
    && optional(value.externalFoods, foods => list(foods, savedFood))
}

export function createBackup(state, exportedAt = new Date().toISOString()) {
  if (!validState(state)) throw new Error('Invalid journal data')
  return JSON.stringify({format, version:1, exportedAt, state})
}

export function readBackup(text) {
  const backup = JSON.parse(text)
  if (backup?.format !== format || backup.version !== 1
      || !string(backup.exportedAt) || !Number.isFinite(Date.parse(backup.exportedAt))
      || !validState(backup.state)) throw new Error('Invalid journal backup')
  return backup
}

const hasRecords = day => Boolean(day.meals?.length || day.miscEntries?.length || day.activity)

export function backupCounts(state) {
  const days = Object.values(state.days).filter(hasRecords)
  return {
    days: days.length,
    meals: days.reduce((total, day) => total + (day.meals?.length ?? 0), 0),
    misc: days.reduce((total, day) => total + (day.miscEntries?.length ?? 0), 0),
    workouts: days.filter(day => day.activity).length,
    foods: (state.customFoods?.length ?? 0) + (state.externalFoods?.length ?? 0)
  }
}

function addMissing(existing, fromBackup, key = entry => entry.id) {
  const known = new Set((existing ?? []).map(key))
  return [...(existing ?? []), ...(fromBackup ?? []).filter(entry => {
    const id = key(entry)
    if (known.has(id)) return false
    known.add(id)
    return true
  })]
}

export function restoreBackup(existing, fromBackup) {
  const days = {...existing.days}
  for (const [date, savedDay] of Object.entries(fromBackup.days)) {
    const current = days[date]
    days[date] = current ? {
      ...savedDay, ...current,
      meals:addMissing(current.meals, savedDay.meals),
      miscEntries:addMissing(current.miscEntries, savedDay.miscEntries),
      activity:current.activity ?? savedDay.activity ?? null
    } : savedDay
  }
  const hasPreferences = existing.target != null || existing.weight != null
    || Boolean(existing.goal || existing.origin) || existing.source !== 'manual'
  const base = hasPreferences ? {...fromBackup, ...existing} : {...existing, ...fromBackup}
  return {
    ...base, days,
    onboardingSeen:true,
    customFoods:addMissing(existing.customFoods, fromBackup.customFoods, item => item.barcode ?? item.id),
    externalFoods:addMissing(existing.externalFoods, fromBackup.externalFoods)
  }
}
