import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'

/**
 * 페이지 렌더 파이프라인 — 자가복구 + 가시영역 우선/취소 스케줄러.
 *
 * 단일 엔진 워커는 렌더를 순차 처리하므로, 요청을 전부 워커에 쏟아붓지 않고
 * 렌더러 측 큐에 모아 (1) 보이는 페이지·현재 페이지에 가까운 것부터 (2) 동시
 * 처리 수를 제한해 디스패치한다. 화면 밖으로 사라진 페이지 요청은 디스패치 전에
 * 버린다(취소). 실패하면 즉시 몇 번 재시도하고, 그래도 안 되면 훅이 잠시 후
 * 다시 시도한다(자가복구) — Acrobat식 "보이는 것과 그려진 것을 계속 맞추는" 루프의
 * 경량 버전. 덕분에 멈춘 페이지가 새로고침 없이 스스로 복구된다.
 *
 * 이전 버그(#2): 표시 중 blob URL 즉시 revoke → 썸네일 사라짐. → 지연 revoke + 큰 캐시.
 */

const cache = new Map<string, Promise<string | null>>()
const MAX_ENTRIES = 256
const REVOKE_DELAY = 20000

/** 동시 디스패치 수 — 작게 둬야 대부분의 작업이 큐에 남아 재우선순위·취소가 가능 */
const MAX_CONCURRENT = 2
/** 큐 내부 즉시 재시도 횟수 (일시적 실패) */
const SCHED_RETRIES = 2
/** 워커가 먹통일 때 영구 정지 방지용 디스패치 타임아웃 */
const RENDER_TIMEOUT = 20000

type Resolver = (url: string | null) => void

interface Job {
  key: string
  docId: number
  page: number
  scale: number
  kind: 'page' | 'thumb'
  attempts: number
  resolve: Resolver
}

/** 현재 마운트(=화면에 필요)된 키 집합 — 여기 없으면 디스패치 전에 버린다 */
const wanted = new Set<string>()
const queue = new Map<string, Job>()
let active = 0

function scheduleRevoke(promise: Promise<string | null>): void {
  setTimeout(() => {
    promise.then((url) => url && URL.revokeObjectURL(url)).catch(() => undefined)
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

/** 작은 값 = 더 시급. 비활성 탭은 Infinity(보류), 본문이 썸네일보다 우선, 현재 페이지에 가까울수록 우선. */
function priority(j: Job): number {
  const s = useStore.getState()
  if (j.docId !== s.activeDocId) return Number.POSITIVE_INFINITY
  const base = j.kind === 'thumb' ? 10000 : 0
  return base + Math.abs(j.page - s.currentPage)
}

/** 화면 밖이 된(=wanted 아님) 큐 작업을 버린다 */
function dropStale(): void {
  for (const [k, j] of queue) {
    if (!wanted.has(k)) {
      queue.delete(k)
      cache.delete(k)
      j.resolve(null)
    }
  }
}

function pump(): void {
  dropStale()
  while (active < MAX_CONCURRENT && queue.size) {
    let best: Job | null = null
    let bestP = Number.POSITIVE_INFINITY
    for (const j of queue.values()) {
      const p = priority(j)
      if (p < bestP) {
        bestP = p
        best = j
      }
    }
    // 남은 게 전부 비활성 탭(Infinity)이면 활성 탭으로 돌아올 때까지 보류
    if (!best || bestP === Number.POSITIVE_INFINITY) break
    queue.delete(best.key)
    active++
    dispatch(best)
  }
}

function dispatch(job: Job): void {
  const render = window.icepdf.engine(job.docId, 'render', { page: job.page, scale: job.scale })
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('render timeout')), RENDER_TIMEOUT)
  )
  Promise.race([render, timeout])
    .then((r) => {
      const url = URL.createObjectURL(new Blob([r.png], { type: 'image/png' }))
      job.resolve(url)
    })
    .catch(() => {
      if (job.attempts < SCHED_RETRIES && wanted.has(job.key)) {
        job.attempts++
        queue.set(job.key, job) // 즉시 재시도 큐로
      } else {
        cache.delete(job.key) // 최종 실패 → 캐시 비워 다음 fetch가 새로 렌더
        job.resolve(null)
      }
    })
    .finally(() => {
      active--
      pump()
    })
}

