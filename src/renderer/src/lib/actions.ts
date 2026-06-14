/** 문서 단위 액션 — 엔진 호출 + 스토어 갱신을 묶는다 */
import { useStore, type SelectedImage } from '../state/store'
import { clearDocImages } from './images'
import { eng } from './engine'
import { transformPng, imageNaturalSize, rotatedBBox } from './imgxform'
import { renderTextToPng, type TextStyle } from './textrender'
import {
  clearSessionImages,
  getSessionImage,
  registerSessionImage
} from './session-images'
import type { BookmarkItem, DocInfo, Rect } from '../../../shared/types'

const api = (): typeof window.icepdf => window.icepdf
const store = (): ReturnType<typeof useStore.getState> => useStore.getState()

/** 페이지 이미지에 영향 없는 편집(주석 변형 등) 후 갱신 — selectedImage 유지 */
function touch(): void {
  const s = store()
  s.set({ dirty: true, epoch: s.epoch + 1 })
  void syncUndoState()
}

/** 엔진 저널의 되돌리기/다시하기 가능 상태를 스토어에 반영 — 모든 편집·undo·redo 후 호출 */
export async function syncUndoState(): Promise<void> {
  try {
    const st = await eng('undoState', {})
    store().set({ canUndo: st.canUndo, canRedo: st.canRedo })
  } catch {
    /* 무시 */
  }
}

/** undo/redo 공통 마무리 — 주석 인덱스가 바뀌므로 선택·세션이미지·렌더 캐시를 비우고 재렌더 */
function afterUndoRedo(r: { info: DocInfo; canUndo: boolean; canRedo: boolean }): void {
  const s = store()
  clearSessionImages(s.activeDocId)
  clearDocImages(s.activeDocId)
  s.set({
    info: r.info,
    dirty: true,
    canUndo: r.canUndo,
    canRedo: r.canRedo,
    selectedImage: null,
    selection: null,
    ocrLayers: {},
    epoch: s.epoch + 1,
    currentPage: Math.min(s.currentPage, r.info.pageCount - 1)
  })
}

export async function undo(): Promise<void> {
  const s = store()
  if (!s.info) return
  try {
    afterUndoRedo(await eng('undo', {}))
  } catch (err) {
    s.showToast(`되돌리기 실패: ${err instanceof Error ? err.message : err}`)
  }
}

export async function redo(): Promise<void> {
  const s = store()
  if (!s.info) return
  try {
    afterUndoRedo(await eng('redo', {}))
  } catch (err) {
    s.showToast(`다시하기 실패: ${err instanceof Error ? err.message : err}`)
  }
}

/** PDF를 새 탭으로 연다 (윈도우 탐색기 탭처럼 — 기존 탭은 유지). */
export async function openFile(path?: string): Promise<void> {
  const target = path ?? (await api().openPdfDialog())
  if (!target) return
  const s = store()
  s.set({ busy: '문서 여는 중...' })
  try {
    const { docId, info } = await api().openDoc(target)
    s.openTab(docId, info)
  } catch (err) {
    s.showToast(`열기 실패: ${err instanceof Error ? err.message : err}`)
  } finally {
    store().set({ busy: null })
  }
}

/**
 * 새로고침 — 활성 문서의 렌더 캐시를 비우고 epoch를 올려 보이는 페이지를 강제 재렌더.
 * 렌더 요청이 실패/적체돼 페이지가 공백으로 멈췄을 때 복구용 (F5 / Ctrl+R / 툴바).
 */
export function refreshPages(): void {
  const s = store()
  if (!s.info) return
  clearDocImages(s.activeDocId)
  s.set({ epoch: s.epoch + 1 })
  s.showToast('페이지를 새로 불러왔습니다')
}

