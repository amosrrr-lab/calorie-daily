import israeliBarcodeRows from './israeli-barcode-data.js?v=1'

const curatedRows = [
  ['7290004124205', 'יוגורט יופלה דיאט תות 0%, תנובה', 39, 150],
  ['7290004121488', 'יוגורט יופלה דיאט אפרסק 0%, תנובה', 39, 150],
  ['7290004126759', 'יוגורט יופלה דיאט פירות יער 0%, תנובה', 39, 150, 'https://www.savy.co.il/product/4452'],
  ['7290116934525', 'יוגורט יופלה דיאט וניל 0%, תנובה', 40, 150],
  ['7290116932040', 'יוגורט יופלה דיאט אגס 0%, תנובה', 43, 150],
  ['7290002824466', 'יוגורט דנונה ביו 0%, שטראוס', 44, 200],
  ['7290004127077', 'קוטג׳ תנובה 3% מהדרין', 77, 250],
  ['7290014758681', 'קוטג׳ תנובה 1%', 62, 250],
  ['7290004127329', 'קוטג׳ תנובה 5% מהדרין', 95, 250],
  ['7290004129545', 'גבינה לבנה תנובה 3% מהדרין', 82, 250],
  ['7290000047621', 'גבינה לבנה תנובה 5%', 98, 250]
]

const foodsByCode = new Map(israeliBarcodeRows.map(([barcode, name, kcal, unit, brand, otherNames]) => {
  const displayName = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? name + ' · ' + brand : name
  return [barcode, {
    id:'retail-' + barcode, barcode, name:displayName, kcal, unit, portions:[],
    aliases:otherNames, source:'Open Food Facts',
    sourceUrl:'https://world.openfoodfacts.org/product/' + barcode, localCatalog:true
  }]
}))

for (const [barcode, name, kcal, grams, sourceUrl] of curatedRows) {
  foodsByCode.set(barcode, {
    id:'retail-' + barcode, barcode, name, kcal, unit:'g', portions:[['גביע', grams]],
    aliases:name.includes('יופלה') ? 'yoplait diet דיאט יופלה 0 אחוז' : '',
    source:sourceUrl ? 'Savy' : 'דילי',
    sourceUrl:sourceUrl ?? 'https://deally.co.il/products/' + barcode, localCatalog:true
  })
}

export const retailFoods = [...foodsByCode.values()]
