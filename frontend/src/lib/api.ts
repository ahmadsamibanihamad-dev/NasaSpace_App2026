// Thin fetch wrapper. All recommendation logic lives in the backend.
const BASE = '/api/v1'
const TOKEN_KEY = 'ardna.token'

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
  get isOffline() {
    return this.code === 'NETWORK_ERROR'
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

type Opts = { method?: string; body?: unknown; signal?: AbortSignal; raw?: boolean }

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'NETWORK_ERROR', 'Network unavailable')
  }
  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, 'HTTP_' + res.status, res.statusText)
    return res as unknown as T
  }
  if (res.status === 204) return undefined as T
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const d = data as { error?: { code?: string; message?: string; details?: unknown }; detail?: unknown } | null
    const code = d?.error?.code || (res.status === 401 ? 'UNAUTHORIZED' : res.status === 422 ? 'VALIDATION_ERROR' : 'HTTP_' + res.status)
    const msg = d?.error?.message || (typeof d?.detail === 'string' ? d.detail : res.statusText)
    if (res.status === 401 && token) {
      setToken(null)
      window.dispatchEvent(new Event('ardna:logout'))
    }
    throw new ApiError(res.status, code, msg, d?.error?.details ?? d?.detail)
  }
  return data as T
}

export async function downloadFile(path: string, filename: string) {
  const res = await api<Response>(path, { raw: true })
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
