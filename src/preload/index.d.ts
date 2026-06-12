import type { IcepdfApi } from './index'

declare global {
  interface Window {
    icepdf: IcepdfApi
  }
}

export {}
