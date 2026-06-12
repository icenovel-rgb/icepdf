import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { usePageImage } from '../lib/images'
import PageContextMenu, { type MenuPos } from './PageContextMenu'

function GridTile({
  page,
  scale,
  width,
  onMenu
}: {
  page: number
  scale: number
  width: number
  onMenu: (pos: MenuPos) => void
}): React.JSX.Element {
  const epoch = useStore((s) => s.epoch)
  const set = useStore((s) => s.set)
  const gotoPage = useStore((s) => s.gotoPage)
  const current = useStore((s) => s.currentPage === page)
  const url = usePageImage(page, scale, epoch)

  return (
    <div
      className={`grid-tile ${current ? 'current' : ''}`}
      onDoubleClick={() => {
        set({ viewMode: 'scroll' })
        gotoPage(page)
      }}
      onClick={() => set({ currentPage: page })}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu({ x: e.clientX, y: e.clientY, page })
      }}
      title="더블클릭하면 해당 페이지로 이동"
    >
      {url ? <img src={url} style={{ width }} draggable={false} alt="" /> : <div className="thumb-empty" style={{ width, height: width * 1.4 }} />}
      <span className="thumb-no">{page + 1}</span>
    </div>
  )
}

export default function GridView(): React.JSX.Element {
  const info = useStore((s) => s.info)
  const [tile, setTile] = useState(190)
  const [menu, setMenu] = useState<MenuPos | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Ctrl+휠 확대/축소 (#5)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setTile((t) => Math.max(100, Math.min(840, Math.round(t * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [info])

  if (!info) return <div />

  const maxW = Math.max(...info.pages.map((p) => p.width))
  const scale = Math.round(((tile * (window.devicePixelRatio || 1)) / maxW) * 100) / 100

  return (
    <div className="grid-view">
      <div className="grid-toolbar">
        <span>미리보기 크기</span>
        <input type="range" min={100} max={840} value={tile} onChange={(e) => setTile(Number(e.target.value))} />
        <span className="grid-hint">Ctrl+휠 확대/축소 · 더블클릭: 이동 · 우클릭: 편집</span>
      </div>
      <div ref={bodyRef} className="grid-body" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tile}px, 1fr))` }}>
        {info.pages.map((_, i) => (
          <GridTile key={i} page={i} scale={scale} width={tile} onMenu={setMenu} />
        ))}
      </div>
      {menu && <PageContextMenu pos={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