/** 탭 닫기 — 활성 탭에 저장 안 한 변경이 있으면 확인 후 엔진 문서 해제. */
export async function closeTabById(tabId: number): Promise<void> {
  const s = store()
  const tab = s.tabs.find((t) => t.id === tabId)
  if (!tab) return
  const isActive = s.activeTabId === tabId
  const isDirty = isActive ? s.dirty : tab.snapshot.dirty
  if (isDirty) {
    const ok = await api().confirm(
      '저장하지 않은 변경이 있습니다',
      '저장하지 않고 이 탭을 닫으시겠습니까?'
    )
    if (!ok) return
  }
  void api().closeDoc(tab.docId)
  store().removeTab(tabId)
}

export async function saveFile(forceAsk = false): Promise<void> {
  const s = store()
  if (!s.info) return
  let path = s.info.filePath
  if (forceAsk || !path) {
    path = await api().saveFileDialog({
      title: 'PDF 저장',
      defaultPath: s.info.filePath ?? '문서.pdf',
      ext: 'pdf',
      extName: 'PDF 문서'
    })
    if (!path) return
  }
  s.set({ busy: '저장 중...' })
  try {
    await eng('save', { path })
    const info = await eng('docInfo', {})
    s.set({ info, dirty: false })
    s.showToast('저장되었습니다')
  } catch (err) {
    s.showToast(`저장 실패: ${err instanceof Error ? err.message : err}`)
  } finally {
    store().set({ busy: null })
  }
}

/**
 * 모든 탭의 저장 안 한 변경을 저장한다 (창 닫기 전 "저장" 선택 시).
 * 경로가 없는 문서는 저장 위치를 묻고, 사용자가 취소하면 false 를 반환(닫기 중단).
 */
export async function saveAllDirty(): Promise<boolean> {
  const s = store()
  if (s.activeTabId == null) return true
  // s.tabs 는 시작 시점 스냅샷 — 활성 탭의 dirty/info 는 라이브 스토어가 진실
  for (const t of s.tabs) {
    const isActive = t.id === store().activeTabId
    const dirty = isActive ? store().dirty : t.snapshot.dirty
    if (!dirty) continue
    const info = isActive ? store().info : t.snapshot.info
    if (!info) continue
    let path = info.filePath
    if (!path) {
      path = await api().saveFileDialog({
        title: 'PDF 저장',
        defaultPath: `${(info.title || '문서').replace(/\.pdf$/i, '')}.pdf`,
        ext: 'pdf',
        extName: 'PDF 문서'
      })
      if (!path) return false // 사용자가 저장 위치 선택 취소 → 닫기 중단
    }
    s.set({ busy: `저장 중... (${info.title})` })
    await api().engine(t.docId, 'save', { path })
    const newInfo = await api().engine(t.docId, 'docInfo', {})
    if (isActive) {
      store().set({ info: newInfo, dirty: false })
    } else {
      store().set({
        tabs: store().tabs.map((x) =>
          x.id === t.id ? { ...x, snapshot: { ...x.snapshot, info: newInfo, dirty: false } } : x
        )
      })
    }
  }
  store().set({ busy: null })
  return true
}

/** 창 닫기 다이얼로그에서 "저장"을 누르면 호출 — 전부 저장 후 메인에 닫기 확정을 알린다. */
export async function saveAllAndClose(): Promise<void> {
  try {
    const ok = await saveAllDirty()
    if (ok) await api().confirmClose()
  } catch (err) {
    store().set({ busy: null })
    store().showToast(`저장 실패로 닫기를 중단했습니다: ${err instanceof Error ? err.message : err}`)
  }
}

