/**
 * 설치된 한글 글꼴 찾기 — EPUB 읽기 글꼴용.
 * mupdf(wasm)는 시스템 글꼴을 모르므로 글꼴 파일의 이름표(name)·OS/2 테이블을 직접 읽어
 * "가족 이름 → 파일(·TTC 안 번호)" 목록을 만든다. 파일 전체가 아니라 머리말과 표 두 개만 읽는다.
 */
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import type { ReadingFontFile, ReadingFontOption } from '../shared/reading'

/** 글꼴 파일의 한 면(face) — TTC는 파일 하나에 여러 면 */
export interface FontFace extends ReadingFontFile {
  family: string
  /** 한국어 가족 이름 (없으면 null) */
  familyKo: string | null
  /** 영문 스타일 이름 소문자 ('regular', 'bold', 'extrabold' …) */
  style: string
  weight: number
  italic: boolean
  /** 한글 음절을 담았는지 (OS/2 유니코드 범위·코드 페이지) */
  korean: boolean
  /** 가변 글꼴 — mupdf는 축을 못 바꿔 기본 인스턴스(usWeightClass) 굵기로만 그린다 */
  variable: boolean
}

export interface FontFamily {
  id: string
  label: string
  recommended: boolean
  regular: ReadingFontFile
  bold: ReadingFontFile | null
}

/** 파일의 일부를 읽는 함수 — 테스트에선 Buffer로 바꿔 끼운다 */
export type ReadAt = (offset: number, length: number) => Promise<Buffer>

const FONT_EXT = new Set(['.ttf', '.otf', '.ttc', '.otc'])
const LANG_EN = 0x0409
const LANG_KO = 0x0412
/** 한 디렉터리에서 내려갈 깊이 (리눅스 /usr/share/fonts/truetype/<가족>/…) */
const MAX_DEPTH = 3
const SCAN_CONCURRENCY = 24

interface Table {
  offset: number
  length: number
}

async function tablesAt(read: ReadAt, base: number): Promise<Map<string, Table>> {
  const head = await read(base, 12)
  if (head.length < 12) return new Map()
  const count = head.readUInt16BE(4)
  const dir = await read(base + 12, count * 16)
  const tables = new Map<string, Table>()
  for (let i = 0; i + 16 <= dir.length; i += 16) {
    tables.set(dir.toString('latin1', i, i + 4), { offset: dir.readUInt32BE(i + 8), length: dir.readUInt32BE(i + 12) })
  }
  return tables
}

interface NameRecord {
  platform: number
  lang: number
  nameId: number
  value: string
}

function decodeName(buf: Buffer, platform: number, encoding: number): string | null {
  // 윈도우(3)·유니코드(0) = UTF-16BE, 맥(1) 로마자 = latin1. 그 밖(맥 한국어 EUC-KR 등)은 건너뛴다
  if (platform === 3 || platform === 0) {
    const le = Buffer.from(buf)
    for (let i = 0; i + 1 < le.length; i += 2) {
      const t = le[i]
      le[i] = le[i + 1]
      le[i + 1] = t
    }
    return le.toString('utf16le')
  }
  if (platform === 1 && encoding === 0) return buf.toString('latin1')
  return null
}

async function readNames(read: ReadAt, t: Table): Promise<NameRecord[]> {
  const buf = await read(t.offset, t.length)
  if (buf.length < 6) return []
  const count = buf.readUInt16BE(2)
  const strings = buf.readUInt16BE(4)
  const out: NameRecord[] = []
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12
    if (r + 12 > buf.length) break
    const nameId = buf.readUInt16BE(r + 6)
    if (nameId !== 1 && nameId !== 2 && nameId !== 16 && nameId !== 17) continue
    const platform = buf.readUInt16BE(r)
    const start = strings + buf.readUInt16BE(r + 10)
    const end = start + buf.readUInt16BE(r + 8)
    if (end > buf.length) continue
    const value = decodeName(buf.subarray(start, end), platform, buf.readUInt16BE(r + 2))
    if (value?.trim()) out.push({ platform, lang: buf.readUInt16BE(r + 4), nameId, value: value.trim() })
  }
  return out
}

/** 타이포그래피 이름(16·17)이 있으면 그것, 없으면 기본 이름(1·2) — 같은 언어 안에서 */
function pickName(names: NameRecord[], match: (n: NameRecord) => boolean, ids: [number, number] = [16, 1]): string | null {
  const hits = names.filter(match)
  return (hits.find((n) => n.nameId === ids[0]) ?? hits.find((n) => n.nameId === ids[1]))?.value ?? null
}

interface Os2 {
  weight: number
  italic: boolean
  korean: boolean
}

