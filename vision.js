import * as ort from './ort.wasm.min.mjs'
const base = new URL('./', import.meta.url)
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false
ort.env.wasm.wasmPaths = base.href
export const foodNames = {"apple_pie":"פאי תפוחים","baby_back_ribs":"צלעות","baklava":"בקלאווה","beef_carpaccio":"קרפצ׳יו","beef_tartare":"טרטר בקר","beet_salad":"סלט סלק","beignets":"בנייה","bibimbap":"אורז קוריאני","bread_pudding":"פודינג לחם","breakfast_burrito":"בוריטו","bruschetta":"ברוסקטה","caesar_salad":"סלט קיסר","cannoli":"קנולי","caprese_salad":"קפרזה","carrot_cake":"עוגת גזר","ceviche":"סביצ׳ה","cheese_plate":"גבינה","cheesecake":"עוגת גבינה","chicken_curry":"עוף קארי","chicken_quesadilla":"קסדייה עוף","chicken_wings":"כנפיים","chocolate_cake":"עוגת שוקולד","chocolate_mousse":"מוס שוקולד","churros":"צ׳ורוס","clam_chowder":"מרק צדפות","club_sandwich":"כריך","crab_cakes":"קציצות סרטן","creme_brulee":"קרם ברולה","croque_madame":"טוסט","cup_cakes":"קאפקייק","deviled_eggs":"ביצים ממולאות","donuts":"סופגנייה","dumplings":"כיסונים","edamame":"אדממה","eggs_benedict":"ביצים בנדיקט","escargots":"חלזונות","falafel":"פלאפל","filet_mignon":"פילה בקר","fish_and_chips":"דג מטוגן","foie_gras":"כבד אווז","french_fries":"צ׳יפס","french_onion_soup":"מרק בצל","french_toast":"פרנץ׳ טוסט","fried_calamari":"קלמארי","fried_rice":"אורז מטוגן","frozen_yogurt":"יוגורט קפוא","garlic_bread":"לחם שום","gnocchi":"ניוקי","greek_salad":"סלט יווני","grilled_cheese_sandwich":"טוסט גבינה","grilled_salmon":"סלמון","guacamole":"סלט אבוקדו","gyoza":"גיוזה","hamburger":"המבורגר","hot_and_sour_soup":"מרק חמוץ חריף","hot_dog":"נקניקייה","huevos_rancheros":"ביצים ברוטב עגבניות","hummus":"חומוס","ice_cream":"גלידה","lasagna":"לזניה","lobster_bisque":"מרק לובסטר","lobster_roll_sandwich":"כריך לובסטר","macaroni_and_cheese":"מקרוני גבינה","macarons":"מקרון","miso_soup":"מרק מיסו","mussels":"מולים","nachos":"נאצ׳וס","omelette":"חביתה","onion_rings":"טבעות בצל","oysters":"צדפות","pad_thai":"פאד תאי","paella":"פאייה","pancakes":"פנקייק","panna_cotta":"פנה קוטה","peking_duck":"ברווז","pho":"פו","pizza":"פיצה","pork_chop":"צלע חזיר","poutine":"צ׳יפס","prime_rib":"אנטריקוט","pulled_pork_sandwich":"כריך חזיר","ramen":"ראמן","ravioli":"רביולי","red_velvet_cake":"עוגת רד ולווט","risotto":"ריזוטו","samosa":"סמוסה","sashimi":"סשימי","scallops":"צדפות","seaweed_salad":"סלט אצות","shrimp_and_grits":"שרימפס","spaghetti_bolognese":"ספגטי בולונז","spaghetti_carbonara":"ספגטי קרבונרה","spring_rolls":"אגרול","steak":"סטייק","strawberry_shortcake":"עוגת תות","sushi":"סושי","tacos":"טאקו","takoyaki":"טאקויאקי","tiramisu":"טירמיסו","tuna_tartare":"טרטר טונה","waffles":"וופל","coffee":"קפה","tea":"תה","hot_chocolate":"שוקו","milk":"חלב","water":"מים","orange_juice":"מיץ תפוזים","cola":"קולה","beer":"בירה","wine":"יין","smoothie":"שייק","vegetable_salad":"סלט ירקות","vegetable_soup":"מרק ירקות","chicken_soup":"מרק עוף","bread":"לחם","pita":"פיתה","rice":"אורז","couscous":"קוסקוס","avocado":"אבוקדו","banana":"בננה","apple":"תפוח","yogurt":"יוגורט","oatmeal":"דייסה","scrambled_eggs":"ביצה מקושקשת","fried_egg":"ביצת עין","shakshuka":"שקשוקה","croissant":"קרואסון","bagel":"בייגל","schnitzel":"שניצל","chicken_breast":"חזה עוף","tahini":"טחינה","boiled_egg":"ביצה קשה","dates":"תמר","nuts":"אגוזים","chocolate":"שוקולד","cereal":"דגני בוקר","cottage_cheese":"קוטג","white_cheese":"גבינה לבנה","labneh":"לאבנה","feta_cheese":"גבינה מלוחה","butter":"חמאה","olive_oil":"שמן זית","meatballs":"קציצות","sausage":"נקניקיות","beef":"בשר בקר","fish":"דג","chicken":"עוף","tuna":"טונה","potato":"תפוח אדמה","mashed_potato":"פירה","beans":"שעועית","lentils":"עדשים","chickpeas":"חומוס גרגרים","quinoa":"קינואה","pasta":"פסטה","ptitim":"פתיתים","mujadara":"מגדרה","bourkas":"בורקס","jachnun":"גחנון","malawach":"מלאווח","cholent":"חמין","shawarma":"שווארמה","kebab":"קבב","casserole":"פשטידה","stuffed_pepper":"פלפל ממולא","grape_leaves":"עלי גפן","tomato":"עגבניה","cucumber":"מלפפון","carrot":"גזר","pepper":"פלפל","broccoli":"ברוקולי","cauliflower":"כרובית","eggplant":"חציל","zucchini":"קישוא","corn":"תירס","mushroom":"פטריות","peas":"אפונה","olives":"זיתים","orange":"תפוז","pear":"אגס","grapes":"ענבים","watermelon":"אבטיח","melon":"מלון","strawberry":"תות","pineapple":"אננס","mango":"מנגו","peach":"אפרסק","plum":"שזיף","kiwi":"קיווי","pomegranate":"רימון","clementine":"קלמנטינה","fig":"תאנה","raisins":"צימוקים","cookies":"עוגיות","cake":"עוגה","halva":"חלבה","sufganiyah":"סופגניה","pretzel":"בייגלה","crackers":"קרקר","rice_cakes":"פריכיות","popcorn":"פופקורן","potato_chips":"תפוציפס","peanut_butter":"חמאת בוטנים","honey":"דבש","jam":"ריבה","mayonnaise":"מיונז","ketchup":"קטשופ","iced_coffee":"אייס קפה"}
let ready
async function readJSON(name) {
  const response = await fetch(new URL(name, base))
  if (!response.ok) throw new Error('Image recognition data could not be loaded')
  return response.json()
}
async function loadModel() {
  const manifest = await readJSON('clip-manifest.json?v=2')
  const bytes = new Uint8Array(manifest.byteLength)
  let offset = 0
  for (const name of manifest.parts) {
    const response = await fetch(new URL(name, base))
    if (!response.ok || !response.body) throw new Error('Image recognition model could not be loaded')
    const reader = response.body.getReader()
    try {
      for (;;) {
        const {done, value} = await reader.read()
        if (done) break
        bytes.set(value, offset)
        offset += value.length
      }
    } finally {
      await reader.cancel()
    }
  }
  if (offset !== bytes.length) throw new Error('Incomplete image recognition model')
  return ort.InferenceSession.create(bytes, {executionProviders:['wasm']})
}
function load() {
  ready ??= Promise.all([loadModel(), readJSON('food-embeddings.json')])
    .catch((error) => { ready = undefined; throw error })
  return ready
}
export async function predict(image) {
  const [session, labels] = await load()
  const centered = await recognizeCrop(session, labels, image, false)
  return centered.length ? centered : recognizeCrop(session, labels, image, true)
}
export async function predictPlate(image, stillCurrent = () => true) {
  const [session, labels] = await load()
  const width = image.naturalWidth, height = image.naturalHeight
  const size = Math.min(width, height) * .55
  const areas = [[.28,.42],[.72,.42],[.28,.72],[.72,.72]]
  const regions = []
  for (const [x,y] of areas) {
    if (!stillCurrent()) break
    const crop = [
      Math.min(width - size, Math.max(0, x * width - size / 2)),
      Math.min(height - size, Math.max(0, y * height - size / 2)),
      size,
    ]
    const matches = await recognizeCrop(session, labels, image, false, crop)
    if (matches.length === 1) regions.push(matches[0].label)
  }
  return [...new Set(regions)]
}
async function recognizeCrop(session, labels, image, fullImage, region) {
  const size = 224
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d', {willReadFrequently:true})
  context.imageSmoothingQuality = 'high'
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (region) {
    const [x, y, crop] = region
    context.drawImage(image, x, y, crop, crop, 0, 0, size, size)
  } else if (fullImage) {
    const scale = size / Math.max(width, height)
    context.fillStyle = 'rgb(123,117,104)'
    context.fillRect(0, 0, size, size)
    context.drawImage(image, (size - width * scale) / 2,
      (size - height * scale) / 2, width * scale, height * scale)
  } else {
    const crop = Math.min(width, height)
    context.drawImage(image, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, size, size)
  }
  const {data} = context.getImageData(0, 0, size, size)
  const plane = size * size
  const input = new Float32Array(plane * 3)
  const means = [.48145466, .4578275, .40821073]
  const deviations = [.26862954, .26130258, .27577711]
  for (let channel = 0; channel < 3; channel++) {
    for (let pixel = 0; pixel < plane; pixel++) {
      input[channel * plane + pixel] = (data[pixel * 4 + channel] / 255 - means[channel]) / deviations[channel]
    }
  }
  const outputs = await session.run({pixel_values:new ort.Tensor('float32', input, [1, 3, size, size])})
  const embedding = outputs.image_embeds.data
  const length = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0))
  const scores = labels.embeddings.map((vector, index) => {
    const similarity = vector.reduce((sum, value, component) => sum + value * embedding[component], 0) / length
    return {label:labels.groups[index].id, score:similarity}
  }).sort((a, b) => b.score - a.score)
  const best = scores[0]
  if (best.label === 'non_food' || best.score < labels.minimumSimilarity) return []
  if (best.score - scores[1].score >= labels.minimumMargin) return [best]
  return scores.filter(({label, score}) =>
    label !== 'non_food' && score >= labels.minimumSimilarity && best.score - score < labels.minimumMargin
  ).slice(0, 3)
}
