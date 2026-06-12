/** electron-builder afterPack 훅 — OCR 전용 무거운 모듈을 중첩 위치 포함 전부 제거 (미사용) */
const fs = require('node:fs')
const path = require('node:path')

// 이름이 정확히 일치하는 디렉토리를 어떤 깊이의 node_modules에서든 제거
const HEAVY = new Set([
  'onnxruntime-node',
  'onnxruntime-web',
  'onnxruntime-common',
  '@huggingface',
  '@hyzyla',
  'sharp',
  '@img'
])

function sweep(nodeModules, removed) {
  if (!fs.existsSync(nodeModules)) return
  for (const entry of fs.readdirSync(nodeModules)) {
    const full = path.join(nodeModules, entry)
    if (HEAVY.has(entry)) {
      fs.rmSync(full, { recursive: true, force: true })
      removed.push(full)
      continue
    }
    // 스코프 패키지(@scope/pkg)와 중첩 node_modules 재귀 탐색
    if (entry.startsWith('@')) {
      sweep(full, removed)
    } else {
      const nested = path.join(full, 'node_modules')
      if (fs.existsSync(nested)) sweep(nested, removed)
    }
  }
}

exports.default = async function afterPack(context) {
  const root = path.join(context.appOutDir, 'resources', 'app', 'node_modules')
  const removed = []
  sweep(root, removed)
  for (const r of removed) console.log(`  • afterPack 제거: ${path.relative(root, r)}`)
}