export async function exportDoc(mode: 'markdown' | 'hwpx'): Promise<void> {
  const s = store()
  if (!s.info) return
  // 한글 내보내기 안내 (레이아웃 미보존)
  if (mode === 'hwpx') {
    const ok = await api().confirm(
      '한글 문서로 내보내기 안내',
      '이미지와 텍스트를 순서대로 추출하는 방식이라 원본 PDF의 레이아웃(정확한 위치)은 그대로 유지되지 않습니다.\n표·이미지·본문은 포함되지만 배치는 한글 문서 흐름에 맞게 재구성됩니다.\n\n계속하시겠습니까?'
    )
    if (!ok) return
  }
  const base = (s.info.title || '문서').replace(/\.pdf$/i, '')
  const ext = mode === 'markdown' ? 'md' : 'hwpx'
  const outPath = await api().saveFileDialog({
    title: mode === 'markdown' ? 'Markdown으로 내보내기' : '한글 문서(HWPX)로 내보내기',
    defaultPath: `${base}.${ext}`,
    ext,
    extName: mode === 'markdown' ? 'Markdown' : '한글 문서'
  })
  if (!outPath) return
  s.set({ busy: mode === 'markdown' ? 'Markdown 변환 중...' : 'HWPX 변환 중 (텍스트+이미지, 시간이 걸릴 수 있음)...' })
  try {
    const result = await api().convert(store().activeDocId, mode, outPath)
    const extra = result.imageCount ? ` (이미지 ${result.imageCount}개)` : ''
    const warn = result.warnings?.length ? ` · 경고 ${result.warnings.length}건` : ''
    s.showToast(`내보내기 완료: ${result.outPath}${extra}${warn}`)
    if (result.warnings?.length) console.warn('변환 경고:', result.warnings)
  } catch (err) {
    s.showToast(`변환 실패: ${err instanceof Error ? err.message : err}`)
  } finally {
    store().set({ busy: null })
  }
}

/** 각 페이지를 PNG로 폴더에 내보내기 (#I) */
export async function exportImagesToFolder(): Promise<void> {
  const s = store()
  if (!s.info) return
  const folder = await api().chooseFolder('이미지를 저장할 폴더 선택')
  if (!folder) return
  s.set({ busy: '페이지를 이미지로 내보내는 중...' })
  try {
    const result = await api().convert(store().activeDocId, 'images', folder)
    s.showToast(`이미지 ${result.imageCount}장을 저장했습니다: ${result.outPath}`)
  } catch (err) {
    s.showToast(`이미지 내보내기 실패: ${err instanceof Error ? err.message : err}`)
  } finally {
    store().set({ busy: null })
  }
}

/** Del 키: 선택 이미지가 있으면 삭제, 없으면 현재 페이지 삭제 (#V) */
export async function deleteSelectedOrPage(): Promise<void> {
  const s = store()
  if (!s.info) return
  const sel = s.selectedImage
  if (sel) {
    try {
      await eng('deleteAnnot', { page: sel.page, index: sel.index })
      s.set({ selectedImage: null })
      s.applyEdit(await eng('docInfo', {}))
      void syncUndoState()
      s.showToast('삽입한 개체를 삭제했습니다')
    } catch (err) {
      s.showToast(`삭제 실패: ${err instanceof Error ? err.message : err}`)
    }
    return
  }
  await deletePageAt(s.currentPage)
}

export async function deletePageAt(page: number): Promise<void> {
  const s = store()
  if (!s.info) return
  const ok = await api().confirm(`${page + 1}쪽을 삭제할까요?`, '이 작업은 저장 전까지 되돌릴 수 없습니다.')
  if (!ok) return
  try {
    s.applyEdit(await eng('deletePage', { page }))
    clearSessionImages(store().activeDocId)
    store().set({ ocrLayers: {} })
    void syncUndoState()
  } catch (err) {
    s.showToast(`삭제 실패: ${err instanceof Error ? err.message : err}`)
  }
}

export async function insertBlankAt(at: number): Promise<void> {
  const s = store()
  if (!s.info) return
  try {
    s.applyEdit(await eng('insertBlank', { at }))
    clearSessionImages(store().activeDocId)
    store().set({ ocrLayers: {} })
    void syncUndoState()
  } catch (err) {
    s.showToast(`삽입 실패: ${err instanceof Error ? err.message : err}`)
  }
}

