const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

export function isProductCode(value) {
  return /^(?:\d{8}|\d{12,14})$/.test(value)
}

export async function readProductCode(image) {
  if (typeof globalThis.BarcodeDetector === 'function') {
    try {
      const supported = await BarcodeDetector.getSupportedFormats()
      const available = formats.filter(format => supported.includes(format))
      if (available.length) {
        const results = await new BarcodeDetector({formats:available}).detect(image)
        const code = results.find(result => isProductCode(result.rawValue))
        if (code) return code.rawValue
      }
    } catch { /* Use the bundled reader if the browser cannot scan this image. */ }
  }
  const {decodeProductCode} = await import('./zxing-retail.js')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', {willReadFrequently:true})
  if (!context) return null
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  for (const rotate of [false, true]) {
    canvas.width = rotate ? height : width
    canvas.height = rotate ? width : height
    if (rotate) context.setTransform(0, 1, -1, 0, height, 0)
    context.drawImage(image, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const gray = new Uint8ClampedArray(pixels.length / 4)
    for (let i = 0; i < gray.length; i++) {
      const offset = i * 4
      gray[i] = (pixels[offset] + 2 * pixels[offset + 1] + pixels[offset + 2]) / 4
    }
    const code = decodeProductCode(gray, canvas.width, canvas.height)
    if (isProductCode(code)) return code
  }
  return null
}
