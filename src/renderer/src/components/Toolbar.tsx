import { useState } from 'react'
import { useStore } from '../state/store'
import Icon from './Icon'
import OcrMenu from './OcrMenu'
import {
  armImageTool,
  deletePageAt,
  exportDoc,
  exportImagesToFolder,
  insertBlankAt,
  insertFromPdfAt,
  openFile,
  redo,
  refreshPages,
  saveFile,
  undo,
  updateSelectedTextStyle
} from '../lib/actions'

const HIGHLIGHT_COLORS = ['#ffe04d', '#7ee081', '#ff8fb1', '#7ec8ff']

/** 한글까지 그릴 수 있는 시스템 폰트 위주 */
const TEXT_FONTS = [
  { label: '맑은 고딕', value: 'Malgun Gothic' },
  { label: '바탕', value: 'Batang' },
  { label: '굴림', value: 'Gulim' },
  { label: '돋움', value: 'Dotum' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Courier New', value: 'Courier New' }
]

export default function Toolbar(): React.JSX.Element {
  const info = useStore((s) => s.info)
  const currentPage = useStore((s) => s.currentPage)
  const zoom = useStore((s) => s.zoom)
  const tool = useStore((s) => s.tool)
  const viewMode = useStore((s) => s.viewMode)
  const spread = useStore((s) => s.spread)
  const cover = useStore((s) => s.cover)
  const sidebar = useStore((s) => s.sidebar)
  const highlightColor = useStore((s) => s.highlightColor)
  const textFont = useStore((s) => s.textFont)
  const textSize = useStore((s) => s.textSize)
  const textColor = useStore((s) => s.textColor)
  const selectedImage = useStore((s) => s.selectedImage)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const set = useStore((s) => s.set)
  const gotoPage = useStore((s) => s.gotoPage)
  const [ocrOpen, setOcrOpen] = useState(false)

  const has = !!info
  const zoomTo = (z: number): void => set({ zoom: Math.max(0.1, Math.min(8, z)) })

  // 선택된 텍스트 객체 (있으면 그 스타일을 편집, 없으면 다음 입력의 기본 스타일)
  const textSel = selectedImage?.text ? selectedImage : null
  const showTextOpts = tool === 'text' || !!textSel
  const curFont = textSel?.text?.font ?? textFont
  const curSize = textSel?.text?.size ?? textSize
  const curColor = textSel?.text?.color ?? textColor
  const onFont = (font: string): void => {
    set({ textFont: font })
    if (textSel) void updateSelectedTextStyle({ font })
  }
  const onSize = (size: number): void => {
    set({ textSize: size })
    if (textSel) void updateSelectedTextStyle({ size })
  }
  const onColor = (color: string): void => {
    set({ textColor: color })
    if (textSel) void updateSelectedTextStyle({ color })
  }

  return (
    <div className="toolbar">
      <button className="tb-btn" onClick={() => void openFile()} title="열기 (Ctrl+O)"><Icon name="open" /></button>
      <button className="tb-btn" disabled={!has} onClick={() => void saveFile()} title="저장 (Ctrl+S)"><Icon name="save" /></button>
      <button className="tb-btn" disabled={!has} onClick={() => refreshPages()} title="새로고침 — 멈춘 페이지 다시 불러오기 (F5)"><Icon name="refresh" /></button>

      <span className="tb-sep" />

      <button className="tb-btn" disabled={!has || !canUndo} onClick={() => void undo()} title="실행취소 (Ctrl+Z)"><Icon name="undo" /></button>
      <button className="tb-btn" disabled={!has || !canRedo} onClick={() => void redo()} title="다시실행 (Ctrl+Shift+Z)"><Icon name="redo" /></button>

      <span className="tb-sep" />

      <button className={`tb-btn ${sidebar ? 'active' : ''}`} disabled={!has} onClick={() => set({ sidebar: sidebar ? null : 'thumbnails' })} title="사이드바 (F4)"><Icon name="sidebar" /></button>

      <span className="tb-group">
        <button className="tb-btn" disabled={!has || currentPage <= 0} onClick={() => gotoPage(currentPage - 1)} title="이전 쪽"><Icon name="prev" /></button>
        <input
          className="tb-page"
          disabled={!has}
          type="number"
          min={1}
          max={info?.pageCount ?? 1}
          value={has ? currentPage + 1 : ''}
          onChange={(e) => {
            const v = Number(e.target.value) - 1
            if (info && v >= 0 && v < info.pageCount) gotoPage(v)
          }}
        />
        <span className="tb-total">/ {info?.pageCount ?? '-'}</span>
        <button className="tb-btn" disabled={!has || !info || currentPage >= info.pageCount - 1} onClick={() => gotoPage(currentPage + 1)} title="다음 쪽"><Icon name="next" /></button>
      </span>

      <span className="tb-sep" />

      <span className="tb-group">
        <button className="tb-btn" disabled={!has} onClick={() => zoomTo(zoom / 1.2)} title="축소 (Ctrl+-)"><Icon name="minus" /></button>
        <span className="tb-zoom">{Math.round(zoom * 100)}%</span>
        <button className="tb-btn" disabled={!has} onClick={() => zoomTo(zoom * 1.2)} title="확대 (Ctrl+=)"><Icon name="plus" /></button>
        <button className="tb-btn" disabled={!has} onClick={() => set({ fitWidthTick: useStore.getState().fitWidthTick + 1 })} title="폭 맞춤 (Ctrl+0)"><Icon name="fitWidth" /></button>
        <button className="tb-btn" disabled={!has} onClick={() => set({ fitPageTick: useStore.getState().fitPageTick + 1 })} title="쪽 맞춤 (Ctrl+1)"><Icon name="fitPage" /></button>
      </span>

      <span className="tb-sep" />

      <span className="tb-group">
        <button className={`tb-btn ${spread === 1 ? 'active' : ''}`} disabled={!has} onClick={() => set({ spread: 1 })} title="한쪽 보기"><Icon name="pageOne" /></button>
        <button className={`tb-btn ${spread === 2 ? 'active' : ''}`} disabled={!has} onClick={() => set({ spread: 2 })} title="두쪽 보기"><Icon name="pageTwo" /></button>
        <button className={`tb-btn ${cover ? 'active' : ''}`} disabled={!has || spread !== 2} onClick={() => set({ cover: !cover })} title="표지를 첫 장 단독으로"><Icon name="cover" /></button>
        <button className={`tb-btn ${viewMode === 'grid' ? 'active' : ''}`} disabled={!has} onClick={() => set({ viewMode: viewMode === 'grid' ? 'scroll' : 'grid' })} title="그리드 보기 (Ctrl+G)"><Icon name="grid" /></button>
        <button className={`tb-btn ${viewMode === 'slide' ? 'active' : ''}`} disabled={!has} onClick={() => set({ viewMode: viewMode === 'slide' ? 'scroll' : 'slide' })} title="슬라이드 보기"><Icon name="slide" /></button>
      </span>

      <span className="tb-sep" />

      <span className="tb-group">
        <button className={`tb-btn ${tool === 'select' ? 'active' : ''}`} disabled={!has} onClick={() => set({ tool: 'select', pendingImage: null })} title="텍스트 선택"><Icon name="select" /></button>
        <button className={`tb-btn ${tool === 'highlight' ? 'active' : ''}`} disabled={!has} onClick={() => set({ tool: 'highlight', pendingImage: null, selectedImage: null })} title="형광펜"><Icon name="highlight" /></button>
        {tool === 'highlight' &&
          HIGHLIGHT_COLORS.map((c) => (
            <button key={c} className={`swatch ${highlightColor === c ? 'active' : ''}`} style={{ background: c }} onClick={() => set({ highlightColor: c })} title={c} />
          ))}
        <button className={`tb-btn ${tool === 'eraser' ? 'active' : ''}`} disabled={!has} onClick={() => set({ tool: 'eraser', pendingImage: null, selectedImage: null })} title="지우개 (형광펜/이미지/텍스트 클릭 삭제)"><Icon name="eraser" /></button>
        <button className={`tb-btn ${tool === 'text' ? 'active' : ''}`} disabled={!has} onClick={() => set({ tool: 'text', pendingImage: null, selectedImage: null })} title="텍스트 추가 (페이지 클릭 후 입력 · 추가한 글자는 더블클릭으로 수정)"><Icon name="text" /></button>
        {showTextOpts && (
          <span className="tb-text-opts" onMouseDown={(e) => e.preventDefault()}>
            <select className="tb-font" value={curFont} onChange={(e) => onFont(e.target.value)} title="글꼴">
              {TEXT_FONTS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <input
              className="tb-fontsize"
              type="number"
              min={6}
              max={400}
              value={curSize}
              onChange={(e) => onSize(Math.max(6, Math.min(400, Number(e.target.value) || 18)))}
              title="글자 크기 (pt)"
            />
            <input
              className="tb-fontcolor"
              type="color"
              value={curColor}
              onChange={(e) => onColor(e.target.value)}
              title="글자 색상"
            />
          </span>
        )}
        <button className={`tb-btn ${tool === 'image' ? 'active' : ''}`} disabled={!has} onClick={() => void armImageTool()} title="이미지 삽입"><Icon name="image" /></button>
        <span className="tb-pop">
          <button className={`tb-btn ${ocrOpen ? 'active' : ''}`} disabled={!has} onClick={() => setOcrOpen((v) => !v)} title="OCR 글자 인식 (현재/범위/전체)"><Icon name="ocr" /></button>
          {ocrOpen && <OcrMenu onClose={() => setOcrOpen(false)} />}
        </span>
      </span>

      <span className="tb-sep" />

      <span className="tb-group">
        <button className="tb-btn" disabled={!has} onClick={() => void insertBlankAt(currentPage + 1)} title="빈 페이지 삽입"><Icon name="pageAdd" /></button>
        <button className="tb-btn" disabled={!has} onClick={() => void insertFromPdfAt(currentPage + 1)} title="다른 PDF에서 삽입"><Icon name="pdfAdd" /></button>
        <button className="tb-btn" disabled={!has} onClick={() => void deletePageAt(currentPage)} title="현재 페이지 삭제"><Icon name="pageDel" /></button>
      </span>

      <span className="tb-spacer" />

      <span className="tb-group">
        <button className="tb-btn tb-text" disabled={!has} onClick={() => void exportDoc('markdown')} title="Markdown으로 내보내기"><Icon name="download" /> MD</button>
        <button className="tb-btn tb-text" disabled={!has} onClick={() => void exportDoc('hwpx')} title="한글 문서로 내보내기 (텍스트+이미지)"><Icon name="download" /> 한글</button>
        <button className="tb-btn tb-text" disabled={!has} onClick={() => void exportImagesToFolder()} title="각 페이지를 이미지로 폴더에 저장"><Icon name="images" /> 이미지</button>
      </span>

      <span className="tb-sep" />
      <button className="tb-btn tb-coffee" onClick={() => set({ showSupport: true })} title="후원하기 (Buy Me a Coffee)">☕</button>
    </div>
  )
}
