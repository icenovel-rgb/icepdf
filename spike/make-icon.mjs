/** favicon.png(루트, 512px 8각별) → build/icon.ico (멀티 해상도) */
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = path.join(root, 'favicon.png')
const out = path.join(root, 'build', 'icon.ico')
fs.mkdirSync(path.dirname(out), { recursive: true })

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(
  sizes.map((s) =>
    sharp(src).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  )
)

const count = sizes.length
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(count, 4)

const entries = Buffer.alloc(16 * count)
let offset = 6 + 16 * count
sizes.forEach((s, i) => {
  const png = pngs[i]
  const e = entries.subarray(i * 16, (i + 1) * 16)
  e[0] = s >= 256 ? 0 : s
  e[1] = s >= 256 ? 0 : s
  e.writeUInt16LE(1, 4) // color planes
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32LE(png.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += png.length
})

fs.writeFileSync(out, Buffer.concat([header, entries, ...pngs]))
console.log(`아이콘 생성: ${out} (${sizes.join('/')}px, ${fs.statSync(out).size} bytes)`)
