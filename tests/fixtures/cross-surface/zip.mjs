/**
 * A store-only ZIP writer, in about a hundred lines, with no dependency.
 *
 * WHY NOT A LIBRARY. This writes ONE artefact: the harness's fixture EPUB. A
 * test fixture that arrives through a dependency is a fixture whose bytes can
 * change without anyone editing this repo, and the fixture is the control in
 * every reader experiment we are about to run. If the control can drift, a
 * failed run has two possible causes and we will chase the wrong one — which
 * is precisely the week we just spent.
 *
 * WHY STORE-ONLY. EPUB requires the `mimetype` entry to be first and STORED,
 * so a compliant writer needs the stored path anyway. Using it for every entry
 * costs a few KB on a fixture that is deliberately small, and buys two things:
 * the output is byte-inspectable with `unzip -l` / a hex dump, and there is no
 * compressor whose version could change the bytes.
 *
 * DETERMINISM IS THE POINT. Fixed DOS timestamp, fixed entry order, no
 * `Date.now()`. Same inputs must always produce the same bytes, because
 * `fixture.sha256` is checked in and a change to the fixture has to be visible
 * in review rather than discovered as a mystery test failure.
 */

// 1980-01-01 00:00:00, the DOS epoch. Any fixed value works; this one is
// recognisable in a hex dump as "deliberately not a real time".
const DOS_TIME = 0
const DOS_DATE = 0x0021

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/**
 * @param {{name: string, data: Uint8Array}[]} entries  written in this order
 * @returns {Buffer}
 */
export function makeZip(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(10, 4) // version needed: 1.0, stored
    local.writeUInt16LE(0, 6) // flags: none. NOT bit 3 — sizes are known.
    local.writeUInt16LE(0, 8) // method: 0 = stored
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18) // compressed size == uncompressed
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // no extra field. EPUB's mimetype entry is
    // required to have none, and uniformity keeps
    // the offsets trivially auditable.
    nameBytes.copy(local, 30)

    chunks.push(local, Buffer.from(data))

    const cd = Buffer.alloc(46 + nameBytes.length)
    cd.writeUInt32LE(0x02014b50, 0) // central directory header signature
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(10, 6) // version needed
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(0, 10) // stored
    cd.writeUInt16LE(DOS_TIME, 12)
    cd.writeUInt16LE(DOS_DATE, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBytes.length, 28)
    cd.writeUInt16LE(0, 30) // extra len
    cd.writeUInt16LE(0, 32) // comment len
    cd.writeUInt16LE(0, 34) // disk number start
    cd.writeUInt16LE(0, 36) // internal attributes
    cd.writeUInt32LE(0, 38) // external attributes
    cd.writeUInt32LE(offset, 42) // offset of local header
    nameBytes.copy(cd, 46)
    central.push(cd)

    offset += local.length + data.length
  }

  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // this disk
  eocd.writeUInt16LE(0, 6) // disk with central directory
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...chunks, cdBuf, eocd])
}
