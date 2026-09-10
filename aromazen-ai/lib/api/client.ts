const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api/v1'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }
const TRANSIENT_STATUSES = new Set([502, 503, 504])
const RETRY_DELAYS_MS = [1000, 3000, 7000]

function toRequestBody(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined
  if (body instanceof FormData || body instanceof URLSearchParams || typeof body === 'string') return body
  return JSON.stringify(body)
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (init.signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError')
    try {
      const response = await fetch(url, init)
      if (!TRANSIENT_STATUSES.has(response.status) || attempt === RETRY_DELAYS_MS.length) return response
    } catch (error) {
      lastError = error
      if (attempt === RETRY_DELAYS_MS.length) break
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
  }
  throw new ApiError('The portal could not reach the API after four attempts. Please try once more.', 0, lastError)
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...init } = options
  const isFormData = body instanceof FormData
  const response = await fetchWithRetry(`${API_BASE_URL}${path}`, {
    ...init,
    body: toRequestBody(body),
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  })

  if (response.status === 204) return undefined as T

  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'detail' in payload
      ? String(payload.detail)
      : response.status >= 500
        ? 'The service returned an unexpected error. Please try again.'
        : 'The request could not be completed.'
    throw new ApiError(message, response.status, payload)
  }

  return payload as T
}

export async function apiStreamRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const { body, headers, ...init } = options
  const response = await fetchWithRetry(`${API_BASE_URL}${path}`, {
    ...init,
    body: toRequestBody(body),
    credentials: 'include',
    headers: {
      Accept: 'text/event-stream',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined)
    const message = typeof payload === 'object' && payload !== null && 'detail' in payload
      ? String(payload.detail)
      : 'The AI request could not be started.'
    throw new ApiError(message, response.status, payload)
  }
  return response
}

export async function apiFileRequest(path: string, accessToken: string, options: RequestOptions = {}): Promise<{ blob: Blob; filename: string }> {
  const { body, headers, ...init } = options
  const response = await fetchWithRetry(`${API_BASE_URL}${path}`, { ...init, body: toRequestBody(body), credentials: 'include', headers: { Authorization: `Bearer ${accessToken}`, ...headers } })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined)
    const message = typeof payload === 'object' && payload !== null && 'detail' in payload ? String(payload.detail) : 'The file could not be downloaded.'
    throw new ApiError(message, response.status, payload)
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = disposition.match(/filename="?([^";]+)"?/i)
  return { blob: await response.blob(), filename: match?.[1] ?? 'download' }
}
