import { useEffect, useRef, useState } from 'react'
import { useStore, type SelectedImage } from '../state/store'
import { usePageImage, pageRenderScale } from '../lib/images'
import { eng } from '../lib/engine'
import PageCanvas from './PageCanvas'
import {
  commitImageTransform,
  deselectImage,
  eraseAt,
  flipImage,
  highlightSelection,
  placeImage,
  placeText,
  rotateImageBy,
  selectImageAt,
  updateSelectedImageLocal
} from '../lib/actions'
import { CURSOR_ERASER, CURSOR_ROTATE } from '../lib/cursors'
import Icon from './Icon'
import type { LinkInfo, Quad, Rect } from '../../../shared/types'

interface Props {
  page: number
  visible: boolean
  /** 줌 대체값 (슬라이드 보기 등) — 없으면 스토어 zoom 사용 */
  scale?: number
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'

function quadToBox(q: Quad, zoom: number): { left: number; top: number; width: number; height: number } {
  const x0 = Math.min(q[0], q[4])
  const y0 = Math.min(q[1], q[3])
  const x1 = Math.max(q[2], q[6])
  const y1 = Math.max(q[5], q[7])
  return { left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom }
}

function norm(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a]
}

const ROT_HANDLE_OFFSET = 26 // px

export default function PageView({ page, visible, scale }: Props): React.JSX.Element {
  const info = useStore((s) => s.info)
  const storeZoom = useStore((s) => s.zoom)
  const activeDocId = useStore((s) => s.activeDocId)
  const zoom = scale ?? storeZoom
  const epoch = useStore((s) => s.epoch)
  const tool = useStore((s) => s.tool)
  const selection = useStore((s) => s.selection)
  const pendingImage = useStore((s) => s.pendingImage)
  const highlightColor = useStore((s) => s.highlightColor)
  const textFont = useStore((s) => s.textFont)
  const textSize = useStore((s) => s.textSize)
  const textColor = useStore((s) => s.textColor)
  const selectedImage = useStore((s) => s.selectedImage)
  const ocrWords = useStore((s) => s.ocrLayers[page])
  const panMode = useStore((s) => s.panMode)
  const set = useStore((s) => s.set)

  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<
    | null
    | { mode: 'select-text'; start: [number, number]; moved: boolean }
    | { mode: 'place-image'; start: [number, number] }
    | { mode: 'img-move'; start: [number, number]; startSel: SelectedImage }
    | { mode: 'img-resize'; corner: Corner; startSel: SelectedImage }
    | { mode: 'img-rotate'; startSel: SelectedImage }
  >(null)
  const selSeq = useRef(0)
  const rafPending = useRef(false)
  const lastPoint = useRef<[number, number] | null>(null)
  const [placeRect, setPlaceRect] = useState<Rect | null>(null)
  const [links, setLinks] = useState<LinkInfo[]>([])
  // 텍스트 추가 툴: 페이지 위 인라인 편집기 (page 좌표)
  const [textDraft, setTextDraft] = useState<{ x: number; y: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textCancel = useRef(false)

  const pageInfo = info?.pages[page]
  const renderScale = pageRenderScale(zoom, pageInfo?.width ?? 612, pageInfo?.height ?? 792)
  const url = usePageImage(activeDocId, page, renderScale, epoch, visible && !!pageInfo)

  // 페이지 하이퍼링크 로드 — 편집(epoch)으로 페이지 구성이 바뀌면 다시 가져온다.
  useEffect(() => {
    if (!visible || !pageInfo) {
      setLinks([])
      return
    }
    let alive = true
    eng('getLinks', { page })
      .then((ls) => alive && setLinks(ls))
      .catch(() => alive && setLinks([]))
    return () => {
      alive = false
    }
  }, [activeDocId, page, epoch, visible, !!pageInfo])

  if (!pageInfo) return <div />

  const cssW = pageInfo.width * zoom
  const cssH = pageInfo.height * zoom
  const imgSel = tool === 'select' && selectedImage && selectedImage.page === page ? selectedImage : null

  const toPagePoint = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    const x = Math.max(0, Math.min(pageInfo.width, (e.clientX - r.left) / zoom))
    const y = Math.max(0, Math.min(pageInfo.height, (e.clientY - r.top) / zoom))
    return [x, y]
  }

  const updateSelection = (a: [number, number], b: [number, number]): void => {
    const seq = ++selSeq.current
    eng('selection', { page, ax: a[0], ay: a[1], bx: b[0], by: b[1] })
      .then((r) => {
        if (seq === selSeq.current) set({ selection: { page, quads: r.quads, text: r.text } })
      })
      .catch(() => undefined)
  }

  const cornerAt = (pt: [number, number], rect: Rect): Corner | null => {
    const tol = 10 / zoom
    const [x0, y0, x1, y1] = rect
    const near = (px: number, py: number): boolean => Math.abs(pt[0] - px) < tol && Math.abs(pt[1] - py) < tol
    if (near(x0, y0)) return 'nw'
    if (near(x1, y0)) return 'ne'
    if (near(x0, y1)) return 'sw'
    if (near(x1, y1)) return 'se'
    return null
  }

  const onRotateHandle = (pt: [number, number], rect: Rect): boolean => {
    const cx = (rect[0] + rect[2]) / 2
    const hy = rect[1] - ROT_HANDLE_OFFSET / zoom
    const tol = 11 / zoom
    return Math.abs(pt[0] - cx) < tol && Math.abs(pt[1] - hy) < tol
  }

  const inRect = (pt: [number, number], rect: Rect): boolean =>
    pt[0] >= rect[0] && pt[0] <= rect[2] && pt[1] >= rect[1] && pt[1] <= rect[3]

  /** 인라인 텍스트 편집 종료 — 취소가 아니면 입력 내용을 Stamp로 배치 */
  const commitTextDraft = (): void => {
    const d = textDraft
    const value = textareaRef.current?.value ?? ''
    setTextDraft(null)
    if (d && !textCancel.current && value.trim()) {
      void placeText(page, d.x, d.y, value, { font: textFont, size: textSize, color: textColor })
    }
    textCancel.current = false
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || useStore.getState().panMode) return
    const pt = toPagePoint(e)

    if (tool === 'text') {
      // 편집 중이면 이번 클릭은 종료(블러가 커밋) 용도 — 새 편집기는 다음 클릭에서
      if (textDraft || textareaRef.current) return
      setTextDraft({ x: pt[0], y: pt[1] })
      set({ selection: null, selectedImage: null })
      return
    }

    ref.current!.setPointerCapture(e.pointerId)

    if (tool === 'eraser') {
      void eraseAt(page, pt[0], pt[1])
      return
    }
    if (tool === 'image' && pendingImage) {
      drag.current = { mode: 'place-image', start: pt }
      setPlaceRect([pt[0], pt[1], pt[0], pt[1]])
      return
    }
    if (imgSel) {
      if (onRotateHandle(pt, imgSel.rect)) {
        drag.current = { mode: 'img-rotate', startSel: imgSel }
        return
      }
      const corner = cornerAt(pt, imgSel.rect)
      if (corner) {
        drag.current = { mode: 'img-resize', corner, startSel: imgSel }
        return
      }
      if (inRect(pt, imgSel.rect)) {
        drag.current = { mode: 'img-move', start: pt, startSel: imgSel }
        return
      }
    }
    drag.current = { mode: 'select-text', start: pt, moved: false }
    set({ selection: null })
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const cur = toPagePoint(e)

    if (d.mode === 'place-image' && pendingImage) {
      const aspect = pendingImage.naturalW / pendingImage.naturalH || 1
      const dx = cur[0] - d.start[0]
      const dy = cur[1] - d.start[1]
      const sx = dx < 0 ? -1 : 1
      const sy = dy < 0 ? -1 : 1
      let w = Math.abs(dx)
      let h = Math.abs(dy)
      if (w / aspect > h) h = w / aspect
      else w = h * aspect
      const [x0, x1] = norm(d.start[0], d.start[0] + sx * w)
      const [y0, y1] = norm(d.start[1], d.start[1] + sy * h)
      setPlaceRect([x0, y0, x1, y1])
      return
    }

    if (d.mode === 'img-move') {
      updateSelectedImageLocal({
        cx: d.startSel.cx + (cur[0] - d.start[0]),
        cy: d.startSel.cy + (cur[1] - d.start[1])
      })
      return
    }

    if (d.mode === 'img-rotate') {
      let deg = (Math.atan2(cur[1] - d.startSel.cy, cur[0] - d.startSel.cx) * 180) / Math.PI + 90
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      updateSelectedImageLocal({ rotation: deg })
      return
    }

    if (d.mode === 'img-resize') {
      const ss = d.startSel
      if (ss.rotation === 0 && !ss.flipH && !ss.flipV) {
        // 자유 스트레치 — 반대 코너 고정
        const [rx0, ry0, rx1, ry1] = ss.rect
        const anchor: [number, number] =
          d.corner === 'nw' ? [rx1, ry1] : d.corner === 'ne' ? [rx0, ry1] : d.corner === 'sw' ? [rx1, ry0] : [rx0, ry0]
        let cx = cur[0]
        let cy = cur[1]
        if (e.shiftKey) {
          const aspect = ss.w0 / ss.h0 || 1
          const w = Math.abs(cx - anchor[0])
          const h = Math.abs(cy - anchor[1])
          if (w / aspect > h) cy = anchor[1] + Math.sign(cy - anchor[1] || 1) * (w / aspect)
          else cx = anchor[0] + Math.sign(cx - anchor[0] || 1) * (h * aspect)
        }
        const [x0, x1] = norm(anchor[0], cx)
        const [y0, y1] = norm(anchor[1], cy)
        updateSelectedImageLocal({ w0: Math.max(4, x1 - x0), h0: Math.max(4, y1 - y0), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 })
      } else {
        // 회전·반전 상태 — 중심 기준 균일 스케일
        const [rx0, ry0, rx1, ry1] = ss.rect
        const corner: [number, number] =
          d.corner === 'nw' ? [rx0, ry0] : d.corner === 'ne' ? [rx1, ry0] : d.corner === 'sw' ? [rx0, ry1] : [rx1, ry1]
        const d0 = Math.hypot(corner[0] - ss.cx, corner[1] - ss.cy) || 1
        const d1 = Math.hypot(cur[0] - ss.cx, cur[1] - ss.cy)
        const f = Math.max(0.05, Math.min(50, d1 / d0))
        updateSelectedImageLocal({ w0: Math.max(4, ss.w0 * f), h0: Math.max(4, ss.h0 * f) })
      }
      return
    }

    // 텍스트 선택
    if (d.mode !== 'select-text') return
    d.moved = true
    lastPoint.current = cur
    if (rafPending.current) return
    rafPending.current = true
    requestAnimationFrame(() => {
      rafPending.current = false
      const dd = drag.current
      if (dd?.mode === 'select-text' && lastPoint.current) updateSelection(dd.start, lastPoint.current)
    })
  }

  const onPointerUp = async (e: React.PointerEvent): Promise<void> => {
    const d = drag.current
    drag.current = null

    if (d?.mode === 'place-image' && placeRect) {
      const r = placeRect
      setPlaceRect(null)
      if (r[2] - r[0] > 8 && r[3] - r[1] > 8) await placeImage(page, r)
      return
    }
    if (d?.mode === 'img-move') return void commitImageTransform('move')
    if (d?.mode === 'img-resize') return void commitImageTransform('resize')
    if (d?.mode === 'img-rotate') return void commitImageTransform('rotate')

    if (d?.mode === 'select-text') {
      if (tool === 'highlight') {
        await highlightSelection()
      } else if (!d.moved) {
        const pt = toPagePoint(e)
        const picked = await selectImageAt(page, pt[0], pt[1])
        if (!picked && imgSel) deselectImage()
      }
    }
  }

  const pageCursor = panMode
    ? 'grab'
    : tool === 'eraser'
      ? CURSOR_ERASER
      : tool === 'image' && pendingImage
        ? 'crosshair'
        : 'text'
  const selBoxes = selection && selection.page === page ? selection.quads.map((q) => quadToBox(q, zoom)) : []
  const canRotate = !!imgSel && imgSel.origData.byteLength > 0
  const r = imgSel?.rect
  const handleCursor: Record<Corner, string> = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize' }

  return (
    <div
      ref={ref}
      className="page-view"
      style={{ width: cssW, height: cssH, cursor: pageCursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {url ? (
        <PageCanvas url={url} cssW={cssW} cssH={cssH} />
      ) : (
        <div className="page-loading">{page + 1}</div>
      )}

      {links.length > 0 && (
        <div className="link-layer">
          {links.map((l, i) => {
            // 외부 URL이거나 해석된 내부 페이지가 있을 때만 클릭 가능
            if (!l.external && l.page < 0) return null
            // 읽기(select) 도구일 때만 클릭 — 형광펜/지우개/이미지 도구는 통과
            const active = tool === 'select' && !panMode
            return (
              <div
                key={i}
                className="link-annot"
                title={l.external ? l.uri : `${l.page + 1}쪽으로 이동`}
                style={{
                  left: l.rect[0] * zoom,
                  top: l.rect[1] * zoom,
                  width: (l.rect[2] - l.rect[0]) * zoom,
                  height: (l.rect[3] - l.rect[1]) * zoom,
                  pointerEvents: active ? 'auto' : 'none'
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (l.external) void window.icepdf.openExternal(l.uri)
                  else useStore.getState().gotoPage(l.page)
                }}
              />
            )
          })}
        </div>
      )}

      {ocrWords && ocrWords.length > 0 && (
        <div className="ocr-layer" onPointerDown={(e) => e.stopPropagation()}>
          {ocrWords.map((w, i) => (
            <span
              key={i}
              className="ocr-word"
              style={{
                left: w.x * zoom,
                top: w.y * zoom,
                width: w.w * zoom,
                height: w.h * zoom,
                fontSize: Math.max(6, w.h * zoom * 0.82)
              }}
            >
              {w.text}
            </span>
          ))}
        </div>
      )}

      {selBoxes.map((b, i) => (
        <div
          key={i}
          className="sel-quad"
          style={{
            ...b,
            background: tool === 'highlight' ? highlightColor : 'rgba(59,130,246,0.35)',
            opacity: tool === 'highlight' ? 0.4 : 1,
            borderRadius: 0
          }}
        />
      ))}

      {placeRect && (
        <div
          className="image-rect"
          style={{
            left: placeRect[0] * zoom,
            top: placeRect[1] * zoom,
            width: (placeRect[2] - placeRect[0]) * zoom,
            height: (placeRect[3] - placeRect[1]) * zoom
          }}
        />
      )}

      {textDraft && (
        <textarea
          ref={textareaRef}
          className="text-draft"
          autoFocus
          spellCheck={false}
          defaultValue=""
          style={{
            left: textDraft.x * zoom,
            top: textDraft.y * zoom,
            fontFamily: `"${textFont}", 'Segoe UI', sans-serif`,
            fontSize: textSize * zoom,
            lineHeight: 1.32,
            color: textColor
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commitTextDraft}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              textCancel.current = true
              e.currentTarget.blur()
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />
      )}

      {imgSel && r && (
        <>
          {/* 본문(이동) — 커서 move */}
          <div
            className="img-body"
            style={{ left: r[0] * zoom, top: r[1] * zoom, width: (r[2] - r[0]) * zoom, height: (r[3] - r[1]) * zoom }}
          />
          {/* 선택 박스 + 코너 핸들(스케일 커서) */}
          <div
            className="img-sel-box"
            style={{ left: r[0] * zoom, top: r[1] * zoom, width: (r[2] - r[0]) * zoom, height: (r[3] - r[1]) * zoom }}
          >
            {(['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
              <span key={c} className={`img-handle ${c}`} style={{ cursor: handleCursor[c] }} />
            ))}
            <span className="img-rot-stem" />
          </div>
          {/* 회전 핸들 */}
          {canRotate && (
            <span
              className="img-rot-handle"
              style={{ left: ((r[0] + r[2]) / 2) * zoom, top: r[1] * zoom - ROT_HANDLE_OFFSET, cursor: CURSOR_ROTATE }}
            />
          )}
          {/* 도구툴 */}
          <div
            className="img-toolbar"
            style={{ left: r[0] * zoom, top: r[1] * zoom - ROT_HANDLE_OFFSET - 30 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button title="왼쪽 90° 회전" disabled={!canRotate} onClick={() => rotateImageBy(-90)}><Icon name="rotateLeft" size={16} /></button>
            <button title="오른쪽 90° 회전" disabled={!canRotate} onClick={() => rotateImageBy(90)}><Icon name="rotateRight" size={16} /></button>
            <button title="좌우 반전" disabled={!canRotate} onClick={() => flipImage('h')}><Icon name="flipH" size={16} /></button>
            <button title="상하 반전" disabled={!canRotate} onClick={() => flipImage('v')}><Icon name="flipV" size={16} /></button>
            <button title="선택 해제" onClick={() => deselectImage()}><Icon name="check" size={16} /></button>
          </div>
        </>
      )}
    </div>
  )
}