export async function insertFromPdfAt(at: number): Promise<void> {
  const s = store()
  if (!s.info) return
  const path = await api().openPdfDialog()
  if (!path) return
  s.set({ busy: 'PDF 페이지 삽입 중...' })
  try {
    s.applyEdit(await eng('insertFromPdf', { at, path }))
    clearSessionImages(store().activeDocId)
    store().set({ ocrLayers: {} })
    void syncUndoState()
    s.showToast('페이지를 삽입했습니다')
  } catch (err) {
    s.showToast(`삽입 실패: ${err instanceof Error ? err.message : err}`)
  } finally {
    store().set({ busy: null })
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export async function highlightSelection(): Promise<void> {
  const s = store()
  if (!s.selection || !s.selection.quads.length) return
  try {
    await eng('addHighlight', {
      page: s.selection.page,
      quads: s.selection.quads,
      color: hexToRgb(s.highlightColor),
      opacity: 0.45
    })
    s.applyEdit(await eng('docInfo', {}))
    void syncUndoState()
  } catch (err) {
    s.showToast(`형광펜 실패: ${err instanceof Error ? err.message : err}`)
  }
}

/** 지우개: 클릭 위치의 형광펜/주석 삭제 (#7) */
export async function eraseAt(page: number, x: number, y: number): Promise<boolean> {
  const s = store()
  if (!s.info) return false
  try {
    const hit = await eng('hitAnnot', { page, x, y, types: ['Square', 'Highlight', 'Stamp'] })
    if (!hit) return false
    await eng('deleteAnnot', { page, index: hit.index })
    s.applyEdit(await eng('docInfo', {}))
    void syncUndoState()
    return true
  } catch (err) {
    s.showToast(`지우기 실패: ${err instanceof Error ? err.message : err}`)
    return false
  }
}

export async function armImageTool(): Promise<void> {
  const s = store()
  if (!s.info) return
  const img = await api().openImageDialog()
  if (!img) return
  const { width, height } = await imageNaturalSize(img.data)
  s.set({
    tool: 'image',
    pendingImage: { ...img, naturalW: width, naturalH: height },
    selectedImage: null
  })
  s.showToast('페이지 위에 드래그하여 이미지를 배치하세요 (원본 비율 유지, ESC 취소)')
}

/** 중심·크기·회전으로부터 축정렬 바운딩박스 rect 산출 */
export function deriveImageRect(sel: {
  cx: number
  cy: number
  w0: number
  h0: number
  rotation: number
}): Rect {
  const { W, H } = rotatedBBox(sel.w0, sel.h0, sel.rotation)
  return [sel.cx - W / 2, sel.cy - H / 2, sel.cx + W / 2, sel.cy + H / 2]
}

function imageNeedsRerender(sel: SelectedImage): boolean {
  return sel.rotation !== 0 || sel.flipH || sel.flipV
}

/** 새 이미지 배치 → 선택 상태로 전환해 즉시 편집 가능 (#8, #9) */
export async function placeImage(page: number, rect: Rect): Promise<void> {
  const s = store()
  const pending = s.pendingImage
  if (!pending) return
  try {
    const { index } = await eng('addImage', { page, rect, png: pending.data.slice(0) })
    const sel: SelectedImage = {
      page,
      index,
      origData: pending.data,
      naturalW: pending.naturalW,
      naturalH: pending.naturalH,
      cx: (rect[0] + rect[2]) / 2,
      cy: (rect[1] + rect[3]) / 2,
      w0: rect[2] - rect[0],
      h0: rect[3] - rect[1],
      rotation: 0,
      flipH: false,
      flipV: false,
      rect
    }
    registerSessionImage(store().activeDocId, sel)
    s.set({ tool: 'select', pendingImage: null, selectedImage: sel, dirty: true, epoch: s.epoch + 1 })
    void syncUndoState()
  } catch (err) {
    s.showToast(`이미지 삽입 실패: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * 텍스트 추가 — 입력한 글자를 PNG로 렌더해 Stamp 주석으로 삽입하고
 * 즉시 선택 상태(이동/크기조절 가능)로 만든다. (한글 지원 위해 이미지 방식)
 */
export async function placeText(page: number, x: number, y: number, text: string, style: TextStyle): Promise<void> {
  const s = store()
  if (!s.info || !text.trim()) return
  try {
    const { png, widthPt, heightPt } = await renderTextToPng(text, style)
    const pageInfo = s.info.pages[page]
    // 페이지 밖으로 넘치지 않게 시작점 보정
    const x0 = pageInfo ? Math.max(0, Math.min(x, pageInfo.width - widthPt)) : x
    const y0 = pageInfo ? Math.max(0, Math.min(y, pageInfo.height - heightPt)) : y
    const rect: Rect = [x0, y0, x0 + widthPt, y0 + heightPt]
    const { index } = await eng('addImage', { page, rect, png: png.slice(0) })
    const { width, height } = await imageNaturalSize(png)
    const sel: SelectedImage = {
      page,
      index,
      origData: png,
      naturalW: width,
      naturalH: height,
      cx: (rect[0] + rect[2]) / 2,
      cy: (rect[1] + rect[3]) / 2,
      w0: widthPt,
      h0: heightPt,
      rotation: 0,
      flipH: false,
      flipV: false,
      rect,
      text: { content: text, font: style.font, size: style.size, color: style.color }
    }
    registerSessionImage(store().activeDocId, sel)
    s.set({ tool: 'select', selectedImage: sel, selection: null, dirty: true, epoch: s.epoch + 1 })
    void syncUndoState()
  } catch (err) {
    s.showToast(`텍스트 추가 실패: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * 선택된 텍스트 주석을 새 내용/스타일로 다시 렌더해 교체한다 (좌상단 고정).
 * 폰트·크기·색상·내용 수정과 비례 크기조절이 모두 이 경로를 쓴다 → Stamp 이미지를
 * 늘리지 않고 텍스트를 새로 그리므로 글자가 변형되지 않는다.
 */
export async function rerenderText(
  sel: SelectedImage,
  next: { content: string; font: string; size: number; color: string }
): Promise<void> {
  const s = store()
  if (!sel.text) return
  try {
    const { png, widthPt, heightPt } = await renderTextToPng(next.content, {
      font: next.font,
      size: next.size,
      color: next.color
    })
    const x0 = sel.rect[0]
    const y0 = sel.rect[1]
    const rect: Rect = [x0, y0, x0 + widthPt, y0 + heightPt]
    await eng('updateStamp', { page: sel.page, index: sel.index, rect, png: png.slice(0) })
    const { width, height } = await imageNaturalSize(png)
    const updated: SelectedImage = {
      ...sel,
      origData: png,
      naturalW: width,
      naturalH: height,
      cx: (rect[0] + rect[2]) / 2,
      cy: (rect[1] + rect[3]) / 2,
      w0: widthPt,
      h0: heightPt,
      rotation: 0,
      flipH: false,
      flipV: false,
      rect,
      text: { ...next }
    }
    registerSessionImage(store().activeDocId, updated)
    s.set({ selectedImage: updated, dirty: true, epoch: s.epoch + 1 })
    void syncUndoState()
  } catch (err) {
    s.showToast(`텍스트 수정 실패: ${err instanceof Error ? err.message : err}`)
  }
}

/** 선택된 텍스트의 폰트/크기/색상 변경 (툴바에서) — 즉시 재렌더 */
export async function updateSelectedTextStyle(patch: Partial<{ font: string; size: number; color: string }>): Promise<void> {
  const sel = store().selectedImage
  if (!sel?.text) return
  await rerenderText(sel, { ...sel.text, ...patch })
}

/** 텍스트 비례 크기조절 — 드래그한 박스 배율(scale)만큼 폰트 크기를 키워 다시 렌더 */
export async function applyTextResize(scale: number): Promise<void> {
  const sel = store().selectedImage
  if (!sel?.text) return
  const size = Math.max(6, Math.min(400, Math.round(sel.text.size * scale)))
  if (size === sel.text.size) {
    // 크기 변화 없음 — 드래그로 어긋난 오버레이만 원위치
    store().set({ selectedImage: { ...sel, w0: sel.rect[2] - sel.rect[0], h0: sel.rect[3] - sel.rect[1] } })
    return
  }
  await rerenderText(sel, { ...sel.text, size })
}

/** 드래그 중 라이브 갱신 (엔진 호출 없이 오버레이만) */
export function updateSelectedImageLocal(patch: Partial<SelectedImage>): void {
  const s = store()
  const sel = s.selectedImage
  if (!sel) return
  const next = { ...sel, ...patch }
  next.rect = deriveImageRect(next)
  s.set({ selectedImage: next })
}

/** 변형 확정 — 엔진에 반영 (#9). kind에 따라 rect만 변경 또는 PNG 재생성 */
export async function commitImageTransform(kind: 'move' | 'resize' | 'rotate' | 'flip'): Promise<void> {
  const s = store()
  const sel = s.selectedImage
  if (!sel) return
  registerSessionImage(store().activeDocId, sel)
  const rerender =
    kind === 'rotate' || kind === 'flip' || (kind === 'resize' && imageNeedsRerender(sel))
  try {
    if (rerender && sel.origData.byteLength > 0) {
      const png = await transformPng(sel.origData, sel.rotation, sel.flipH, sel.flipV, sel.w0, sel.h0)
      await eng('updateStamp', { page: sel.page, index: sel.index, rect: sel.rect, png })
    } else {
      await eng('setAnnotRect', { page: sel.page, index: sel.index, rect: sel.rect })
    }
    touch()
  } catch (err) {
    s.showToast(`이미지 변형 실패: ${err instanceof Error ? err.message : err}`)
  }
}

/** 툴바 버튼: 90° 회전 */
export async function rotateImageBy(deg: 90 | -90): Promise<void> {
  const s = store()
  const sel = s.selectedImage
  if (!sel) return
  const rotation = sel.rotation + deg
  updateSelectedImageLocal({ rotation })
  await commitImageTransform('rotate')
}

/** 툴바 버튼: 반전 */
export async function flipImage(axis: 'h' | 'v'): Promise<void> {
  const s = store()
  const sel = s.selectedImage
  if (!sel) return
  updateSelectedImageLocal(axis === 'h' ? { flipH: !sel.flipH } : { flipV: !sel.flipV })
  await commitImageTransform('flip')
}

/** 클릭 위치의 삽입 이미지(Stamp) 선택 (#9) — 세션 레지스트리에서 원본 복원 */
export async function selectImageAt(page: number, x: number, y: number): Promise<boolean> {
  const s = store()
  if (!s.info) return false
  try {
    const hit = await eng('hitAnnot', { page, x, y, types: ['Stamp'] })
    if (!hit) return false
    const saved = getSessionImage(store().activeDocId, page, hit.index)
    const cx = (hit.rect[0] + hit.rect[2]) / 2
    const cy = (hit.rect[1] + hit.rect[3]) / 2
    const sel: SelectedImage = saved
      ? { ...saved, page, index: hit.index, cx, cy, rect: hit.rect }
      : {
          page,
          index: hit.index,
          origData: new ArrayBuffer(0),
          naturalW: hit.rect[2] - hit.rect[0],
          naturalH: hit.rect[3] - hit.rect[1],
          cx,
          cy,
          w0: hit.rect[2] - hit.rect[0],
          h0: hit.rect[3] - hit.rect[1],
          rotation: 0,
          flipH: false,
          flipV: false,
          rect: hit.rect
        }
    sel.rect = deriveImageRect(sel)
    s.set({ selectedImage: sel, selection: null })
    return true
  } catch {
    return false
  }
}

export function deselectImage(): void {
  store().set({ selectedImage: null })
}

/**
 * 선택한 개체를 맨 앞/맨 뒤로 보낸다 (z-순서). 엔진이 주석을 새 순서로 재생성하므로
 * 다른 주석들의 인덱스가 바뀐다 → 세션이미지를 비우고 선택 개체만 새 인덱스로 재등록.
 */
export async function reorderSelected(where: 'front' | 'back'): Promise<void> {
  const s = store()
  const sel = s.selectedImage
  if (!sel) return
  try {
    const r = await eng('reorderAnnot', { page: sel.page, index: sel.index, where })
    clearSessionImages(s.activeDocId)
    const updated = { ...sel, index: r.index }
    registerSessionImage(s.activeDocId, updated)
    s.set({ info: r.info, dirty: true, epoch: s.epoch + 1, selectedImage: updated })
    void syncUndoState()
  } catch (err) {
    s.showToast(`순서 변경 실패: ${err instanceof Error ? err.message : err}`)
  }
}

export const bringToFront = (): Promise<void> => reorderSelected('front')
export const sendToBack = (): Promise<void> => reorderSelected('back')

export async function setOutline(items: BookmarkItem[]): Promise<void> {
  const s = store()
  if (!s.info) return
  try {
    const info = await eng('setOutline', { items })
    s.set({ info, dirty: true })
    void syncUndoState()
  } catch (err) {
    s.showToast(`책갈피 저장 실패: ${err instanceof Error ? err.message : err}`)
  }
}

export async function addBookmarkAtCurrentPage(): Promise<void> {
  const s = store()
  if (!s.info) return
  const page = s.currentPage
  const items = [...s.info.outline, { title: `${page + 1}쪽 책갈피`, page, children: [] }]
  await setOutline(items)
  s.set({ sidebar: 'bookmarks' })
  s.showToast(`${page + 1}쪽에 책갈피를 추가했습니다`)
}

/** OCR → 페이지 위에 선택 가능한 텍스트 레이어 생성 (#III, #h) */
export async function ocrPages(pages: number[]): Promise<void> {
  const s = store()
  if (!s.info || !pages.length) return
  const ok = await api().confirm(
    'OCR 글자 인식 안내',
    'OCR은 이미지의 디자인과 해상도에 따라 글자가 완벽하게 인식되지 않을 수 있습니다. 결과를 감안하여 활용하세요.\n\n계속하시겠습니까?'
  )
  if (!ok) return
  const layers = { ...s.ocrLayers }
  let done = 0
  let totalWords = 0
  s.set({ busy: `OCR 인식 중 0/${pages.length} (첫 실행은 언어데이터 다운로드로 시간이 걸립니다)...` })
  try {
    for (const p of pages) {
      const { words } = await api().ocrPage(store().activeDocId, p)
      layers[p] = words
      totalWords += words.length
      done++
      store().set({ busy: `OCR 인식 중 ${done}/${pages.length}...`, ocrLayers: { ...layers } })
    }
    s.showToast(`OCR 완료 — ${pages.length}쪽, 단어 ${totalWords}개 (페이지에서 드래그하여 선택·복사)`)
  } catch (err) {
    s.showToast(`OCR 실패: ${err instanceof Error ? err.message : err}`)
  } finally {
    store().set({ busy: null })
  }
}

export async function ocrCurrentPage(): Promise<void> {
  const s = store()
  if (s.info) await ocrPages([s.currentPage])
}

export async function ocrAllPages(): Promise<void> {
  const s = store()
  if (s.info) await ocrPages(Array.from({ length: s.info.pageCount }, (_, i) => i))
}

/** "1-5,8" 형식 → 0-based 페이지 인덱스 */
export async function ocrPageRange(spec: string): Promise<void> {
  const s = store()
  if (!s.info) return
  const pages = new Set<number>()
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      const a = parseInt(m[1], 10)
      const b = parseInt(m[2], 10)
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) pages.add(i - 1)
    } else if (/^\d+$/.test(part.trim())) {
      pages.add(parseInt(part.trim(), 10) - 1)
    }
  }
  const valid = [...pages].filter((p) => p >= 0 && p < s.info!.pageCount).sort((a, b) => a - b)
  if (!valid.length) {
    s.showToast('유효한 페이지 범위가 아닙니다 (예: 1-5,8)')
    return
  }
  await ocrPages(valid)
}

export async function copySelection(): Promise<void> {
  const s = store()
  if (!s.selection?.text) return
  await navigator.clipboard.writeText(s.selection.text)
  s.showToast('선택한 텍스트를 복사했습니다')
}
