const zipEndSignature = 0x06054b50
const centralSignature = 0x02014b50
const localSignature = 0x04034b50
const activeEnergy = 'HKQuantityTypeIdentifierActiveEnergyBurned'

async function view(blob) {
  return new DataView(await blob.arrayBuffer())
}

async function workoutXml(file) {
  if (/\.xml$/i.test(file.name)) return file.stream()
  const tail = await view(file.slice(Math.max(0, file.size - 65557)))
  let end = tail.byteLength - 22
  while (end >= 0 && (tail.getUint32(end, true) !== zipEndSignature
    || end + 22 + tail.getUint16(end + 20, true) !== tail.byteLength)) end--
  if (end < 0) throw new Error('לא נמצא קובץ ייצוא תקין של Apple Health.')

  const directorySize = tail.getUint32(end + 12, true)
  const directoryStart = tail.getUint32(end + 16, true)
  if (directorySize > 8 * 1024 * 1024 || directoryStart + directorySize > file.size) {
    throw new Error('לא ניתן לפתוח את הארכיון. אפשר לחלץ ממנו את export.xml ולבחור אותו.')
  }
  const directory = await view(file.slice(directoryStart, directoryStart + directorySize))
  const decoder = new TextDecoder()
  for (let entry = 0; entry + 46 <= directory.byteLength;) {
    if (directory.getUint32(entry, true) !== centralSignature) break
    const nameLength = directory.getUint16(entry + 28, true)
    const next = entry + 46 + nameLength + directory.getUint16(entry + 30, true) + directory.getUint16(entry + 32, true)
    if (next > directory.byteLength) break
    const name = decoder.decode(new Uint8Array(directory.buffer, entry + 46, nameLength))
    if (/(?:^|\/)export\.xml$/i.test(name)) {
      const offset = directory.getUint32(entry + 42, true)
      const local = await view(file.slice(offset, offset + 30))
      if (local.byteLength < 30 || local.getUint32(0, true) !== localSignature) break
      const start = offset + 30 + local.getUint16(26, true) + local.getUint16(28, true)
      const length = directory.getUint32(entry + 20, true)
      if (start + length > directoryStart || directory.getUint16(entry + 8, true) & 1) break
      const compressed = file.slice(start, start + length).stream()
      const method = directory.getUint16(entry + 10, true)
      if (method === 0) return compressed
      if (method === 8) {
        try { return compressed.pipeThrough(new DecompressionStream('deflate-raw')) }
        catch { /* An older browser can still read the extracted XML. */ }
      }
      throw new Error('אפשר לחלץ את export.xml מהארכיון באפליקציית ״קבצים״ ולבחור אותו כאן.')
    }
    entry = next
  }
  throw new Error('לא נמצא export.xml בקובץ שנבחר.')
}

function dateValue(text) {
  if (!text) return NaN
  return Date.parse(text.replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d{4})$/, '$1T$2$3'))
}
function energy(value, unit) {
  if (!value?.trim()) return NaN
  const factors = {kcal:1, kJ:1 / 4.184, J:1 / 4184, cal:0.001}
  return Number(value) * (factors[unit] ?? NaN)
}
function workoutEntry(xml, dayStart, dayEnd) {
  const workout = new DOMParser().parseFromString(xml, 'application/xml').documentElement
  if (workout.tagName !== 'Workout') return
  const start = dateValue(workout.getAttribute('startDate'))
  const end = dateValue(workout.getAttribute('endDate'))
  if (!(start >= dayStart && end <= dayEnd && end > start)) return
  const stat = [...workout.children].find(el => el.tagName === 'WorkoutStatistics' && el.getAttribute('type') === activeEnergy)
  const kcal = energy(stat?.getAttribute('sum'), stat?.getAttribute('unit'))
  if (!Number.isFinite(kcal) || kcal < 0) return
  return {source:workout.getAttribute('sourceName')?.trim().slice(0, 120) || 'Apple Health', start, end, kcal}
}

