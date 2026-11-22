/**
 * 읽기 기록 저장소 — userData/library.json (읽던 곳·EPUB 밑줄·읽기 테마).
 * 렌더러는 IPC로만 접근하고, 들어오는 값은 shared/reading의 sanitize로 검증한다.
 * 쓰기는 모아서(debounce) 원자적으로 — 쪽을 넘길 때마다 디스크를 두드리지 않게.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addNoteTo,
  mergeBook,
  parseLibrary,
  removeNoteFrom,
  sanitizeBookPatch,
  sanitizeNote,
  sanitizeSettings,
  type BookRecord,
  type EpubNote,
  type LibraryFile,
  type LibrarySettings
} from '../shared/reading'

const WRITE_DELAY = 400
const MAX_KEY = 4200
/** 이미지·텍스트 저장 상한 (문장 카드 PNG·밑줄 Markdown) */
const MAX_SAVE_BYTES = 64 * 1024 * 1024

let lib: LibraryFile | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null
/**
 * 기존 파일을 못 읽었는데(잠김·권한) 빈 기록으로 덮어쓰면 EPUB 밑줄(유일한 사본)이 사라진다.
 * 그럴 땐 이번 실행 동안 쓰기를 막는다 — 읽던 곳 몇 개를 잃는 편이 밑줄 전부를 잃는 것보다 낫다.
 */
let writeBlocked = false

const filePath = (): string => join(app.getPath('userData'), 'library.json')

function load(): LibraryFile {
  if (lib) return lib
  const path = filePath()
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    // 첫 실행(파일 없음)만 빈 서재로 시작해 쓴다
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      writeBlocked = true
      console.error('읽기 기록을 읽지 못해 이번 실행 동안 저장하지 않습니다:', err)
    }
    lib = parseLibrary(null)
    return lib
  }
  try {
    lib = parseLibrary(JSON.parse(raw))
  } catch (err) {
    // 손상된 파일은 지우지 않고 옆에 보관한 뒤 새로 시작
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`)
    } catch {
      writeBlocked = true
    }
    console.error('읽기 기록이 손상되어 보관 후 새로 시작합니다:', err)
    lib = parseLibrary(null)
  }
  return lib
}

/** 지금 바로 디스크에 기록 (종료 직전) */
export function flushLibrary(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = null
  if (!lib || writeBlocked) return
  const path = filePath()
  const tmp = `${path}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(lib), 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    console.error('읽기 기록 저장 실패:', err)
  }
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(flushLibrary, WRITE_DELAY)
}

const validKey = (key: unknown): key is string =>
  typeof key === 'string' && key.length <= MAX_KEY && /^(epub|pdf):/.test(key)

function getBook(key: unknown): BookRecord | null {
  return validKey(key) ? (load().books[key] ?? null) : null
}

function patchBook(key: unknown, patch: unknown): void {
  if (!validKey(key)) return
  const l = load()
  lib = { ...l, books: { ...l.books, [key]: mergeBook(l.books[key], sanitizeBookPatch(patch), Date.now()) } }
  scheduleWrite()
}

/** 밑줄 추가·삭제는 저장된 기록 위에서 합친다 (렌더러 목록으로 통째 덮지 않음) — 결과 목록 반환 */
function updateNotes(key: unknown, fn: (prev: BookRecord | undefined) => BookRecord): EpubNote[] | null {
  if (!validKey(key)) return null
  const l = load()
  const next = fn(l.books[key])
  lib = { ...l, books: { ...l.books, [key]: next } }
  scheduleWrite()
  return next.notes
}

function patchSettings(patch: unknown): LibrarySettings {
  const l = load()
  lib = { ...l, settings: { ...l.settings, ...sanitizeSettings(patch) } }
  scheduleWrite()
  return lib.settings
}

interface SaveOpts {
  title: string
  defaultPath: string
  ext: string
  extName: string
}

async function askSavePath(e: Electron.IpcMainInvokeEvent, opts: SaveOpts): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const ext = String(opts.ext).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'
  const r = await dialog.showSaveDialog(win, {
    title: String(opts.title).slice(0, 200),
    defaultPath: String(opts.defaultPath).slice(0, 1024),
    filters: [{ name: String(opts.extName).slice(0, 100), extensions: [ext] }]
  })
  return r.canceled || !r.filePath ? null : r.filePath
}

export function registerLibraryIpc(): void {
  ipcMain.handle('library:getBook', (_e, key: unknown) => getBook(key))
  ipcMain.handle('library:patchBook', (_e, key: unknown, patch: unknown) => patchBook(key, patch))
  ipcMain.handle('library:addNote', (_e, key: unknown, note: unknown) => {
    const n = sanitizeNote(note)
    if (!n) throw new Error('밑줄 데이터가 올바르지 않습니다')
    return updateNotes(key, (prev) => addNoteTo(prev, n, Date.now()))
  })
  ipcMain.handle('library:removeNote', (_e, key: unknown, id: unknown) => {
    if (typeof id !== 'string' || id.length > 64) throw new Error('밑줄 id가 올바르지 않습니다')
    return updateNotes(key, (prev) => removeNoteFrom(prev, id, Date.now()))
  })
  ipcMain.handle('library:getSettings', () => load().settings)
  ipcMain.handle('library:patchSettings', (_e, patch: unknown) => patchSettings(patch))

  // 문장 카드 PNG 저장
  ipcMain.handle('file:saveBinary', async (e, opts: SaveOpts, data: unknown) => {
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw new Error('저장할 데이터가 올바르지 않습니다')
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    if (bytes.byteLength > MAX_SAVE_BYTES) throw new Error('파일이 너무 큽니다')
    const path = await askSavePath(e, opts)
    if (path) writeFileSync(path, bytes)
    return path
  })

  // 밑줄 모아보기 Markdown 저장
  ipcMain.handle('file:saveText', async (e, opts: SaveOpts, text: unknown) => {
    if (typeof text !== 'string' || text.length > MAX_SAVE_BYTES) throw new Error('저장할 내용이 올바르지 않습니다')
    const path = await askSavePath(e, opts)
    if (path) writeFileSync(path, text, 'utf8')
    return path
  })

  ipcMain.handle('clipboard:writeImage', (_e, data: unknown) => {
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw new Error('이미지 데이터가 올바르지 않습니다')
    const buf = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) throw new Error('이미지를 읽을 수 없습니다')
    clipboard.writeImage(img)
  })
}
