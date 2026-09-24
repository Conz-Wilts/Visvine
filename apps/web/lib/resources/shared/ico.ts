// The largest PNG an .ico file carries. Pure. Most favicons are .ico, which
// sharp cannot read — but a modern .ico is a directory of PNGs, and the PNG
// inside is an ordinary image. An .ico of old BMP entries yields null.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function largestPngInIco(bytes: Buffer): Buffer | null {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null
  const count = bytes.readUInt16LE(4)
  let best: { size: number; data: Buffer } | null = null
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    if (entry + 16 > bytes.length) break
    const width = bytes[entry] || 256
    const length = bytes.readUInt32LE(entry + 8)
    const offset = bytes.readUInt32LE(entry + 12)
    if (offset + length > bytes.length || length < PNG_SIGNATURE.length) continue
    const data = bytes.subarray(offset, offset + length)
    if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) continue
    if (!best || width > best.size) best = { size: width, data }
  }
  return best?.data ?? null
}
