let sequence = 0
const pending = new Map()

export function catalogFood(product) {
  const code = String(product.code ?? '').trim()
  const name = product.product_name_he || product.product_name || product.product_name_en
  const nutrients = product.nutriments ?? {}
  const explicit = nutrients['energy-kcal_100g']
  const kilojoules = nutrients['energy-kj_100g']
  const kcal = explicit != null && explicit !== '' ? Number(explicit)
    : kilojoules != null && kilojoules !== '' ? Number(kilojoules) / 4.184 : NaN
  if (!code || typeof name !== 'string' || !name.trim() || !Number.isFinite(kcal) || kcal < 0) return null
  const brands = Array.isArray(product.brands) ? product.brands.join(', ') : product.brands ?? ''
  const displayName = brands && !name.toLowerCase().includes(String(brands).toLowerCase())
    ? name.trim() + ' · ' + brands : name.trim()
  const unit = ['g', 'ml'].includes(product.product_quantity_unit) ? product.product_quantity_unit : null
  return {
    id:'off-' + code, name:displayName, kcal, portions:[], unit,
    source:'Open Food Facts', sourceUrl:'https://world.openfoodfacts.org/product/' + encodeURIComponent(code)
  }
}

export function searchCatalog(query, page, signal) {
  const bridge = window.CalorieAndroid
  if (!bridge?.searchProducts) return searchWebCatalog(query, page, signal)
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      pending.delete(id)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Search cancelled', 'AbortError'))
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('חיפוש המוצרים התעכב. אפשר לנסות שוב.'))
    }, 15000)
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, {once:true})
    pending.set(id, {
      resolve:(value) => { cleanup(); resolve(value) },
      reject:(error) => { cleanup(); reject(error) }
    })
    bridge.searchProducts(query, page, id)
  })
}
async function searchWebCatalog(query, page, signal) {
  const url = /^\d{8,14}$/.test(query)
    ? new URL('/api/v2/product/' + query + '.json', 'https://world.openfoodfacts.org')
    : new URL('/cgi/search.pl', 'https://world.openfoodfacts.org')
  url.search = new URLSearchParams({
    search_terms:query, search_simple:1, action:'process', json:1, page, page_size:12,
    fields:'code,product_name_he,product_name,product_name_en,nutriments,brands,product_quantity_unit'
  })
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000)
  const response = await fetch(url, {signal:requestSignal, credentials:'omit'})
  if (!response.ok) throw new Error('קטלוג המוצרים אינו זמין כרגע. אפשר לנסות שוב.')
  const result = await response.json()
  const products = (result.products ?? (result.product ? [result.product] : [])).map(catalogFood).filter(Boolean)
  return {products, next:Number(result.page) < Number(result.page_count)}
}
window.onCalorieCatalog = (id, raw, error) => {
  const request = pending.get(id)
  if (!request) return
  if (error) { request.reject(new Error(error)); return }
  try {
    const result = JSON.parse(raw)
    const products = result.hits.map(catalogFood).filter(Boolean)
    request.resolve({products, next:result.page < result.page_count})
  } catch {
    request.reject(new Error('מאגר המוצרים החזיר תשובה שלא ניתן לקרוא.'))
  }
}
