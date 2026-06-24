type EndpointLocation = Pick<Location, 'protocol' | 'hostname'>

interface BlobcadeRuntimeConfig {
  apiUrl?: string
  wsUrl?: string
}

declare global {
  interface Window {
    __BLOBCADE_CONFIG__?: BlobcadeRuntimeConfig
  }
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.replace(/\/+$/, '')
}

function fallbackApiBaseUrl(loc: EndpointLocation): string {
  return `${loc.protocol}//${loc.hostname}:8081`
}

function fallbackWsUrl(loc: EndpointLocation): string {
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${loc.hostname}:8081`
}

export function resolveApiBaseUrl(
  env: Record<string, unknown>,
  runtimeConfig: BlobcadeRuntimeConfig | undefined,
  loc: EndpointLocation,
): string {
  return cleanUrl(env.VITE_BLOBCADE_API_URL)
    ?? cleanUrl(runtimeConfig?.apiUrl)
    ?? fallbackApiBaseUrl(loc)
}

export function resolveWsUrl(
  env: Record<string, unknown>,
  runtimeConfig: BlobcadeRuntimeConfig | undefined,
  loc: EndpointLocation,
): string {
  return cleanUrl(env.VITE_BLOBCADE_WS_URL)
    ?? cleanUrl(runtimeConfig?.wsUrl)
    ?? fallbackWsUrl(loc)
}

export function apiBaseUrl(): string {
  return resolveApiBaseUrl(import.meta.env, window.__BLOBCADE_CONFIG__, location)
}

export function wsUrl(): string {
  return resolveWsUrl(import.meta.env, window.__BLOBCADE_CONFIG__, location)
}
