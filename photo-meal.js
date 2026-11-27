// Quantities are editable starting proportions for cooked food, not estimates of its weight.
export const photoMeals = [
  {name:'מרק ירקות לקוסקוס', labels:[], parts:[['מרק ירקות לקוסקוס',9652,100]]},
  {name:'מרק עוף וירקות לקוסקוס', labels:[], parts:[['מרק עוף לקוסקוס',9618,100]]},
  {name:'קוסקוס עם מרק ירקות', labels:['couscous','vegetable_soup'], parts:[['קוסקוס',2761,55],['מרק ירקות לקוסקוס',9652,45]]},
  {name:'קוסקוס עם מרק עוף וירקות', labels:['couscous','chicken_soup'], parts:[['קוסקוס',2761,55],['מרק עוף לקוסקוס',9618,45]]},
  {name:'אורז עם עוף', labels:['rice','chicken'], parts:[['אורז לבן מבושל',2721,55],['חזה עוף מבושל',807,45]]},
  {name:'עוף עם אורז וירקות', labels:['rice','chicken','vegetable_salad'], parts:[['אורז לבן מבושל',2721,45],['חזה עוף מבושל',807,35],['ירקות מבושלים',4137,20]]},
  {name:'קציצות בקר ברוטב', labels:['meatballs'], parts:[['קציצות בשר ברוטב',672,100]]},
  {name:'קציצות בקר ברוטב עם אורז', labels:['meatballs','rice'], parts:[['קציצות בשר ברוטב',672,55],['אורז לבן מבושל',2721,45]]},
  {name:'בקר מוקפץ עם פטריות וגזר', labels:['beef','mushroom'], parts:[['בקר מוקפץ עם פטריות וגזר',1469,100]]},
  {name:'בקר עם פטריות ואורז', labels:['beef','mushroom','rice'], parts:[['בקר מוקפץ עם פטריות וגזר',1469,60],['אורז לבן מבושל',2721,40]]},
  {name:'שניצל עם פירה', labels:['schnitzel','mashed_potato'], parts:[['שניצל עוף',815,45],['פירה תפוחי אדמה',3505,55]]},
  {name:'שניצל עם פתיתים', labels:['schnitzel','ptitim'], parts:[['שניצל עוף',815,45],['פתיתים מבושלים',2625,55]]},
  {name:'סלמון עם תפוחי אדמה', labels:['grilled_salmon','potato'], parts:[['סלמון אפוי',1298,45],['תפוחי אדמה מבושלים',3459,55]]},
  {name:'סלמון עם אורז וירקות', labels:['grilled_salmon','rice','vegetable_salad'], parts:[['סלמון אפוי',1298,40],['אורז לבן מבושל',2721,40],['ירקות מבושלים',4137,20]]},
  {name:'חביתה וסלט ירקות', labels:['omelette','vegetable_salad'], parts:[['חביתה',1570,45],['סלט ירקות',9704,55]]},
  {name:'פסטה עם קציצות ברוטב', labels:['pasta','meatballs'], parts:[['ספגטי מבושל',8553,55],['קציצות בשר ברוטב',672,45]]},
  {name:'עוף עם תפוחי אדמה וירקות', labels:['chicken','potato'], parts:[['חזה עוף מבושל',807,40],['תפוחי אדמה מבושלים',3459,40],['ירקות מבושלים',4137,20]]},
]

const relatedLabels = {
  rice:['fried_rice','risotto','bibimbap'], chicken:['chicken_breast','chicken_wings','chicken_curry'],
  beef:['steak','filet_mignon'], pasta:['spaghetti_bolognese','spaghetti_carbonara'],
  vegetable_salad:['greek_salad','caesar_salad'], grilled_salmon:['fish'],
}

export function matchingPhotoMeals(labels) {
  const seen = new Set(labels)
  return photoMeals.map(meal => {
    const matched = meal.labels.filter(label => seen.has(label) || relatedLabels[label]?.some(id => seen.has(id))).length
    return {meal, matched}
  }).filter(({meal, matched}) => matched > 0 && matched === meal.labels.length).map(({meal}) => meal)
}

export function distributeMealWeight(total, parts) {
  if (!Number.isFinite(total) || total < 1 || total > 3000 || !parts.length ||
      parts.some(part => !Number.isFinite(part) || part <= 0)) return []
  const units = Math.round(total * 100)
  const sum = parts.reduce((a,b) => a + b, 0)
  let cumulative = 0, previous = 0
  return parts.map(part => {
    cumulative += part
    const next = Math.round(units * cumulative / sum)
    const grams = (next - previous) / 100
    previous = next
    return grams
  })
}
