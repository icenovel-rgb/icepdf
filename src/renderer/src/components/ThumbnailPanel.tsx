import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { usePageImage } from '../lib/images'
import PageContextMenu, { type MenuPos } from './PageContextMenu'

const VGAP = 12
const LABEL_H = 0

function Thumb({
  page,
  thumbW,
  scale,
  height,
  onMenu
}: {
  page: number
  thumbW: number
  scale: number
  height: number
  onMenu: (pos: MenuPos) => void
}): React.JSX.Element {
  const epoch = useStore((s) => s.epoch)
  const activeDocId = useStore((s) => s.activeDocId)
  const current = useStore((s) => s.currentPage === page)
  const gotoPage = useStore((s) => s.gotoPage)
  const url = usePageImage(activeDocId, page, scale, epoch, true, 'thumb')

  return (
    <div
      className={`thumb ${current ? 'current' : ''}`}
      style={{ height }}
      onClick={() => gotoPage(page)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu({ x: e.clientX, y: e.clientY, page })
      }}
    >
      {url ? <img src={url} width={thumbW} draggable={false} alt="" /> : <div className="thumb-empty" style={{ width: thumbW, height: height - LABEL_H }} />}
      <span className="thumb-no">{page + 1}</span>
    </div>
  )
}

export default function ThumbnailPanel(): React.JSX.Element {
  const info = useStore((s) => s.info)
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const currentPage = useStore((s) => s.currentPage)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  const [menu, setMenu] = useState<MenuPos | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setViewH(el.clientHeight)
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 현재 페이지가 바뀌면 해당 썸네일로 스크롤
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !info) return
    const rowH = rowHeight()
    const y = 10 + currentPage * (rowH + VGAP)
    if (y < el.scrollTop || y + rowH > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: y - el.clientHeight / 2 + rowH / 2 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, info, sidebarWidth])

  if (!info) return <div className="thumb-panel-scroll" ref={scrollRef} />

  const thumbW = Math.max(80, sidebarWidth - 36)
  const maxW = Math.max(...info.pages.map((p) => p.width))
  const scale = Math.round(((thumbW * (window.devicePixelRatio || 1)) / maxW) * 100) / 100

  function rowHeight(): number {
    // 평균 종횡비로 단순화 (페이지마다 다르면 약간 어긋날 수 있으나 가상화 추정용)
    const ratio = info!.pages[0].height / info!.pages[0].width
    return thumbW * ratio
  }
  const rowH = rowHeight()
  const stride = rowH + VGAP
  const total = 10 + info.pageCount * stride

  const first = Math.max(0, Math.floor((scrollTop - 10) / stride) - 2)
  const visibleCount = Math.ceil(viewH / stride) + 4
  const last = Math.min(info.pageCount - 1, first + visibleCount)

  const items: React.JSX.Element[] = []
  for (let i = first; i <= last; i++) {
    items.push(
      <div key={i} className="thumb-slot" style={{ top: 10 + i * stride }}>
        <Thumb page={i} thumbW={thumbW} scale={scale} height={rowH} onMenu={setMenu} />
      </div>
    )
  }

  return (
    <div className="thumb-panel-scroll" ref={scrollRef} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
      <div className="thumb-virtual" style={{ height: total }}>
        {items}
      </div>
      {menu && <PageContextMenu pos={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
