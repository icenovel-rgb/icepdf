/**
 * 읽기 기록 — 읽던 곳·EPUB 밑줄·읽기 테마. 메인이 userData/library.json에 저장하고
 * 렌더러는 IPC로 읽고 쓴다. IPC 경계를 넘는 값은 여기 sanitize 함수로만 받아들인다.
 */
import type { TextAnchor } from './anchor'
import type { DocKind } from './doc-kind'
import { mapPageAfterRelayout } from './doc-kind'
import type { Rect } from './types'

// ── EPUB 읽기 테마 ──

export type EpubTheme = 'light' | 'sepia' | 'dark'

interface ThemeDef {
  label: string
  /** mupdf setUserCSS — 색만 바꾼다(여백·글자 크기를 건드리면 쪽 수가 바뀐다) */
  css: string
  /** 쪽 종이색 (툴바 견본·카드 기본값) */
  paper: string
}

const themeCss = (paper: string, ink: string, link: string): string =>
  `*{color:${ink} !important;background-color:transparent !important;border-color:${ink} !important}` +
  `html,body{background-color:${paper} !important}a,a *{color:${link} !important}`

export const EPUB_THEMES: Record<EpubTheme, ThemeDef> = {
  light: { label: '화이트', css: '', paper: '#ffffff' },
  sepia: { label: '세피아', css: themeCss('#f4ecd8', '#5b4636', '#8a5a2b'), paper: '#f4ecd8' },
  dark: { label: '다크', css: themeCss('#1e1e1e', '#d6d6d6', '#8ab4f8'), paper: '#1e1e1e' }
}

export function isEpubTheme(v: unknown): v is EpubTheme {
  return v === 'light' || v === 'sepia' || v === 'dark'
}

// ── EPUB 읽기 글꼴 ──

/** 글꼴 파일 안의 한 면 (TTC는 index로 구분) */
export interface ReadingFontFile {
  path: string
  index: number
}

/** 툴바 글꼴 목록 한 줄 — id는 글꼴 가족 이름, label은 한국어 이름이 있으면 그것 */
export interface ReadingFontOption {
  id: string
  label: string
  recommended: boolean
}

/** CSS에 쓰는 가상 가족 이름 — mupdf가 이 이름으로 글꼴을 요청하면 고른 글꼴을 돌려준다 */
export const READING_FONT_FAMILY = 'ICEPDFReading'

/**
 * 고른 글꼴로 본문을 덮는 CSS. 고정폭(코드)은 그대로 두고, 글꼴이 없는 글자는
 * mupdf 기본 대체 글꼴(serif)로 넘어간다. 글꼴은 쪽 나눔을 바꾸므로 문서를 열 때부터 걸려 있어야 한다.
 */
export function readingFontCss(): string {
  return (
    `html,body,body *{font-family:"${READING_FONT_FAMILY}",serif !important}` +
    'pre,code,kbd,samp,tt,pre *,code *{font-family:monospace !important}'
  )
}

/** IPC로 받은 글꼴 id — 가족 이름(빈 문자열 = 책 기본 글꼴) */
export function isReadingFontId(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 200 && !/[\u0000-\u001f]/.test(v)
}

// ── 밑줄 ──

export type NoteStyle = 'highlight' | 'underline'

/** 형광펜·밑줄 색 (툴바·선택 팝업 공용) */
export const NOTE_COLORS = ['#ffe04d', '#7ee081', '#ff8fb1', '#7ec8ff', '#c9a0ff']

/** EPUB 밑줄 — 파일은 그대로 두고 library.json에 저장 */
export interface EpubNote {
  id: string
  color: string
  style: NoteStyle
  /** 표시용 원문 (공백 포함) */
  text: string
  anchor: TextAnchor
  createdAt: number
}

/** 모아보기 목록 한 줄 — EPUB(library)·PDF(주석) 공용 */
export interface NoteItem {
  id: string
  source: 'epub' | 'pdf'
  /** 0-base 쪽. EPUB 앵커를 못 찾았으면 -1 */
  page: number
  /** 쪽 안 위치(pt) — 이동 시 그 줄이 보이게 */
  y: number
  text: string
  color: string
  style: NoteStyle
  createdAt: number
}

/** EPUB 쪽 위에 그리는 밑줄 표시 */
export interface NoteMark {
  id: string
  color: string
  style: NoteStyle
  rects: Rect[]
}

/** 모아보기 순서 — 쪽 → 쪽 안 위치. 위치를 못 찾은 밑줄은 맨 뒤 */
export function sortNotes(notes: NoteItem[]): NoteItem[] {
  const rank = (n: NoteItem): number => (n.page < 0 ? Number.MAX_SAFE_INTEGER : n.page)
  return [...notes].sort((a, b) => rank(a) - rank(b) || a.y - b.y || a.createdAt - b.createdAt)
}

/** 밑줄 모음 → Markdown (인용문 + 쪽) */
export function notesToMarkdown(title: string, notes: NoteItem[]): string {
  const body = notes
    .map((n) => {
      const quote = n.text
        .trim()
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join('\n')
      const where = n.page < 0 ? '위치를 찾지 못함' : `${n.page + 1}쪽`
      return `${quote}\n\n— ${where}\n`
    })
    .join('\n')
  return `# ${title} — 밑줄\n\n${body}`
}

// ── 서재 파일 ──

export interface BookRecord {
  title: string
  path: string | null
  kind: DocKind
  lastPage: number
  pageCount: number
  /** EPUB 글자 크기 — 다시 열 때 복원 */
  fontSize: number | null
  updatedAt: number
  notes: EpubNote[]
}

export interface LibrarySettings {
  epubTheme: EpubTheme
  /** EPUB 본문 글꼴 가족 이름 ('' = 책 기본 글꼴) */
  epubFont: string
}

