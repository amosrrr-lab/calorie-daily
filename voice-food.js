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
  ['כפית', 'כפית'], ['כפיות', 'כפית'], ['פרוסה', 'פרוסה'], ['פרוסות', 'פרוסה'], ['יחידה', 'יחידה'], ['יחידות', 'יחידה']
])
const numberPattern = '[0-9]+(?:[.,][0-9]+)?|' + [...quantities.keys()]
  .sort((a, b) => b.length - a.length).join('|')
const unitPattern = [...measurements.keys()].sort((a, b) => b.length - a.length).join('|')
const prefix = new RegExp('^(' + numberPattern + ')(?:\\s+(' + unitPattern + '))?\\s+(.+)$')
const singularMeasure = /^(כוס|כף|כפית|פרוסה|יחידה)\s+(.+)$/
const suffix = new RegExp('^(.+?)\\s+(' + numberPattern + ')\\s+(' + unitPattern + ')$')

export function parseVoiceFood(transcript) {
  const text = transcript.trim().replace(/[\u0591-\u05bd\u05bf-\u05c7]/g, '')
    .replace(/[.!?。]+$/u, '').replace(/מ\s*["״']\s*ל/g, 'מ״ל').replace(/\s+/g, ' ')
  if (/^לא(?:\s|$)/.test(text)) return {query:'', count:null, unit:null}
  const phrase = text.replace(/^(?:(?:אני )?אכלתי|(?:אני )?שתיתי|תוסיף(?: לי)?|תרשום(?: לי)?)\s+/, '')
    .replace(/^את\s+/, '').replace(/^(?:היום|עכשיו)\s+/, '')
  const qualifier = phrase.match(/^(קצת|ביס(?: קטן)?(?=\s|$)(?:\s+מ(?:ה)?)?|פרוסה קטנה(?: של| מ| מה)?|חתיכה קטנה(?: של| מ| מה)?)\s*/u)
  if (qualifier && phrase.length > qualifier[0].length) {
    const kind = qualifier[1].startsWith('ביס') ? 'bite' : qualifier[1] === 'קצת' ? 'little' : 'small'
    const parsed = parseVoiceFood(phrase.slice(qualifier[0].length))
    return parsed.count === null ? {...parsed, kind} : parsed
  }
  const approximate = /^(?:בערך\s+|כ[-־]\s*|כ(?=\d))/u
  const portion = phrase.replace(approximate, '')
  const leading = portion.match(prefix)
  const trailing = !leading && portion.match(suffix)
  const measure = !leading && !trailing && portion.match(singularMeasure)
  const amount = leading?.[1] ?? trailing?.[2]
  const count = amount ? quantities.get(amount) ?? Number(amount.replace(',', '.')) : measure ? 1 : null
  const unit = measurements.get(leading?.[2] ?? trailing?.[3] ?? measure?.[1]) ?? null
  const query = (leading?.[3] ?? trailing?.[1] ?? measure?.[2] ?? portion).replace(/^של\s+/, '')
  return approximate.test(phrase) ? {query, count, unit, approximate:true} : {query, count, unit}
}

const spokenAliases = new Map([
  [1564, ['ביצה קשה', 'ביצים קשות']],
  [2721, ['אורז לבן מבושל', 'אורז מבושל ללא שמן']],
  [3225, ['בננה', 'בננות']],
  [2432, ['עוגיית תמרים', 'עוגיית תמרים מגולגלת', 'עוגיות תמרים מגולגלות']],
  [3030, ['גחנון', 'ג חנון', 'גחנות', 'גחנונים', 'ג חנון אפוי']],
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

export function parseVoiceMeal(transcript) {
  const text = transcript.trim().replace(/[\u0591-\u05bd\u05bf-\u05c7]/g, '')
    .replace(/^(?:(?:אני )?אכלתי|(?:אני )?שתיתי|תוסיף(?: לי)?|תרשום(?: לי)?)\s+/, '')
    .replace(/^את\s+/, '').replace(/^(?:היום|עכשיו)\s+/, '')
  if (/^לא(?:\s|$)/.test(text)) return []
  const parts = text.split(/\s+עם\s+|,(?!\d)\s*|\s+וגם\s+|\s+ו[-־]\s*|\s+ו(?!(?:ניל|פל|ופל|יסקי|ודקה|יטמין|עשרים|שלושים|ארבעים|חמישים|שישים|שבעים|שמונים|תשעים)(?:\s|$))(?=[\p{L}\d])/u)
    .map(parseVoiceFood).filter(part => part.query)
  return parts
}

const typicalVoiceIngredients = new Map([
  ['לחמניה', {id:10124, grams:60, portion:'לחמנייה אחת'}],
  ['נקניק', {id:8874, grams:40, portion:'שתי פרוסות'}],
  ['פסטרמה', {id:1119, grams:44, portion:'שתי פרוסות'}],
  ['חומוס', {id:1646, grams:12, portion:'כף שטוחה'}],
  ['ממרח חומוס', {id:1646, grams:12, portion:'כף שטוחה'}],
  ['טחינה', {grams:15, portion:'כף'}],
  ['מיונז', {grams:15, portion:'כף'}],
  ['קטשופ', {grams:15, portion:'כף'}],
  ['חמאה', {grams:5, portion:'כפית'}]
])

// Editable estimates for common descriptions where the catalog has no matching measure.
const smallVoicePortions = new Map([
  [2432, {little:10, bite:8, small:18}],
  [3030, {little:20, bite:10, small:15}],
  [3223, {little:20, bite:10, small:10}],
  [1646, {little:12}],
  [1564, {little:20, bite:10}]
])

export function voiceIngredientDefault(food, spoken, normalize) {
  const explicit = resolveVoiceQuantity(food, spoken, normalize)
  if (explicit) return {...explicit, estimated:Boolean(spoken.approximate)}
  if (spoken.kind) {
    const amounts = smallVoicePortions.get(food.id)
    const grams = amounts?.[spoken.kind]
    const names = {little:'כמות קטנה', bite:'ביס', small:'חתיכה קטנה'}
    return grams ? {grams, portion:names[spoken.kind], estimated:true} : {grams:''}
  }
  const base = food.unit ?? (food.source === 'Open Food Facts' ? null : 'g')
  if ((spoken.unit === 'g' || spoken.unit === 'ml') && (!base || base === spoken.unit)) {
    return {grams:spoken.count > 0 && spoken.count <= 3000 ? spoken.count : '', estimated:Boolean(spoken.approximate), unit:spoken.unit}
  }
  const portions = food.portions.filter(([, grams]) => Number.isFinite(grams) && grams > 0 && grams < 3000)
  const typical = typicalVoiceIngredients.get(normalize(spoken.query))
  if (spoken.count !== null) {
    if (!typical || spoken.unit || !/^(?:לחמניה|פסטרמה|נקניק)$/.test(normalize(spoken.query))) return {grams:''}
    const grams = typical.grams * spoken.count
    return grams > 0 && grams <= 3000 ? {grams, estimated:true} : {grams:''}
  }
  if (typical && base !== 'ml') return {...typical, estimated:true}
  const standard = portions.find(([name]) => /^(מנה|יחידה|פרוסה) בינונית$/.test(normalize(name)))
    ?? portions.find(([name]) => /^(מנה|יחידה|פרוסה|כף|כוס)$/.test(normalize(name)))
  return standard ? {grams:standard[1], portion:standard[0], estimated:true}
    : {grams:''}
}

export function preferredVoiceIngredient(spoken, normalize) {
  return typicalVoiceIngredients.get(normalize(spoken.query))?.id
}