export function clearImageCache(): void {
  for (const p of cache.values()) scheduleRevoke(p)
  cache.clear()
}

/** 특정 문서(docId)의 렌더 캐시·대기 작업만 비운다 — 새로고침/멈춘 페이지 강제 재렌더용 */
export function clearDocImages(docId: number): void {
  const prefix = `${docId}|`
  for (const [k, p] of cache) {
    if (k.startsWith(prefix)) {
      cache.delete(k)
      scheduleRevoke(p)
    }
  }
  for (const [k, j] of queue) {
    if (k.startsWith(prefix)) {
      queue.delete(k)
      j.resolve(null)
    }
  }
}

function fetchPageImage(
  docId: number,
  page: number,
  scale: number,
  epoch: number,
  kind: 'page' | 'thumb'
): Promise<string | null> {
  const key = `${docId}|${page}|${scale}|${epoch}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key) // LRU 갱신
    cache.set(key, hit)
    return hit
  }
  let resolve!: Resolver
  const promise = new Promise<string | null>((res) => {
    resolve = res
  })
  cache.set(key, promise)
  queue.set(key, { key, docId, page, scale, kind, attempts: 0, resolve })
  evictIfNeeded()
  pump()
  return promise
}

/**
 * 본문 페이지 렌더 배율.
 * 화면 물리픽셀(zoom×dpr)보다 SUPERSAMPLE 배 높게 뽑아 캔버스가 고품질로 줄이게 한다(SSAA).
 * mupdf의 회색조 AA 텍스트가 1:1 렌더보다 또렷해진다. 상한은 고정 배율이 아니라 페이지
 * 면적 기반 픽셀 예산(MAX_MEGAPIXELS)으로 둬서, 고DPI·고배율에서도 SSAA가 깎이지 않되
 * 단일 pixmap 메모리(worker는 한 번에 하나만 생성/파기)는 안전하게 묶는다.
 * 양자화(0.25 단위 올림)는 휠 줌 중 캐시 적중률을 위해 유지.
 */
const SUPERSAMPLE = 2
const MAX_MEGAPIXELS = 24 // A4@6x≈21MP, US-letter@6x≈17MP — 한 페이지 pixmap 상한

export function pageRenderScale(zoom: number, pageW: number, pageH: number): number {
  let s = zoom * (window.devicePixelRatio || 1) * SUPERSAMPLE
  const mp = (pageW * s * (pageH * s)) / 1e6
  if (mp > MAX_MEGAPIXELS) s *= Math.sqrt(MAX_MEGAPIXELS / mp)
  return Math.max(0.4, Math.ceil(s * 4) / 4)
}

/** 자가복구 재시도 상한 (최종 실패 후 느린 재시도) — 초과 시 새로고침에 위임 */
const OUTER_RETRIES = 6
const OUTER_RETRY_DELAY = 1500

/** 페이지 이미지 훅 — 로드 전에는 null. 실패 시 화면에 남아있는 한 스스로 재시도. */
export function usePageImage(
  docId: number,
  page: number,
  scale: number,
  epoch: number,
  enabled = true,
  kind: 'page' | 'thumb' = 'page'
): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled || !docId) {
      setUrl(null)
      return
    }
    let alive = true
    let outer = 0
    const key = `${docId}|${page}|${scale}|${epoch}`
    wanted.add(key)

    const attempt = (): void => {
      fetchPageImage(docId, page, scale, epoch, kind).then((u) => {
        if (!alive) return
        if (u) {
          setUrl(u)
        } else if (outer < OUTER_RETRIES && wanted.has(key)) {
          // 최종 실패했지만 아직 화면에 필요 → 잠시 후 새로 렌더 (자가복구)
          outer++
          timer.current = setTimeout(() => {
            if (alive) {
              cache.delete(key)
              attempt()
            }
          }, OUTER_RETRY_DELAY)
        }
      })
    }
    attempt()

    return () => {
      alive = false
      if (timer.current) clearTimeout(timer.current)
      wanted.delete(key)
      pump() // 화면 밖이 된 대기 작업 즉시 취소
    }
  }, [docId, page, scale, epoch, enabled, kind])

  return url
}
