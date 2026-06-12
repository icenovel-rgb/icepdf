import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ConvertResult, EngineOpName, EngineOps, MenuAction } from '../shared/types'

const api = {
  engine<K extends EngineOpName>(op: K, args: EngineOps[K]['args']): Promise<EngineOps[K]['result']> {
    return ipcRenderer.invoke('engine:call', op, args)
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
  convert(mode: 'markdown' | 'hwpx' | 'images', outPath: string): Promise<ConvertResult> {
    return ipcRenderer.invoke('convert:run', mode, outPath)
  },
  chooseFolder(title: string): Promise<string | null> {
    return ipcRenderer.invoke('dialog:chooseFolder', title)
  },
  ocrPage(
    page: number,
    lang = 'kor+eng'
  ): Promise<{ text: string; words: { x: number; y: number; w: number; h: number; text: string }[] }> {
    return ipcRenderer.invoke('ocr:page', page, lang)
  },
  setFullScreen(on: boolean): Promise<void> {
    return ipcRenderer.invoke('window:setFullScreen', on)
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
  }
}

export type IcepdfApi = typeof api

contextBridge.exposeInMainWorld('icepdf', api)
