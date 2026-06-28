// Minimal, dependency-free store-only (no compression) ZIP encoder, used to
// export a brain's notes as a .zip of .md files. The "store" method keeps the
// implementation small and provably correct; note text compresses little and
// these archives are modest, so skipping DEFLATE is a fair trade.

interface ZipFile {
  name: string
  content: string
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function makeZip(files: ZipFile[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const DOS_TIME = 0
  const DOS_DATE = 0x21 // 1980-01-01 (fixed; scripts can't read the clock here)

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const data = Buffer.from(file.content, 'utf8')
    const crc = crc32(data)
    const size = data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: UTF-8 filenames
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    chunks.push(local, nameBuf, data)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4) // version made by
    cen.writeUInt16LE(20, 6) // version needed
    cen.writeUInt16LE(0x0800, 8) // flags
    cen.writeUInt16LE(0, 10) // method
    cen.writeUInt16LE(DOS_TIME, 12)
    cen.writeUInt16LE(DOS_DATE, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(size, 20)
    cen.writeUInt32LE(size, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30) // extra length
    cen.writeUInt16LE(0, 32) // comment length
    cen.writeUInt16LE(0, 34) // disk number start
    cen.writeUInt16LE(0, 36) // internal attrs
    cen.writeUInt32LE(0, 38) // external attrs
    cen.writeUInt32LE(offset, 42) // local header offset
    central.push(cen, nameBuf)

    offset += local.length + nameBuf.length + data.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // disk with central dir
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16) // central dir offset
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...chunks, centralBuf, eocd])
}
