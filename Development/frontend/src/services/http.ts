const BASE = import.meta.env.VITE_API_BASE ?? '';

let token: string | null = null;

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function setToken(nextToken: string | null) {
  token = nextToken;
}

export function getToken() {
  return token;
}

export function getApiBase() {
  return BASE;
}

function buildJsonHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function buildAuthHeaders() {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(payload: unknown, status: number) {
  if (typeof payload === 'object' && payload && 'error' in payload) {
    return String((payload as { error?: string }).error || `Request failed with ${status}`);
  }
  return `Request failed with ${status}`;
}

export async function postJson<T = unknown>(ep: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetch(`${BASE}${ep}`, {
      method: 'POST',
      headers: buildJsonHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  } catch {
    return null;
  }
}

export async function patchJson<T = unknown>(ep: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetch(`${BASE}${ep}`, {
      method: 'PATCH',
      headers: buildJsonHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  } catch {
    return null;
  }
}

export async function postJsonOrThrow<T = unknown>(ep: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}${ep}`, {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify(body),
  });
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    throw new ApiError(extractErrorMessage(payload, response.status), response.status);
  }
  return payload as T;
}

export async function getJson<T = unknown>(ep: string): Promise<T | null> {
  if (!token) return null;
  try {
    const response = await fetch(`${BASE}${ep}`, {
      headers: buildAuthHeaders(),
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  } catch {
    return null;
  }
}

export async function deleteJson<T = unknown>(ep: string): Promise<T | null> {
  if (!token) return null;
  try {
    const response = await fetch(`${BASE}${ep}`, {
      method: 'DELETE',
      headers: buildAuthHeaders(),
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  } catch {
    return null;
  }
}

export async function postForm<T = unknown>(ep: string, formData: FormData): Promise<T> {
  const response = await fetch(`${BASE}${ep}`, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: formData,
  });
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    throw new ApiError(extractErrorMessage(payload, response.status), response.status);
  }
  return payload as T;
}

export function resolveAssetUrl(path: string) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${BASE}${path}`;
}
