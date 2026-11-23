import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ConvertResult, DocInfo, EngineOpName, EngineOps, MenuAction, RelaidDoc } from '../shared/types'
import type { UpdateCheckResult } from '../shared/version'
import type { BookRecord, EpubNote, LibrarySettings, ReadingFontOption } from '../shared/reading'

const api = {
  engine<K extends EngineOpName>(docId: number, op: K, args: EngineOps[K]['args']): Promise<EngineOps[K]['result']> {
    return ipcRenderer.invoke('engine:call', docId, op, args)
  },
  /** 새 문서를 열고 docId 발급 (탭마다 독립 문서) */
  openDoc(path: string): Promise<{ docId: number; info: DocInfo }> {
    return ipcRenderer.invoke('doc:open', path)
  },
  /** 탭 닫을 때 문서 메모리 해제 */
  closeDoc(docId: number): Promise<null> {
    return ipcRenderer.invoke('doc:close', docId)
  },
  /** includeEpub=true면 PDF·EPUB 모두 (문서 열기), false면 PDF만 (쪽 삽입) */
  openPdfDialog(includeEpub = false): Promise<string | null> {
    return ipcRenderer.invoke('dialog:openPdf', includeEpub)
  },
  openImageDialog(): Promise<{ path: string; data: ArrayBuffer } | null> {
    return ipcRenderer.invoke('dialog:openImage')
  },
  saveFileDialog(opts: {
    title: string
    defaultPath: string
    ext: string
    extName: string
  }): Promise<string | null> {
    return ipcRenderer.invoke('dialog:saveFile', opts)
  },
  confirm(message: string, detail?: string): Promise<boolean> {
    return ipcRenderer.invoke('dialog:confirm', message, detail)
  },
  convert(docId: number, mode: 'markdown' | 'hwpx' | 'images', outPath: string): Promise<ConvertResult> {
    return ipcRenderer.invoke('convert:run', docId, mode, outPath)
  },
  chooseFolder(title: string): Promise<string | null> {
    return ipcRenderer.invoke('dialog:chooseFolder', title)
  },
  /** 자기완결 인쇄 HTML을 숨김 창에서 인쇄 (모아찍기 미리보기와 동일 HTML) */
  printHtml(html: string): Promise<void> {
    return ipcRenderer.invoke('print:run', html)
  },
  ocrPage(
    docId: number,
    page: number,
    lang = 'kor+eng'
  ): Promise<{ text: string; words: { x: number; y: number; w: number; h: number; text: string }[] }> {
    return ipcRenderer.invoke('ocr:page', docId, page, lang)
  },
  setFullScreen(on: boolean): Promise<void> {
    return ipcRenderer.invoke('window:setFullScreen', on)
  },
  /** 저장 안 한 변경 여부를 메인에 알림 (창 닫기 확인용) */
  setUnsaved(value: boolean): Promise<void> {
    return ipcRenderer.invoke('window:setUnsaved', value)
  },
  /** 닫기 다이얼로그에서 저장을 마친 뒤 메인에 닫기 확정 통지 */
  confirmClose(): Promise<void> {
    return ipcRenderer.invoke('window:closeConfirmed')
  },
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke('shell:openExternal', url)
  },
  setTitle(title: string): Promise<void> {
    return ipcRenderer.invoke('app:setTitle', title)
  },
  getInitialFile(): Promise<string | null> {
    return ipcRenderer.invoke('app:getInitialFile')
  },
  getVersion(): Promise<string> {
    return ipcRenderer.invoke('app:getVersion')
  },
  /** GitHub Releases 최신 버전 확인 — auto=true는 설치본에서만 실제 요청 */
  checkUpdate(auto: boolean): Promise<UpdateCheckResult> {
    return ipcRenderer.invoke('update:check', auto)
  },
  // ── 읽기 기록 (읽던 곳·EPUB 밑줄·테마) ──
  libraryGetBook(key: string): Promise<BookRecord | null> {
    return ipcRenderer.invoke('library:getBook', key)
  },
  libraryPatchBook(key: string, patch: Partial<BookRecord>): Promise<void> {
    return ipcRenderer.invoke('library:patchBook', key, patch)
  },
  /** 밑줄 추가 — 저장된 기록에 합쳐진 전체 목록을 돌려준다 */
  libraryAddNote(key: string, note: EpubNote): Promise<EpubNote[] | null> {
    return ipcRenderer.invoke('library:addNote', key, note)
  },
  libraryRemoveNote(key: string, id: string): Promise<EpubNote[] | null> {
    return ipcRenderer.invoke('library:removeNote', key, id)
  },
  libraryGetSettings(): Promise<LibrarySettings> {
    return ipcRenderer.invoke('library:getSettings')
  },
  libraryPatchSettings(patch: Partial<LibrarySettings>): Promise<LibrarySettings> {
    return ipcRenderer.invoke('library:patchSettings', patch)
  },
  /** 설치된 한글 글꼴 (EPUB 읽기 글꼴 고르기) */
  listReadingFonts(): Promise<ReadingFontOption[]> {
    return ipcRenderer.invoke('fonts:list')
  },
  /** EPUB 본문 글꼴 적용 ('' = 책 기본) — 열린 EPUB들을 다시 나눈 결과 */
  setEpubFont(id: string): Promise<RelaidDoc[]> {
    return ipcRenderer.invoke('epub:setFont', id)
  },
  /** 저장 대화상자 → 바이너리 저장 (문장 카드 PNG). 취소하면 null */
  saveBinaryFile(opts: { title: string; defaultPath: string; ext: string; extName: string }, data: ArrayBuffer): Promise<string | null> {
    return ipcRenderer.invoke('file:saveBinary', opts, data)
  },
  /** 저장 대화상자 → 텍스트 저장 (밑줄 Markdown). 취소하면 null */
  saveTextFile(opts: { title: string; defaultPath: string; ext: string; extName: string }, text: string): Promise<string | null> {
    return ipcRenderer.invoke('file:saveText', opts, text)
  },
  copyImage(png: ArrayBuffer): Promise<void> {
    return ipcRenderer.invoke('clipboard:writeImage', png)
  },
  /** 드래그드롭된 File의 실제 경로 (Electron webUtils) */
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
  onMenuAction(handler: (action: MenuAction) => void): () => void {
    const listener = (_e: unknown, action: MenuAction): void => handler(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  },
  onOpenFile(handler: (path: string) => void): () => void {
    const listener = (_e: unknown, path: string): void => handler(path)
    ipcRenderer.on('file:open', listener)
    return () => ipcRenderer.removeListener('file:open', listener)
  },
  /** 메인이 "전부 저장 후 닫기"를 요청 */
  onSaveAllThenClose(handler: () => void): () => void {
    const listener = (): void => handler()
    ipcRenderer.on('app:saveAllThenClose', listener)
    return () => ipcRenderer.removeListener('app:saveAllThenClose', listener)
  }
}

export type IcepdfApi = typeof api

contextBridge.exposeInMainWorld('icepdf', api)
