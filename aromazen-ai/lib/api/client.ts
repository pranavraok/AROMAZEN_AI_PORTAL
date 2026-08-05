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

function toRequestBody(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined
  if (body instanceof FormData || body instanceof URLSearchParams || typeof body === 'string') return body
  return JSON.stringify(body)
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...init } = options
  const isFormData = body instanceof FormData
  const response = await fetch(`${API_BASE_URL}${path}`, {
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
      : 'The request could not be completed.'
    throw new ApiError(message, response.status, payload)
  }

  return payload as T
}

export async function apiStreamRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const { body, headers, ...init } = options
  const response = await fetch(`${API_BASE_URL}${path}`, {
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

export async function apiFileRequest(path: string, accessToken: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined)
    const message = typeof payload === 'object' && payload !== null && 'detail' in payload ? String(payload.detail) : 'The file could not be downloaded.'
    throw new ApiError(message, response.status, payload)
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = disposition.match(/filename="?([^";]+)"?/i)
  return { blob: await response.blob(), filename: match?.[1] ?? 'download' }
}
