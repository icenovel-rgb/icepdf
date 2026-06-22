import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { Worker } from 'node:worker_threads'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDoc, engineCall, openDoc } from './engine/proxy'
import type { ConvertResult, EngineOpName } from '../shared/types'

// ── kordoc 변환 워커 RPC ──

let convertWorker: Worker | null = null
let convertId = 1
const convertPending = new Map<
  number,
  { resolve: (v: ConvertResult) => void; reject: (e: Error) => void }
>()

function getConvertWorker(): Worker {
  if (convertWorker) return convertWorker
  convertWorker = new Worker(join(import.meta.dirname, 'convert/worker.js'))
  convertWorker.on('message', (msg: { id: number; ok: boolean; result?: ConvertResult; error?: string }) => {
    const p = convertPending.get(msg.id)
    if (!p) return
    convertPending.delete(msg.id)
    if (msg.ok && msg.result) p.resolve(msg.result)
    else p.reject(new Error(msg.error ?? '변환 오류'))
  })
  convertWorker.on('error', (err) => {
    for (const [, p] of convertPending) p.reject(err)
    convertPending.clear()
    convertWorker = null
  })
  return convertWorker
}

function runConvert(mode: 'markdown' | 'hwpx' | 'images', pdf: ArrayBuffer, outPath: string): Promise<ConvertResult> {
  return new Promise((resolve, reject) => {
    const id = convertId++
    convertPending.set(id, { resolve, reject })
    getConvertWorker().postMessage({ id, mode, pdf, outPath }, [pdf])
  })
}

// ── OCR 워커 RPC ──

interface OcrResult {
  text: string
  words: { text: string; x0: number; y0: number; x1: number; y1: number }[]
}

let ocrWorker: Worker | null = null
let ocrId = 1
const ocrPending = new Map<number, { resolve: (r: OcrResult) => void; reject: (e: Error) => void }>()

function getOcrWorker(): Worker {
  if (ocrWorker) return ocrWorker
  ocrWorker = new Worker(join(import.meta.dirname, 'ocr/worker.js'))
  ocrWorker.on('message', (msg: { id: number; ok: boolean; result?: OcrResult; error?: string }) => {
    const p = ocrPending.get(msg.id)
    if (!p) return
    ocrPending.delete(msg.id)
    if (msg.ok && msg.result) p.resolve(msg.result)
    else p.reject(new Error(msg.error ?? 'OCR 오류'))
  })
  ocrWorker.on('error', (err) => {
    for (const [, p] of ocrPending) p.reject(err)
    ocrPending.clear()
    ocrWorker = null
  })
  return ocrWorker
}

function runOcr(png: ArrayBuffer, lang: string): Promise<OcrResult> {
  const cachePath = join(app.getPath('userData'), 'tessdata')
  return new Promise((resolve, reject) => {
    const id = ocrId++
    ocrPending.set(id, { resolve, reject })
    getOcrWorker().postMessage({ id, png, cachePath, lang }, [png])
  })
}

const OCR_SCALE = 2.5

// ── 초기 파일 (연결 프로그램으로 열기) ──

let initialFile: string | null = null
export function setInitialFile(path: string | null): void {
  if (path) initialFile = path
}

// ── IPC 핸들러 ──

export function registerIpc(): void {
  ipcMain.handle('app:getInitialFile', () => {
    const f = initialFile
    initialFile = null
    return f
  })

  ipcMain.handle('engine:call', async (_e, docId: number, op: EngineOpName, args: Record<string, unknown>) => {
    return engineCall(docId, op, args as never)
  })

  ipcMain.handle('doc:open', async (_e, path: string) => {
    return openDoc(path)
  })

  ipcMain.handle('doc:close', async (_e, docId: number) => {
    return closeDoc(docId)
  })

  ipcMain.handle('dialog:openPdf', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      title: 'PDF 열기',
      filters: [{ name: 'PDF 문서', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:openImage', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      title: '삽입할 이미지 선택',
      filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg'] }],
      properties: ['openFile']
    })
    if (r.canceled) return null
    const { readFileSync } = await import('node:fs')
    const buf = readFileSync(r.filePaths[0])
    return { path: r.filePaths[0], data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
  })

  ipcMain.handle(
    'dialog:saveFile',
    async (e, opts: { title: string; defaultPath: string; ext: string; extName: string }) => {
      const win = BrowserWindow.fromWebContents(e.sender)!
      const r = await dialog.showSaveDialog(win, {
        title: opts.title,
        defaultPath: opts.defaultPath,
        filters: [{ name: opts.extName, extensions: [opts.ext] }]
      })
      return r.canceled || !r.filePath ? null : r.filePath
    }
  )

  ipcMain.handle('dialog:confirm', async (e, message: string, detail?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      message,
      detail,
      buttons: ['확인', '취소'],
      defaultId: 0,
      cancelId: 1
    })
    return r.response === 0
  })

  ipcMain.handle('convert:run', async (_e, docId: number, mode: 'markdown' | 'hwpx' | 'images', outPath: string) => {
    const pdf = await engineCall(docId, 'getPdfBuffer', {})
    return runConvert(mode, pdf, outPath)
  })

  ipcMain.handle('ocr:page', async (_e, docId: number, page: number, lang: string) => {
    const r = await engineCall(docId, 'render', { page, scale: OCR_SCALE })
    const result = await runOcr(r.png, lang)
    // 단어 bbox를 PDF 포인트 좌표로 변환
    const words = result.words.map((w) => ({
      x: w.x0 / OCR_SCALE,
      y: w.y0 / OCR_SCALE,
      w: (w.x1 - w.x0) / OCR_SCALE,
      h: (w.y1 - w.y0) / OCR_SCALE,
      text: w.text
    }))
    return { text: result.text, words }
  })

  ipcMain.handle('app:setTitle', (e, title: string) => {
    BrowserWindow.fromWebContents(e.sender)?.setTitle(title)
  })

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })

  ipcMain.handle('window:setFullScreen', (e, on: boolean) => {
    // 메뉴바 가시성은 창의 enter/leave-full-screen 이벤트에서 처리
    BrowserWindow.fromWebContents(e.sender)?.setFullScreen(on)
  })

  ipcMain.handle('dialog:chooseFolder', async (e, title: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  // 인쇄 — 렌더러가 만든 자기완결 HTML(모아찍기 그리드 + data URL 이미지)을
  // 숨김 창에 로드 후 OS 인쇄 다이얼로그를 띄운다. 미리보기와 동일한 HTML이라 WYSIWYG.
  ipcMain.handle('print:run', async (_e, html: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'icepdf-print-'))
    const htmlPath = join(dir, 'print.html')
    writeFileSync(htmlPath, html, 'utf-8')
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
    const cleanup = (): void => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* 임시 파일 정리 실패는 무시 */
      }
    }
    try {
      await win.loadFile(htmlPath)
      // data URL 이미지가 실제로 디코드된 뒤 인쇄해야 빈 페이지가 안 나온다
      await win.webContents.executeJavaScript(
        'Promise.all([...document.images].map((i) => i.decode().catch(() => {})))'
      )
      await new Promise<void>((resolve) => {
        win.webContents.print({ silent: false, printBackground: true }, () => resolve())
      })
    } catch (err) {
      console.error('인쇄 실패:', err)
      throw new Error(err instanceof Error ? err.message : '인쇄에 실패했습니다')
    } finally {
      if (!win.isDestroyed()) win.close()
      cleanup()
    }
  })
}
