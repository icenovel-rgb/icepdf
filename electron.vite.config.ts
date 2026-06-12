import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          'engine/worker': resolve(import.meta.dirname, 'src/main/engine/worker.ts'),
          'convert/worker': resolve(import.meta.dirname, 'src/main/convert/worker.ts'),
          'ocr/worker': resolve(import.meta.dirname, 'src/main/ocr/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
