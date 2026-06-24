import { describe, expect, it } from 'vitest'
import { resolveApiBaseUrl, resolveWsUrl } from '../src/config'

const httpLocal = { protocol: 'http:', hostname: 'localhost' } as Location
const httpsGame = { protocol: 'https:', hostname: 'play.blobcade.test' } as Location

describe('endpoint config resolver', () => {
  it('defaults to the local server on the current hostname', () => {
    expect(resolveApiBaseUrl({}, undefined, httpLocal)).toBe('http://localhost:8081')
    expect(resolveWsUrl({}, undefined, httpLocal)).toBe('ws://localhost:8081')
  })

  it('uses wss for the websocket fallback on https pages', () => {
    expect(resolveApiBaseUrl({}, undefined, httpsGame)).toBe('https://play.blobcade.test:8081')
    expect(resolveWsUrl({}, undefined, httpsGame)).toBe('wss://play.blobcade.test:8081')
  })

  it('prefers Vite env over runtime config', () => {
    const runtime = {
      apiUrl: 'https://runtime.example/api',
      wsUrl: 'wss://runtime.example/ws',
    }
    const env = {
      VITE_BLOBCADE_API_URL: 'https://env.example/api',
      VITE_BLOBCADE_WS_URL: 'wss://env.example/ws',
    }

    expect(resolveApiBaseUrl(env, runtime, httpLocal)).toBe('https://env.example/api')
    expect(resolveWsUrl(env, runtime, httpLocal)).toBe('wss://env.example/ws')
  })

  it('uses runtime config when env is absent', () => {
    const runtime = {
      apiUrl: 'https://runtime.example/api/',
      wsUrl: 'wss://runtime.example/ws/',
    }

    expect(resolveApiBaseUrl({}, runtime, httpLocal)).toBe('https://runtime.example/api')
    expect(resolveWsUrl({}, runtime, httpLocal)).toBe('wss://runtime.example/ws')
  })
})