async function readOs2(read: ReadAt, t: Table | undefined): Promise<Os2> {
  if (!t) return { weight: 400, italic: false, korean: false }
  const buf = await read(t.offset, Math.min(t.length, 86))
  if (buf.length < 64) return { weight: 400, italic: false, korean: false }
  const version = buf.readUInt16BE(0)
  const weight = buf.readUInt16BE(4) || 400
  const italic = (buf.readUInt16BE(62) & 1) !== 0
  // ulUnicodeRange2 비트 24 = 한글 음절(U+AC00–D7AF)
  const hangul = (buf.readUInt32BE(46) & (1 << 24)) !== 0
  // ulCodePageRange1 비트 19 = 한국어 완성형(949), 21 = 조합형
  const codePage = version >= 1 && buf.length >= 82 ? buf.readUInt32BE(78) : 0
  const korean = hangul || (codePage & ((1 << 19) | (1 << 21))) !== 0
  return { weight, italic, korean }
}

/** 글꼴 파일 하나의 면 목록 (TTF/OTF = 1개, TTC = 여러 개). 글꼴이 아니면 빈 배열 */
export async function parseFontFaces(read: ReadAt, path: string): Promise<FontFace[]> {
  const head = await read(0, 12)
  if (head.length < 12) return []
  const tag = head.toString('latin1', 0, 4)
  let bases = [0]
  if (tag === 'ttcf') {
    const n = Math.min(head.readUInt32BE(8), 64)
    const offs = await read(12, n * 4)
    bases = Array.from({ length: Math.floor(offs.length / 4) }, (_, i) => offs.readUInt32BE(i * 4))
  } else if (head.readUInt32BE(0) !== 0x00010000 && tag !== 'OTTO' && tag !== 'true') {
    return []
  }
  const faces: FontFace[] = []
  for (const [index, base] of bases.entries()) {
    const tables = await tablesAt(read, base)
    const name = tables.get('name')
    if (!name) continue
    const names = await readNames(read, name)
    const family =
      pickName(names, (n) => n.platform === 3 && n.lang === LANG_EN) ??
      pickName(names, (n) => n.platform === 1 && n.lang === 0) ??
      pickName(names, (n) => n.platform === 3 || n.platform === 0)
    if (!family) continue
    const familyKo = pickName(names, (n) => n.platform === 3 && n.lang === LANG_KO)
    const style =
      pickName(names, (n) => (n.platform === 3 && n.lang === LANG_EN) || (n.platform === 1 && n.lang === 0), [17, 2]) ?? ''
    faces.push({
      path,
      index,
      family,
      familyKo,
      style: style.toLowerCase().replace(/\s+/g, ''),
      variable: tables.has('fvar'),
      ...(await readOs2(read, tables.get('OS/2')))
    })
  }
  return faces
}

async function facesOfFile(path: string): Promise<FontFace[]> {
  let fh: Awaited<ReturnType<typeof open>> | null = null
  try {
    fh = await open(path, 'r')
    const handle = fh
    const read: ReadAt = async (offset, length) => {
      const buf = Buffer.alloc(Math.max(0, Math.min(length, 4 * 1024 * 1024)))
      const { bytesRead } = await handle.read(buf, 0, buf.length, offset)
      return buf.subarray(0, bytesRead)
    }
    return await parseFontFaces(read, path)
  } catch {
    return [] // 잠긴·깨진 파일은 조용히 건너뛴다
  } finally {
    await fh?.close().catch(() => undefined)
  }
}

async function listFontFiles(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    // 심볼릭 링크(리눅스 배포판의 글꼴 링크 등)는 따라가 본다 — 순환은 MAX_DEPTH가 막는다
    const target = e.isSymbolicLink() ? await stat(p).catch(() => null) : e
    if (!target) continue
    if (target.isDirectory() && depth < MAX_DEPTH) await listFontFiles(p, depth + 1, out)
    else if (target.isFile() && FONT_EXT.has(extname(e.name).toLowerCase())) out.push(p)
  }
  return out
}

/** 운영체제별 글꼴 폴더 (시스템 + 사용자 설치) */
export function fontDirs(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  const home = homedir()
  if (platform === 'win32') {
    return [
      join(env.WINDIR ?? 'C:\\Windows', 'Fonts'),
      join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts')
    ]
  }
  if (platform === 'darwin') {
    return ['/System/Library/Fonts', '/Library/Fonts', join(home, 'Library', 'Fonts')]
  }
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(home, '.fonts'), join(home, '.local', 'share', 'fonts')]
}

