/**
 * 새 버전 알림 — 버전 비교와 GitHub "최신 릴리스" 응답 검증.
 * 앱은 실행 시 GitHub Releases(공지 게시판)에서 최신 버전을 읽어 지금 버전과 비교한다.
 */

export const RELEASE_REPO = 'icenovel-rgb/icepdf'
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`
/** 알림의 "다운로드"가 열 수 있는 주소 — 이 저장소의 릴리스 페이지로만 제한(엉뚱한 링크 차단) */
export const RELEASES_PAGE_PREFIX = `https://github.com/${RELEASE_REPO}/releases/`

export interface LatestRelease {
  /** v 접두사 뗀 버전 (예: 1.9.0) */
  version: string
  /** 릴리스 페이지 주소 */
  url: string
}

export type UpdateCheckResult =
  | { status: 'available'; current: string; latest: LatestRelease }
  | { status: 'latest'; current: string }
  | { status: 'skipped'; current: string }
  | { status: 'error'; current: string; message: string }

/** '1.9.0' / 'v1.9.0' / '1.9.0-beta.1' → [1, 9, 0]. 형식이 아니면 null */
function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)(?:[-+].*)?$/.exec(v.trim())
  return m ? m[1].split('.').map(Number) : null
}

/** a<b → 음수, 같으면 0, a>b → 양수 (형식 오류는 0). 사전 릴리스 꼬리표는 무시 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}

/** GitHub /releases/latest 응답 → 검증된 최신 릴리스. 초안·사전 릴리스·다른 저장소 주소는 거부 */
export function parseLatestRelease(json: unknown): LatestRelease | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (typeof r.tag_name !== 'string' || typeof r.html_url !== 'string') return null
  if (r.draft === true || r.prerelease === true) return null
  if (!r.html_url.startsWith(RELEASES_PAGE_PREFIX)) return null
  if (!parseVersion(r.tag_name)) return null
  return { version: r.tag_name.replace(/^v/, ''), url: r.html_url }
}