export async function readAppleWorkouts(file, today = new Date()) {
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime()
  const stream = await workoutXml(file)
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const bySource = new Map()
  let buffer = ''
  try {
    while (true) {
      const {value, done} = await reader.read()
      buffer += decoder.decode(value, {stream:!done})
      let cursor = 0
      while (true) {
        const start = buffer.indexOf('<Workout ', cursor)
        if (start < 0) { buffer = buffer.slice(Math.max(cursor, buffer.length - 8)); break }
        const openingEnd = buffer.indexOf('>', start)
        const selfClosed = openingEnd > start && buffer[openingEnd - 1] === '/'
        const closingStart = selfClosed ? openingEnd : buffer.indexOf('</Workout>', openingEnd + 1)
        if (openingEnd < 0 || closingStart < 0) { buffer = buffer.slice(start); break }
        cursor = closingStart + (selfClosed ? 1 : 10)
        const workout = workoutEntry(buffer.slice(start, cursor), dayStart, dayEnd)
        if (workout) {
          if (!bySource.has(workout.source)) bySource.set(workout.source, [])
          bySource.get(workout.source).push(workout)
        }
      }
      if (done) break
      if (buffer.length > 4 * 1024 * 1024) throw new Error('לא ניתן לקרוא את רשומת האימון בקובץ.')
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return [...bySource].map(([name, workouts]) => {
    const unique = []
    for (const workout of workouts.sort((a, b) => a.start - b.start || b.end - a.end || b.kcal - a.kcal)) {
      if (!unique.length || unique[unique.length - 1].end <= workout.start) unique.push(workout)
    }
    return {name, count:unique.length, kcal:unique.reduce((sum, workout) => sum + workout.kcal, 0)}
  }).sort((a,b) => a.name.localeCompare(b.name))
}

export function connectAppleWorkoutImport({dayKey, save}) {
  const fileInput = document.getElementById('appleWorkoutFile')
  const sources = document.getElementById('appleWorkoutSource')
  const sourceLabel = document.getElementById('appleWorkoutSourceLabel')
  const saveButton = document.getElementById('appleWorkoutSave')
  const status = document.getElementById('appleWorkoutStatus')
  let options = []
  let selectedDay
  let request = 0
  function updatePreview() {
    const entry = options[sources.value]
    saveButton.hidden = !entry
    if (entry) status.textContent = entry.count + ' אימונים · ' + Math.round(entry.kcal) + ' קלוריות פעילות. השמירה תחליף את סך האימונים להיום.'
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    fileInput.value = ''
    const version = ++request
    const day = dayKey()
    options = []
    sources.hidden = sourceLabel.hidden = saveButton.hidden = true
    status.textContent = 'קורא את קובץ האימונים במכשיר…'
    try {
      const result = await readAppleWorkouts(file)
      if (version !== request) return
      if (day !== dayKey()) { status.textContent = 'היום התחלף. בחר את הקובץ שוב.'; return }
      if (!result.length) { status.textContent = 'לא נמצאו בקובץ אימונים מהיום עם קלוריות פעילות נפרדות.'; return }
      options = result
      selectedDay = day
      sources.replaceChildren(...options.map(({name}, index) => new Option(name, index)))
      sourceLabel.hidden = sources.hidden = options.length === 1
      updatePreview()
    } catch (error) {
      if (version === request) status.textContent = error.message || 'לא ניתן לקרוא את הקובץ.'
    }
  })
  sources.addEventListener('change', updatePreview)
  saveButton.addEventListener('click', () => {
    const selected = options[sources.value]
    if (!selected) return
    if (selectedDay !== dayKey()) { status.textContent = 'היום התחלף. בחר את הקובץ שוב.'; return }
    save(selected)
    saveButton.hidden = true
    status.textContent = 'האימונים נקלטו והיתרה עודכנה.'
  })
}
