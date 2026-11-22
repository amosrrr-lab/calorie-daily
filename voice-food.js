const quantities = new Map([
  ['חצי', 0.5], ['רבע', 0.25], ['אחת', 1], ['אחד', 1],
  ['שני', 2], ['שתי', 2], ['שתיים', 2], ['שניים', 2],
  ['שלוש', 3], ['שלושה', 3], ['ארבע', 4], ['ארבעה', 4],
  ['חמש', 5], ['חמישה', 5], ['שש', 6], ['שישה', 6],
  ['שבע', 7], ['שמונה', 8], ['תשע', 9], ['עשר', 10],
  ['עשרים', 20], ['שלושים', 30], ['ארבעים', 40], ['חמישים', 50],
  ['שישים', 60], ['שבעים', 70], ['שמונים', 80], ['תשעים', 90],
  ['מאה', 100], ['מאה חמישים', 150], ['מאה וחמישים', 150], ['מאתיים', 200]
])
const measurements = new Map([
  ['גרם', 'g'], ['גרמים', 'g'], ['מ״ל', 'ml'], ['מיליליטר', 'ml'],
  ['כוס', 'כוס'], ['כוסות', 'כוס'], ['כף', 'כף'], ['כפות', 'כף'],
  ['כפית', 'כפית'], ['כפיות', 'כפית'], ['יחידה', 'יחידה'], ['יחידות', 'יחידה']
])
const numberPattern = '[0-9]+(?:[.,][0-9]+)?|' + [...quantities.keys()]
  .sort((a, b) => b.length - a.length).join('|')
const unitPattern = [...measurements.keys()].sort((a, b) => b.length - a.length).join('|')
const prefix = new RegExp('^(' + numberPattern + ')(?:\\s+(' + unitPattern + '))?\\s+(.+)$')
const singularMeasure = /^(כוס|כף|כפית|יחידה)\s+(.+)$/
const suffix = new RegExp('^(.+?)\\s+(' + numberPattern + ')\\s+(' + unitPattern + ')$')

export function parseVoiceFood(transcript) {
  const text = transcript.trim().replace(/[\u0591-\u05bd\u05bf-\u05c7]/g, '')
    .replace(/[.!?。]+$/u, '').replace(/מ\s*["״']\s*ל/g, 'מ״ל').replace(/\s+/g, ' ')
  if (/^לא(?:\s|$)/.test(text)) return {query:'', count:null, unit:null}
  const phrase = text.replace(/^(?:(?:אני )?אכלתי|(?:אני )?שתיתי|תוסיף(?: לי)?|תרשום(?: לי)?)\s+/, '')
    .replace(/^את\s+/, '').replace(/^(?:היום|עכשיו)\s+/, '')
  const leading = phrase.match(prefix)
  const trailing = !leading && phrase.match(suffix)
  const measure = !leading && !trailing && phrase.match(singularMeasure)
  const amount = leading?.[1] ?? trailing?.[2]
  const count = amount ? quantities.get(amount) ?? Number(amount.replace(',', '.')) : measure ? 1 : null
  const unit = measurements.get(leading?.[2] ?? trailing?.[3] ?? measure?.[1]) ?? null
  const query = (leading?.[3] ?? trailing?.[1] ?? measure?.[2] ?? phrase).replace(/^של\s+/, '')
  return {query, count, unit}
}

const spokenAliases = new Map([
  [1564, ['ביצה קשה', 'ביצים קשות']],
  [2721, ['אורז לבן מבושל', 'אורז מבושל ללא שמן']],
  [3225, ['בננה', 'בננות']],
  ['meatballs-oil-greens', ['קציצה מבושלת עם שמן ועלים', 'קציצה עם שמן ועלים', 'קציצות עם שמן ועלים']]
])

export function matchesVoiceFood(food, query, normalize) {
  return normalize(food.name) === query || (spokenAliases.get(food.id) ?? []).some(name => normalize(name) === query)
}

export function resolveVoiceQuantity(food, {count, unit}, normalize) {
  const base = food.unit ?? (food.source === 'Open Food Facts' ? null : 'g')
  if (count === null || !Number.isFinite(count) || count <= 0 || !base) return
  if (unit === 'g' || unit === 'ml') return unit === base && count <= 3000 ? {grams:count} : undefined
  if (base !== 'g') return
  const portions = food.portions.filter(([, grams]) => Number.isFinite(grams) && grams > 0)
  const primary = portions.filter(([name]) => normalize(name) === (unit ?? 'יחידה'))
  const medium = portions.filter(([name]) => /^(?:יחידה|קציצה) בינונית$/.test(normalize(name)))
  const byUnit = unit && unit !== 'יחידה'
    ? portions.filter(([name]) => normalize(name).startsWith(unit + ' '))
    : portions.filter(([name, grams]) => grams < 1000 && !/^(כוס|כף|כפית|קילוגרם|חבילה|בקבוק|שקית)( |$)/.test(normalize(name)))
  const candidates = primary.length ? primary : (!unit || unit === 'יחידה') && medium.length ? medium : byUnit
  if (candidates.length !== 1) return
  const [name, grams] = candidates[0]
  if (grams * count <= 3000) return {grams:grams * count, serving:{name, grams, count}}
}
