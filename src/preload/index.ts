import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ConvertResult, DocInfo, EngineOpName, EngineOps, MenuAction } from '../shared/types'

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
  openPdfDialog(): Promise<string | null> {
    return ipcRenderer.invoke('dialog:openPdf')
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
