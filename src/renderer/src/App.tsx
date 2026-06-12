import { useEffect, useRef, useState } from 'react'
import { useStore } from './state/store'
import Toolbar from './components/Toolbar'
import Viewer from './components/Viewer'
import GridView from './components/GridView'
import SlideView from './components/SlideView'
import ThumbnailPanel from './components/ThumbnailPanel'
import BookmarkPanel from './components/BookmarkPanel'
import StatusBar from './components/StatusBar'
import SupportModal from './components/SupportModal'
import {
  addBookmarkAtCurrentPage,
  copySelection,
  deleteSelectedOrPage,
  deselectImage,
  exportDoc,
  exportImagesToFolder,
  ocrCurrentPage,
  openFile,
  saveFile
} from './lib/actions'
import * as actions from './lib/actions'
import type { MenuAction } from '../../shared/types'

declare global {
  interface Window {
    __icepdf?: { actions: typeof actions; state: () => ReturnType<typeof useStore.getState> }
  }
}

function handleMenuAction(action: MenuAction): void {
  const s = useStore.getState()
  switch (action) {
    case 'open':
      void openFile()
      break
    case 'save':
      void saveFile()
      break
    case 'saveAs':
      void saveFile(true)
      break
    case 'exportMarkdown':
      void exportDoc('markdown')
      break
    case 'exportHwpx':
      void exportDoc('hwpx')
      break
    case 'exportImages':
      void exportImagesToFolder()
      break
    case 'addBookmark':
      void addBookmarkAtCurrentPage()
      break
    case 'ocr':
      void ocrCurrentPage()
      break
    case 'zoomIn':
      s.set({ zoom: Math.min(8, s.zoom * 1.2) })
      break
    case 'zoomOut':
      s.set({ zoom: Math.max(0.1, s.zoom / 1.2) })
      break
    case 'fitWidth':
      s.set({ fitWidthTick: s.fitWidthTick + 1 })
      break
    case 'fitPage':
      s.set({ fitPageTick: s.fitPageTick + 1 })
      break
    case 'toggleGrid':
      s.set({ viewMode: s.viewMode === 'grid' ? 'scroll' : 'grid' })
      break
    case 'toggleSlide':
      s.set({ viewMode: s.viewMode === 'slide' ? 'scroll' : 'slide' })
      break
    case 'toggleSidebar':
      s.set({ sidebar: s.sidebar ? null : 'thumbnails' })
      break
    case 'toggleFullscreen':
      toggleFullscreen()
      break
    case 'support':
      s.set({ showSupport: true })
      break
  }
}

/** Ctrl+L: 크롬 숨김 + 창 전체화면 */
function toggleFullscreen(): void {
  const s = useStore.getState()
  const next = !s.fullscreen
  s.set({ fullscreen: next, chromeHidden: next })
  void window.icepdf.setFullScreen(next)
}

/** Tab: 크롬(툴바)만 숨김/표시 */
function toggleChrome(): void {
  const s = useStore.getState()
  s.set({ chromeHidden: !s.chromeHidden })
}

/** Esc: 전체화면/크롬 숨김 해제 */
function exitChrome(): void {
  const s = useStore.getState()
  if (s.fullscreen) void window.icepdf.setFullScreen(false)
  s.set({ chromeHidden: false, fullscreen: false })
}

