import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import PageView from './PageView'

/** 슬라이드 보기 — 한 페이지씩, 휠/방향키로 이동. 도구는 PageView가 그대로 지원 (#VII, #g) */
export default function SlideView(): React.JSX.Element {
  const info = useStore((s) => s.info)
  const currentPage = useStore((s) => s.currentPage)
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const wheelLock = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) return
      e.preventDefault()
      if (wheelLock.current) return
      wheelLock.current = true
      setTimeout(() => (wheelLock.current = false), 220)
      const s = useStore.getState()
      s.gotoPage(s.currentPage + (e.deltaY > 0 ? 1 : -1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [info])

  if (!info) return <div />
  const page = info.pages[currentPage] ?? info.pages[0]
  const pad = 48
  const scale = Math.min((box.w - pad) / page.width, (box.h - pad) / page.height)

  return (
    <div ref={ref} className="slide-view">
      <PageView key={currentPage} page={currentPage} visible scale={Math.max(0.1, scale)} />
    </div>
  )
}
