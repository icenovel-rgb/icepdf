import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import PageView from './PageView'

const ROW_GAP = 16
const PAGE_GAP = 8
const PAD = 24

/** spread/cover에 따른 행 구성: 각 행은 1~2개 슬롯, -1은 빈칸 */
function computeRows(pageCount: number, spread: 1 | 2, cover: boolean): number[][] {
  if (spread === 1) return Array.from({ length: pageCount }, (_, i) => [i])
  const rows: number[][] = []
  let i = 0
  if (cover) {
    rows.push([-1, 0]) // 표지: 왼쪽 비우고 오른쪽에
    i = 1
  }
  for (; i < pageCount; i += 2) {
    rows.push(i + 1 < pageCount ? [i, i + 1] : [i, -1]) // 끝 1장이면 왼쪽 배치
  }
  return rows
}

export default function Viewer(): React.JSX.Element {
  const info = useStore((s) => s.info)
  const zoom = useStore((s) => s.zoom)
  const spread = useStore((s) => s.spread)
  const cover = useStore((s) => s.cover)
  const scrollTarget = useStore((s) => s.scrollTarget)
  const navSeq = useStore((s) => s.navSeq)
  const fitWidthTick = useStore((s) => s.fitWidthTick)
  const fitPageTick = useStore((s) => s.fitPageTick)
  const set = useStore((s) => s.set)

  const panMode = useStore((s) => s.panMode)
  const containerRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const [range, setRange] = useState<[number, number]>([0, 2])

  const rows = useMemo(
    () => (info ? computeRows(info.pageCount, spread, cover) : []),
    [info, spread, cover]
  )

  /** 페이지 → 행 인덱스 */
  const rowOfPage = useMemo(() => {
    const map = new Map<number, number>()
    rows.forEach((r, ri) => r.forEach((p) => p >= 0 && map.set(p, ri)))
    return map
  }, [rows])

  /** 빈칸(-1) 슬롯 크기 = 같은 행의 실제 페이지 크기 */
  const slotSize = (row: number[], slot: number): { width: number; height: number } => {
    const ref = slot >= 0 ? slot : row.find((p) => p >= 0) ?? 0
    return info!.pages[ref]
  }

  /** 행별 크기(css px) + 누적 상단 오프셋 */
  const layout = useMemo(() => {
    if (!info) return { dims: [] as { width: number; height: number }[], offsets: [PAD], total: PAD, width: 0 }
    const dims = rows.map((r) => {
      const widths = r.map((p) => slotSize(r, p).width * zoom)
      const heights = r.map((p) => slotSize(r, p).height * zoom)
      return {
        width: widths.reduce((a, b) => a + b, 0) + PAGE_GAP * (r.length - 1),
        height: Math.max(...heights)
      }
    })
    const offsets: number[] = []
    let y = PAD
    for (const d of dims) {
      offsets.push(y)
      y += d.height + ROW_GAP
    }
    // 캔버스 가로 너비 = 가장 넓은 행 + 좌우 여백.
    // 지정하지 않으면 확대 시 중앙정렬된 페이지의 왼쪽이 스크롤 영역 밖으로 나가 닿지 못한다.
    const maxRowW = dims.length ? Math.max(...dims.map((d) => d.width)) : 0
    return { dims, offsets, total: y - ROW_GAP + PAD, width: maxRowW + PAD * 2 }
  }, [info, rows, zoom])

  const updateVisible = (): void => {
    const el = containerRef.current
    if (!el || !info) return
    const top = el.scrollTop - el.clientHeight
    const bottom = el.scrollTop + el.clientHeight * 2
    let start = 0
    let end = rows.length - 1
    for (let i = 0; i < rows.length; i++) {
      const rowTop = layout.offsets[i]
      const rowBottom = rowTop + layout.dims[i].height
      if (rowBottom < top) start = i + 1
      if (rowTop > bottom) {
        end = i - 1
        break
      }
    }
    setRange([Math.max(0, start), Math.min(rows.length - 1, Math.max(start, end))])

    const probe = el.scrollTop + el.clientHeight * 0.4
    let curRow = 0
    for (let i = 0; i < rows.length; i++) {
      if (layout.offsets[i] <= probe) curRow = i
      else break
    }
    const cur = rows[curRow]?.find((p) => p >= 0) ?? 0
    if (useStore.getState().currentPage !== cur) set({ currentPage: cur })
  }

  useEffect(updateVisible, [info, zoom, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // 네비게이션 — navSeq가 바뀔 때마다 목표 페이지의 행으로 스크롤 (동일 페이지 재요청도 발화)
  useEffect(() => {
    if (scrollTarget === null || !containerRef.current) return
    const ri = rowOfPage.get(scrollTarget) ?? 0
    containerRef.current.scrollTo({ top: layout.offsets[ri] - 8 })
  }, [navSeq]) // eslint-disable-line react-hooks/exhaustive-deps

  // 폭 맞춤 / 쪽 맞춤
  useEffect(() => {
    if (!fitWidthTick || !info || !containerRef.current) return
    const maxRowW1 = Math.max(
      ...rows.map((r) => r.reduce((a, p) => a + slotSize(r, p).width, 0) + PAGE_GAP * (r.length - 1))
    )
    const target = (containerRef.current.clientWidth - PAD * 2 - 18) / maxRowW1
    set({ zoom: Math.max(0.1, Math.min(8, target)) })
  }, [fitWidthTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!fitPageTick || !info || !containerRef.current) return
    const el = containerRef.current
    const maxRowW1 = Math.max(
      ...rows.map((r) => r.reduce((a, p) => a + slotSize(r, p).width, 0) + PAGE_GAP * (r.length - 1))
    )
    const maxRowH1 = Math.max(...rows.map((r) => Math.max(...r.map((p) => slotSize(r, p).height))))
    const wFit = (el.clientWidth - PAD * 2 - 18) / maxRowW1
    const hFit = (el.clientHeight - PAD * 2) / maxRowH1
    set({ zoom: Math.max(0.1, Math.min(8, Math.min(wFit, hFit))) })
  }, [fitPageTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+휠 줌
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const s = useStore.getState()
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      s.set({ zoom: Math.max(0.1, Math.min(8, s.zoom * factor)) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [info])

  if (!info) return <div />

  const els: React.JSX.Element[] = []
  for (let i = range[0]; i <= range[1]; i++) {
    const row = rows[i]
    if (!row) continue
    els.push(
      <div
        key={i}
        className="page-row"
        style={{ top: layout.offsets[i], height: layout.dims[i].height, gap: PAGE_GAP }}
      >
        {row.map((p, si) =>
          p >= 0 ? (
            <PageView key={p} page={p} visible />
          ) : (
            <div
              key={`blank-${si}`}
              className="page-blank"
              style={{ width: slotSize(row, p).width * zoom, height: slotSize(row, p).height * zoom }}
            />
          )
        )}
      </div>
    )
  }

  // 스페이스바 손도구 패닝 — 컨테이너에서 직접 처리 (PageView는 panMode일 때 무시)
  const onPointerDown = (e: React.PointerEvent): void => {
    if (!panMode || e.button !== 0) return
    const el = containerRef.current!
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const el = containerRef.current
    if (!el || !pan.current) return
    el.scrollLeft = pan.current.left - (e.clientX - pan.current.x)
    el.scrollTop = pan.current.top - (e.clientY - pan.current.y)
  }
  const onPointerUp = (): void => {
    pan.current = null
  }

  return (
    <div
      ref={containerRef}
      className={`viewer ${panMode ? 'pan' : ''}`}
      onScroll={updateVisible}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="viewer-canvas" style={{ height: layout.total, width: layout.width }}>
        {els}
      </div>
    </div>
  )
}
