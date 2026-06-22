import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import Icon from './Icon'
import {
  ORIENTATION_OPTIONS,
  PER_SHEET_OPTIONS,
  PRINT_SCALE,
  buildPrintHtml,
  chunkSheets,
  gridFor,
  isLandscapePage,
  parsePageSpec,
  renderPagesForPrint,
  type Orientation,
  type PerSheet,
  type RenderedPage
} from '../lib/print'

/** 인쇄 미리보기 모달 — 좌측 설정 패널 + 우측 큰 미리보기. 모아찍기(1·2·4·6·8쪽)·용지 방향·범위 */
export default function PrintModal(): React.JSX.Element | null {
  const show = useStore((s) => s.showPrint)
  const info = useStore((s) => s.info)
  const set = useStore((s) => s.set)

  const [perSheet, setPerSheet] = useState<PerSheet>(1)
  const [orientation, setOrientation] = useState<Orientation>('portrait')
  const [rangeSpec, setRangeSpec] = useState('')
  const [rendered, setRendered] = useState<RenderedPage[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [printing, setPrinting] = useState(false)

  const close = (): void => set({ showPrint: false })

  // 범위 사양으로 페이지를 렌더해 미리보기 생성 (perSheet/방향 변경은 재렌더 불필요 — 레이아웃만)
  const buildPreview = async (spec: string): Promise<void> => {
    if (!info) return
    const pages = parsePageSpec(spec, info.pageCount)
    if (!pages.length) {
      setRendered([])
      useStore.getState().showToast('유효한 페이지 범위가 아닙니다 (예: 1-5,8)')
      return
    }
    setProgress({ done: 0, total: pages.length })
    try {
      const result = await renderPagesForPrint(pages, PRINT_SCALE, (done, total) =>
        setProgress({ done, total })
      )
      setRendered(result)
    } catch (err) {
      setRendered([])
      useStore.getState().showToast(`미리보기 생성 실패: ${err instanceof Error ? err.message : err}`)
    } finally {
      setProgress(null)
    }
  }

  // 모달 열릴 때 전체 페이지로 미리보기 생성, 닫힐 때 상태 초기화
  useEffect(() => {
    if (!show) {
      setRendered(null)
      setRangeSpec('')
      setPerSheet(1)
      setOrientation('portrait')
      setProgress(null)
      return
    }
    void buildPreview('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, info])

  // Esc로 닫기
  useEffect(() => {
    if (!show) return
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !printing) close()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, printing])

  if (!show) return null

  const doPrint = async (): Promise<void> => {
    if (!rendered?.length) return
    setPrinting(true)
    try {
      await window.icepdf.printHtml(buildPrintHtml(rendered, perSheet, orientation))
    } catch (err) {
      useStore.getState().showToast(`인쇄 실패: ${err instanceof Error ? err.message : err}`)
    } finally {
      setPrinting(false)
    }
  }

  const single = perSheet === 1
  const { rows, cols } = gridFor(perSheet, orientation)
  const sheets = rendered ? chunkSheets(rendered, perSheet) : []
  const busy = progress !== null

  // 미리보기 시트 1장의 종횡비/격자 — 1쪽은 페이지 방향 자동(여백 없이 꽉), 모아찍기는 용지 방향
  const sheetView = (sheet: RenderedPage[]): { aspect: string; cols: number; rows: number } => {
    const land = single ? isLandscapePage(sheet[0]) : orientation === 'landscape'
    return {
      aspect: land ? '297 / 210' : '210 / 297',
      cols: single ? 1 : cols,
      rows: single ? 1 : rows
    }
  }

  const sheetCount = rendered ? Math.ceil(rendered.length / perSheet) : 0

  return (
    <div className="modal-backdrop" onMouseDown={() => !printing && close()}>
      <div className="print-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={close} title="닫기">
          <Icon name="x" size={16} />
        </button>

        {/* 좌측 설정 패널 */}
        <aside className="print-side">
          <div className="print-title">
            <Icon name="printer" size={20} /> 인쇄
          </div>

          <label className="print-field">
            모아찍기
            <select
              className="print-nup"
              value={perSheet}
              onChange={(e) => setPerSheet(Number(e.target.value) as PerSheet)}
            >
              {PER_SHEET_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1쪽 (일반)' : `한 장에 ${n}쪽`}
                </option>
              ))}
            </select>
          </label>

          <label className="print-field">
            용지 방향
            <select
              className="print-orient"
              value={orientation}
              disabled={single}
              title={single ? '1쪽 인쇄는 페이지 방향에 자동으로 맞춰집니다' : '모아찍기 용지 방향'}
              onChange={(e) => setOrientation(e.target.value as Orientation)}
            >
              {single ? (
                <option value={orientation}>자동 (페이지에 맞춤)</option>
              ) : (
                ORIENTATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="print-field">
            페이지
            <input
              className="print-range"
              placeholder="전체 (예: 1-5,8)"
              value={rangeSpec}
              onChange={(e) => setRangeSpec(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void buildPreview(rangeSpec)
              }}
            />
          </label>

          <button className="print-apply" disabled={busy} onClick={() => void buildPreview(rangeSpec)}>
            미리보기 갱신
          </button>

          {rendered && !busy && (
            <div className="print-meta">
              {rendered.length}쪽 · {sheetCount}장 출력
            </div>
          )}

          <div className="print-side-flex" />

          <div className="print-actions">
            <button className="print-cancel" disabled={printing} onClick={close}>
              취소
            </button>
            <button
              className="print-go"
              disabled={busy || printing || !rendered?.length}
              onClick={() => void doPrint()}
            >
              {printing ? '인쇄 준비 중...' : '인쇄'}
            </button>
          </div>
        </aside>

        {/* 우측 미리보기 */}
        <div className="print-preview">
          {busy && (
            <div className="print-status">
              미리보기 생성 중... {progress?.done}/{progress?.total}쪽
            </div>
          )}
          {!busy && rendered && rendered.length === 0 && (
            <div className="print-status">표시할 페이지가 없습니다.</div>
          )}
          {!busy &&
            sheets.map((sheet, i) => {
              const v = sheetView(sheet)
              return (
                <div
                  key={i}
                  className={`print-sheet${single ? ' single' : ''}`}
                  style={{
                    aspectRatio: v.aspect,
                    gridTemplateColumns: `repeat(${v.cols}, 1fr)`,
                    gridTemplateRows: `repeat(${v.rows}, 1fr)`
                  }}
                >
                  {sheet.map((p) => (
                    <div className="print-cell" key={p.page}>
                      <img src={p.src} alt={`${p.page + 1}쪽`} />
                    </div>
                  ))}
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