export default function App(): React.JSX.Element {
  const info = useStore((s) => s.info)
  const sidebar = useStore((s) => s.sidebar)
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const viewMode = useStore((s) => s.viewMode)
  const busy = useStore((s) => s.busy)
  const toast = useStore((s) => s.toast)
  const dirty = useStore((s) => s.dirty)
  const chromeHidden = useStore((s) => s.chromeHidden)
  const set = useStore((s) => s.set)
  const [dragOver, setDragOver] = useState(false)
  const resizing = useRef(false)

  useEffect(() => window.icepdf.onMenuAction(handleMenuAction), [])

  // 연결 프로그램으로 열기 / 두 번째 인스턴스
  useEffect(() => {
    window.icepdf.getInitialFile().then((p) => {
      if (p) void openFile(p)
    })
    return window.icepdf.onOpenFile((p) => void openFile(p))
  }, [])

  // e2e 테스트 훅
  useEffect(() => {
    window.__icepdf = { actions, state: () => useStore.getState() }
  }, [])

  useEffect(() => {
    const title = info ? `${dirty ? '● ' : ''}${info.title} — ICEPDF` : 'ICEPDF'
    void window.icepdf.setTitle(title)
  }, [info, dirty])

  // 사이드바 리사이즈 (#4)
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      if (!resizing.current) return
      const w = Math.max(140, Math.min(480, e.clientX))
      useStore.getState().set({ sidebarWidth: w })
    }
    const onUp = (): void => {
      resizing.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  // 스페이스바 손도구 패닝 (#D)
  useEffect(() => {
    const isTyping = (): boolean => document.activeElement?.tagName === 'INPUT'
    const down = (e: KeyboardEvent): void => {
      // 스페이스 반복 keydown도 기본 스크롤을 막아야 손툴만 동작 (#a)
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault()
        if (!e.repeat) useStore.getState().set({ panMode: true })
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') useStore.getState().set({ panMode: false })
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inInput = (e.target as HTMLElement).tagName === 'INPUT'
      const s = useStore.getState()
      if (inInput) return
      const slide = s.viewMode === 'slide'
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        // OCR 텍스트 레이어 등 네이티브 선택이 있으면 브라우저 기본 복사에 맡긴다
        if ((window.getSelection()?.toString() ?? '').trim()) return
        void copySelection()
      } else if (e.key === 'Tab' && s.info) {
        e.preventDefault()
        toggleChrome()
      } else if (e.key === 'Delete' && s.info) {
        void deleteSelectedOrPage()
      } else if (e.key === 'Escape') {
        if (s.fullscreen || s.chromeHidden) exitChrome()
        else if (s.selectedImage) deselectImage()
        else s.set({ selection: null, pendingImage: null, tool: s.tool === 'image' ? 'select' : s.tool })
      } else if ((e.key === 'PageDown' || (slide && (e.key === 'ArrowRight' || e.key === 'ArrowDown'))) && s.info) {
        e.preventDefault()
        s.gotoPage(s.currentPage + 1)
      } else if ((e.key === 'PageUp' || (slide && (e.key === 'ArrowLeft' || e.key === 'ArrowUp'))) && s.info) {
        e.preventDefault()
        s.gotoPage(s.currentPage - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 드래그드롭으로 PDF 열기 (#1)
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) {
      set({ toast: 'PDF 파일만 열 수 있습니다' })
      return
    }
    const path = window.icepdf.pathForFile(file)
    if (path) void openFile(path)
  }

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault()
        if (!dragOver) setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      {!chromeHidden && <Toolbar />}
      <div className="main">
        {info && sidebar && !chromeHidden && (
          <>
            <div className="sidebar" style={{ width: sidebarWidth }}>
              <div className="sidebar-tabs">
                <button className={sidebar === 'thumbnails' ? 'active' : ''} onClick={() => set({ sidebar: 'thumbnails' })}>페이지</button>
                <button className={sidebar === 'bookmarks' ? 'active' : ''} onClick={() => set({ sidebar: 'bookmarks' })}>책갈피</button>
              </div>
              <div className="sidebar-body">{sidebar === 'thumbnails' ? <ThumbnailPanel /> : <BookmarkPanel />}</div>
            </div>
            <div
              className="sidebar-resizer"
              onPointerDown={() => {
                resizing.current = true
                document.body.style.cursor = 'col-resize'
              }}
              title="드래그하여 너비 조정"
            />
          </>
        )}
        <div className="content">
          {!info ? (
            <div className="welcome">
              <h1>ICEPDF</h1>
              <p>PDF 보기 · 편집 · 한글(HWPX)/Markdown 변환</p>
              <button onClick={() => void openFile()}>📂 PDF 열기 (Ctrl+O)</button>
              <p className="welcome-hint">또는 이 창에 PDF 파일을 끌어다 놓으세요</p>
            </div>
          ) : viewMode === 'grid' ? (
            <GridView />
          ) : viewMode === 'slide' ? (
            <SlideView />
          ) : (
            <Viewer />
          )}
        </div>
      </div>
      {!chromeHidden && <StatusBar />}
      {busy && (
        <div className="busy-overlay">
          <div className="busy-box">{busy}</div>
        </div>
      )}
      {dragOver && <div className="drop-overlay">여기에 PDF를 놓으세요</div>}
      <SupportModal />
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
