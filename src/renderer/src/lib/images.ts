import { useEffect, useState } from 'react'

/**
 * 페이지 PNG Blob URL 캐시.
 * 이전 버그(#2): 표시 중인 blob URL을 LRU 축출하며 즉시 revoke → 1~29p 썸네일이 사라짐.
 * 수정: 캐시 용량을 키우고, 축출 시 즉시 revoke하지 않고 지연 revoke한다.
 *        + 썸네일 패널 가상화로 동시 마운트 수를 낮춘다.
 */
const cache = new Map<string, Promise<string>>()
const MAX_ENTRIES = 256
const REVOKE_DELAY = 20000

function scheduleRevoke(promise: Promise<string>): void {
  setTimeout(() => {
    promise.then((url) => URL.revokeObjectURL(url)).catch(() => undefined)
  }, REVOKE_DELAY)
}

function evictIfNeeded(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    const p = cache.get(oldest)!
    cache.delete(oldest)
    scheduleRevoke(p)
  }
}

export function clearImageCache(): void {
  for (const p of cache.values()) scheduleRevoke(p)
  cache.clear()
}

function fetchPageImage(page: number, scale: number, epoch: number): Promise<string> {
  const key = `${page}|${scale}|${epoch}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key) // LRU 갱신
    cache.set(key, hit)
    return hit
  }
  const promise = window.icepdf
    .engine('render', { page, scale })
    .then((r) => URL.createObjectURL(new Blob([r.png], { type: 'image/png' })))
  cache.set(key, promise)
  promise.catch(() => cache.delete(key))
  evictIfNeeded()
  return promise
}

/** 렌더 배율 양자화 — 캐시 적중률을 위해 0.25 단위로 올림, [0.4, 4] 클램프 */
export function quantizeScale(zoom: number): number {
  const target = zoom * (window.devicePixelRatio || 1)
  return Math.min(4, Math.max(0.4, Math.ceil(target * 4) / 4))
}

/** 페이지 이미지 훅 — 로드 전에는 null */
export function usePageImage(page: number, scale: number, epoch: number, enabled = true): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) {
      setUrl(null)
      return
    }
    let alive = true
    fetchPageImage(page, scale, epoch)
      .then((u) => {
        if (alive) setUrl(u)
      })
      .catch((err) => console.error('페이지 렌더 실패:', err))
    return () => {
      alive = false
    }
  }, [page, scale, epoch, enabled])
  return url
}
