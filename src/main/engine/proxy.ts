/** 엔진 worker_thread RPC 클라이언트 (메인 프로세스 측) — 단일 워커가 여러 문서(docId)를 보유 */
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { DocInfo, EngineOpName, EngineOps } from '../../shared/types'

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

let worker: Worker | null = null
let nextId = 1
let nextDocId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(join(import.meta.dirname, 'engine/worker.js'))
  worker.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new Error(msg.error ?? '엔진 오류'))
  })
  worker.on('error', (err) => {
    for (const [, p] of pending) p.reject(err)
    pending.clear()
    worker = null
  })
  worker.on('exit', () => {
    for (const [, p] of pending) p.reject(new Error('엔진 워커가 종료되었습니다'))
    pending.clear()
    worker = null
  })
  return worker
}

export function engineCall<K extends EngineOpName>(
  docId: number,
  op: K,
  args: EngineOps[K]['args']
): Promise<EngineOps[K]['result']> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    const transfer: ArrayBuffer[] = []
    const png = (args as { png?: ArrayBuffer }).png
    if (png instanceof ArrayBuffer) transfer.push(png)
    getWorker().postMessage({ id, docId, op, args }, transfer)
  })
}

/** 새 문서를 열고 docId를 발급한다 */
export async function openDoc(path: string): Promise<{ docId: number; info: DocInfo }> {
  const docId = nextDocId++
  const info = await engineCall(docId, 'open', { path })
  return { docId, info }
}

/** 탭이 닫힐 때 문서 메모리 해제 */
export function closeDoc(docId: number): Promise<null> {
  return engineCall(docId, 'close', {})
}

export function shutdownEngine(): void {
  worker?.terminate()
  worker = null
}