/** 추천 글꼴 — 이 순서로 위에 보여준다 (공백·하이픈·밑줄·대소문자 무시, 같은 줄은 별칭) */
const RECOMMENDED: string[][] = [
  ['batang'],
  ['malgungothic'],
  ['nanummyeongjo'],
  ['nanumgothic'],
  ['maruburi', 'maruburiotf'],
  ['ridibatang'],
  ['kopubworldbatang', 'kopubbatang', 'kopubbatangpro', 'kopubworldbatangpro'],
  ['hcrbatang'],
  ['notoserifkr', 'notoserifcjkkr'],
  ['nanumbarungothic'],
  ['notosanskr', 'notosanscjkkr'],
  ['kopubworlddotum', 'kopubdotum', 'kopubdotumpro', 'kopubworlddotumpro'],
  ['gungsuh'],
  ['nanumpenscript'],
  ['applemyungjo'],
  ['applesdgothicneo']
]
const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]/g, '')
const recommendRank = (family: string): number => {
  const key = norm(family)
  const i = RECOMMENDED.findIndex((aliases) => aliases.includes(key))
  return i < 0 ? RECOMMENDED.length : i
}

const REGULAR_STYLES = new Set(['regular', 'normal', 'book', 'roman', 'standard'])

/** 가변 글꼴의 기본 굵기가 본문용 범위일 때만 쓴다 (Noto KR VF처럼 Thin이 기본이면 가늘게만 나온다) */
const usableFace = (f: FontFace): boolean => !f.italic && (!f.variable || (f.weight >= 350 && f.weight <= 600))

/** 굵기가 target에 가장 가까운 면 — 같으면 tieHeavier에 따라 무거운/가벼운 쪽 */
function closest(faces: FontFace[], target: number, tieHeavier: boolean): FontFace | null {
  if (!faces.length) return null
  return faces.reduce((a, b) => {
    const da = Math.abs(a.weight - target)
    const db = Math.abs(b.weight - target)
    if (db !== da) return db < da ? b : a
    return (tieHeavier ? b.weight > a.weight : b.weight < a.weight) ? b : a
  })
}

/** 보통 면: 스타일 이름이 Regular인 면, 없으면 400에 가장 가까운 면(같으면 무거운 쪽 — Light보다 Medium) */
function pickRegular(faces: FontFace[]): FontFace | null {
  const usable = faces.filter(usableFace)
  return closest(usable.filter((f) => REGULAR_STYLES.has(f.style)), 400, true) ?? closest(usable, 400, true)
}

/** 굵게 면: 스타일 이름이 Bold인 면(나눔은 Bold=600, ExtraBold=700), 없으면 600 이상 중 700에 가까운 면 */
function pickBold(faces: FontFace[]): FontFace | null {
  const usable = faces.filter(usableFace)
  return (
    closest(usable.filter((f) => f.style === 'bold'), 700, false) ??
    closest(usable.filter((f) => f.weight >= 600), 700, false)
  )
}

/** 면들을 가족으로 묶고 보통·굵게 면을 고른다 (한글 없는 글꼴·세로쓰기(@) 이름은 뺀다) */
export function groupFamilies(faces: FontFace[]): FontFamily[] {
  const groups = new Map<string, FontFace[]>()
  for (const f of faces) {
    if (!f.korean || f.family.startsWith('@')) continue
    const list = groups.get(f.family)
    if (list) list.push(f)
    else groups.set(f.family, [f])
  }
  const out: FontFamily[] = []
  for (const [family, list] of groups) {
    const regular = pickRegular(list)
    if (!regular) continue
    const bold = pickBold(list)
    const label = regular.familyKo ?? list.find((f) => f.familyKo)?.familyKo ?? family
    out.push({
      id: family,
      label,
      recommended: recommendRank(family) < RECOMMENDED.length,
      regular: { path: regular.path, index: regular.index },
      bold: bold && bold !== regular ? { path: bold.path, index: bold.index } : null
    })
  }
  return out.sort((a, b) => recommendRank(a.id) - recommendRank(b.id) || a.label.localeCompare(b.label, 'ko'))
}

async function scanAll(): Promise<FontFamily[]> {
  const files: string[] = []
  for (const dir of fontDirs()) await listFontFiles(dir, 0, files)
  const faces: FontFace[] = []
  for (let i = 0; i < files.length; i += SCAN_CONCURRENCY) {
    const chunk = await Promise.all(files.slice(i, i + SCAN_CONCURRENCY).map(facesOfFile))
    for (const list of chunk) faces.push(...list)
  }
  return groupFamilies(faces)
}

let scanned: Promise<FontFamily[]> | null = null

/** 설치된 한글 글꼴 가족 (앱 실행 동안 한 번만 훑는다) */
export function readingFontFamilies(): Promise<FontFamily[]> {
  if (!scanned) {
    scanned = scanAll().catch((err) => {
      scanned = null // 다음에 다시 시도
      throw err
    })
  }
  return scanned
}

export async function findReadingFont(id: string): Promise<FontFamily | null> {
  return (await readingFontFamilies()).find((f) => f.id === id) ?? null
}

export async function readingFontOptions(): Promise<ReadingFontOption[]> {
  return (await readingFontFamilies()).map((f) => ({ id: f.id, label: f.label, recommended: f.recommended }))
}
