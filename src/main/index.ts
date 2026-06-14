import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { registerIpc, setInitialFile } from './ipc'
import { shutdownEngine } from './engine/proxy'
import type { MenuAction } from '../shared/types'

let mainWindow: BrowserWindow | null = null
/** 렌더러가 보고한 저장 안 한 변경 여부 (창 닫기 확인용) */
let hasUnsaved = false
/** 사용자가 저장/저장 안 함을 택해 닫기를 확정한 상태 */
let allowClose = false

function send(action: MenuAction): void {
  mainWindow?.webContents.send('menu:action', action)
}

/** argv에서 열어야 할 PDF 경로 추출 ('연결 프로그램으로 열기' 시 인자로 전달됨) */
function pdfPathFromArgv(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    if (/\.pdf$/i.test(arg) && existsSync(arg)) return arg
  }
  return null
}

function openInRenderer(path: string): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    mainWindow.webContents.send('file:open', path)
  }
}

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: '파일(&F)',
      submenu: [
        { label: '열기...', accelerator: 'Ctrl+O', click: () => send('open') },
        { label: '새 탭으로 열기...', accelerator: 'Ctrl+T', click: () => send('newTab') },
        { label: '탭 닫기', accelerator: 'Ctrl+W', click: () => send('closeTab') },
        { type: 'separator' },
        { label: '저장', accelerator: 'Ctrl+S', click: () => send('save') },
        { label: '다른 이름으로 저장...', accelerator: 'Ctrl+Shift+S', click: () => send('saveAs') },
        { type: 'separator' },
        {
          label: '내보내기',
          submenu: [
            { label: 'Markdown (.md)...', click: () => send('exportMarkdown') },
            { label: '한글 문서 (.hwpx)...', click: () => send('exportHwpx') },
            { label: '이미지로 내보내기 (폴더)...', click: () => send('exportImages') }
          ]
        },
        { type: 'separator' },
        { label: '종료', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: '편집(&E)',
      submenu: [
        { label: '책갈피 추가', accelerator: 'Ctrl+B', click: () => send('addBookmark') },
        { label: '현재 페이지 OCR', accelerator: 'Ctrl+Shift+O', click: () => send('ocr') },
        { type: 'separator' },
        { label: '복사', role: 'copy' }
      ]
    },
    {
      label: '보기(&V)',
      submenu: [
        { label: '확대', accelerator: 'Ctrl+=', click: () => send('zoomIn') },
        { label: '축소', accelerator: 'Ctrl+-', click: () => send('zoomOut') },
        { label: '폭 맞춤', accelerator: 'Ctrl+0', click: () => send('fitWidth') },
        { label: '쪽 맞춤', accelerator: 'Ctrl+1', click: () => send('fitPage') },
        { type: 'separator' },
        { label: '그리드 보기 전환', accelerator: 'Ctrl+G', click: () => send('toggleGrid') },
        { label: '슬라이드 보기 전환', accelerator: 'Ctrl+Shift+P', click: () => send('toggleSlide') },
        { label: '전체 화면 (툴바 숨김)', accelerator: 'Ctrl+L', click: () => send('toggleFullscreen') },
        { label: '사이드바 전환', accelerator: 'F4', click: () => send('toggleSidebar') },
        { type: 'separator' },
        { label: '개발자 도구', accelerator: 'F12', role: 'toggleDevTools' }
      ]
    },
    {
      label: '후원(&S)',
      submenu: [
        { label: '☕ Buy Me a Coffee로 후원하기', click: () => send('support') },
        { type: 'separator' },
        { label: '후원 페이지 바로 열기', click: () => shell.openExternal('https://buymeacoffee.com/icenovel') }
      ]
    },
    {
      label: '도움말(&H)',
      submenu: [
        { label: 'ICEPDF 정보', click: () => send('support') },
        { label: 'kordoc (변환 엔진)', click: () => shell.openExternal('https://github.com/chrisryugj/kordoc') }
      ]
    }
  ])
  Menu.setApplicationMenu(menu)
}

/** 창 닫기 확인용 IPC — 렌더러의 dirty 상태 동기화 + 저장 후 닫기 확정 */
function registerWindowIpc(): void {
  ipcMain.handle('window:setUnsaved', (_e, value: boolean) => {
    hasUnsaved = !!value
  })
  ipcMain.handle('window:closeConfirmed', () => {
    allowClose = true
    mainWindow?.close()
  })
}

/** 저장 안 한 변경이 있으면 닫기 전에 저장 여부를 묻는다 (이미지/텍스트 추가 후 무경고 종료 방지) */
function onWindowClose(e: Electron.Event): void {
  if (allowClose || !hasUnsaved || !mainWindow) return
  e.preventDefault()
  const win = mainWindow
  void dialog
    .showMessageBox(win, {
      type: 'warning',
      message: '저장하지 않은 변경이 있습니다',
      detail: '창을 닫기 전에 변경 사항을 저장하시겠습니까?',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    .then((r) => {
      if (r.response === 2) return // 취소 — 닫기 중단
      if (r.response === 1) {
        // 저장 안 함 — 그대로 닫기
        allowClose = true
        win.close()
        return
      }
      // 저장 — 렌더러가 전부 저장한 뒤 window:closeConfirmed 로 다시 닫는다
      win.webContents.send('app:saveAllThenClose')
    })
}

function appIcon(): Electron.NativeImage | undefined {
  // 개발 시에는 build/icon.ico, 패키징 시에는 리소스의 아이콘 사용
  const candidates = [
    join(import.meta.dirname, '../../build/icon.ico'),
    join(process.resourcesPath ?? '', 'build', 'icon.ico')
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }
  return undefined
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    show: false,
    title: 'ICEPDF',
    icon: appIcon(),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', onWindowClose)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // 전체화면 동안만 메뉴바 숨김 — 해제 시 반드시 복원 (이벤트로 처리해 복원 누락 방지)
  mainWindow.on('enter-full-screen', () => mainWindow?.setMenuBarVisibility(false))
  mainWindow.on('leave-full-screen', () => mainWindow?.setMenuBarVisibility(true))

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// 단일 인스턴스 — 두 번째 실행 시 그 인자의 PDF를 기존 창에서 연다
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const p = pdfPathFromArgv(argv)
    if (p) openInRenderer(p)
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // macOS: 파일 연결 열기
  app.on('open-file', (e, path) => {
    e.preventDefault()
    if (mainWindow) openInRenderer(path)
    else setInitialFile(path)
  })

  app.whenReady().then(() => {
    setInitialFile(pdfPathFromArgv(process.argv))
    registerIpc()
    registerWindowIpc()
    buildMenu()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    shutdownEngine()
    if (process.platform !== 'darwin') app.quit()
  })
}