export interface LibraryFile {
  version: 1
  settings: LibrarySettings
  books: Record<string, BookRecord>
}

/** PDF는 경로로 식별 (편집·저장으로 내용이 바뀌므로). 윈도우 경로 대소문자·구분자 무시 */
export function pdfDocKey(path: string): string {
  return 'pdf:' + path.replace(/\\/g, '/').toLowerCase()
}

/** 저장된 쪽을 지금 쪽 수에 맞춰 옮긴다 (EPUB 재배치로 쪽 수가 달라졌으면 비율로) */
export function resumeTarget(rec: Pick<BookRecord, 'lastPage' | 'pageCount'>, pageCount: number): number {
  if (pageCount <= 0 || !Number.isFinite(rec.lastPage) || rec.lastPage <= 0) return 0
  const page = rec.pageCount === pageCount ? rec.lastPage : mapPageAfterRelayout(rec.lastPage, rec.pageCount, pageCount)
  return Math.max(0, Math.min(pageCount - 1, Math.floor(page)))
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown, max = 1e6): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max
const isStr = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max
const HEX = /^#[0-9a-f]{6}$/i

function sanitizeAnchor(v: unknown): TextAnchor | null {
  if (!isObj(v)) return null
  const { exact, prefix, suffix, ratio } = v
  if (!isStr(exact, 20000) || !exact || !isStr(prefix, 256) || !isStr(suffix, 256)) return null
  if (typeof ratio !== 'number' || !(ratio >= 0 && ratio <= 1)) return null
  return { exact, prefix, suffix, ratio }
}

export function sanitizeNote(v: unknown): EpubNote | null {
  if (!isObj(v)) return null
  const anchor = sanitizeAnchor(v.anchor)
  if (!anchor || !isStr(v.id, 64) || !v.id || !isStr(v.color, 7) || !HEX.test(v.color)) return null
  if (v.style !== 'highlight' && v.style !== 'underline') return null
  if (!isStr(v.text, 20000) || typeof v.createdAt !== 'number') return null
  return { id: v.id, color: v.color, style: v.style, text: v.text, anchor, createdAt: v.createdAt }
}

/** 렌더러가 보낸 책 패치 — 알려진 필드·올바른 값만 통과 */
export function sanitizeBookPatch(input: unknown): Partial<BookRecord> {
  if (!isObj(input)) return {}
  const out: Partial<BookRecord> = {}
  if (isStr(input.title, 1024)) out.title = input.title
  if (input.path === null || isStr(input.path, 4096)) out.path = input.path as string | null
  if (input.kind === 'pdf' || input.kind === 'epub') out.kind = input.kind
  if (isCount(input.lastPage)) out.lastPage = input.lastPage
  if (isCount(input.pageCount) && input.pageCount > 0) out.pageCount = input.pageCount
  if (input.fontSize === null || isCount(input.fontSize, 200)) out.fontSize = input.fontSize as number | null
  if (Array.isArray(input.notes)) {
    out.notes = input.notes.slice(0, 10000).map(sanitizeNote).filter((n): n is EpubNote => n !== null)
  }
  return out
}

export function sanitizeSettings(input: unknown): Partial<LibrarySettings> {
  if (!isObj(input)) return {}
  const out: Partial<LibrarySettings> = {}
  if (isEpubTheme(input.epubTheme)) out.epubTheme = input.epubTheme
  if (isReadingFontId(input.epubFont)) out.epubFont = input.epubFont
  return out
}

/** 기존 기록에 패치를 덮는다 (패치하지 않은 필드는 유지) */
export function mergeBook(prev: BookRecord | undefined, patch: Partial<BookRecord>, now: number): BookRecord {
  const base: BookRecord = prev ?? {
    title: '',
    path: null,
    kind: 'pdf',
    lastPage: 0,
    pageCount: 1,
    fontSize: null,
    updatedAt: now,
    notes: []
  }
  return { ...base, ...patch, updatedAt: now }
}

/**
 * 밑줄 하나를 저장된 기록에 더한다 — 렌더러가 가진 목록(오래됐거나 다른 탭 것일 수 있음)이 아니라
 * 저장소 기준으로 합쳐서, 같은 책을 두 탭에서 열어도 서로의 밑줄을 지우지 않는다. 같은 id는 한 번만.
 */
export function addNoteTo(prev: BookRecord | undefined, note: EpubNote, now: number): BookRecord {
  const notes = prev?.notes ?? []
  return mergeBook(prev, { notes: notes.some((n) => n.id === note.id) ? notes : [...notes, note] }, now)
}

export function removeNoteFrom(prev: BookRecord | undefined, id: string, now: number): BookRecord {
  return mergeBook(prev, { notes: (prev?.notes ?? []).filter((n) => n.id !== id) }, now)
}

/** 디스크에서 읽은 JSON — 손상돼도 앱이 뜨게 관용적으로 */
export function parseLibrary(json: unknown): LibraryFile {
  const lib: LibraryFile = { version: 1, settings: { epubTheme: 'light', epubFont: '' }, books: {} }
  if (!isObj(json)) return lib
  lib.settings = { ...lib.settings, ...sanitizeSettings(json.settings) }
  if (isObj(json.books)) {
    for (const [key, raw] of Object.entries(json.books)) {
      if (!isObj(raw) || key.length > 4200) continue
      lib.books[key] = mergeBook(undefined, sanitizeBookPatch(raw), typeof raw.updatedAt === 'number' ? raw.updatedAt : 0)
    }
  }
  return lib
}

/** mupdf 색 [r,g,b](0~1) → #rrggbb */
export function colorToHex(rgb: number[]): string {
  const h = (v: number): string => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0')
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
