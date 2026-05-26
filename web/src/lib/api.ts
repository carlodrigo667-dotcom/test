export class ApiError extends Error {
  status?: number;
  payload?: any;

  constructor(message: string, status?: number, payload?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

type ApiOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

interface RetryOptions {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

function localizeApiMessage(message?: string, status?: number) {
  if (!message) {
    if (status === 401) return 'Сессия недействительна. Войдите заново.';
    if (status === 403) return 'Доступ запрещен.';
    if (status && status >= 500) return 'Панель вернула внутреннюю ошибку.';
    return status ? `Запрос завершился ошибкой (${status}).` : 'Не удалось выполнить запрос.';
  }

  if (message === 'Wrong password') return 'Неверный пароль панели.';
  if (message === 'Unauthorized') return 'Сессия недействительна. Войдите заново.';
  if (message === 'Forbidden') return 'Доступ запрещен.';
  return message;
}

function localizeNetworkMessage(error: unknown) {
  if (error instanceof Error && error.message === 'Failed to fetch') {
    return 'Нет ответа от API панели.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Нет ответа от API панели.';
}

function shouldRetryRequest(error: unknown) {
  if (!(error instanceof ApiError)) {
    return false;
  }

  if (error.status === undefined) {
    return true;
  }

  if ([401, 403, 404].includes(error.status)) {
    return false;
  }

  return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  const normalizedPath = path.startsWith('/api') ? path : `/api${path}`;
  const hasJsonBody =
    options.body !== undefined &&
    options.body !== null &&
    !(options.body instanceof FormData) &&
    typeof options.body !== 'string';

  if (hasJsonBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;

  try {
    response = await fetch(normalizedPath, {
      ...options,
      headers,
      credentials: 'same-origin',
      body: hasJsonBody ? JSON.stringify(options.body) : (options.body as BodyInit | null | undefined)
    });
  } catch (error) {
    throw new ApiError(localizeNetworkMessage(error));
  }

  let data: any = null;
  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    throw new ApiError(localizeApiMessage(data?.error, response.status), response.status, data);
  }

  return data as T;
}

export async function apiWithRetry<T>(
  path: string,
  options: ApiOptions = {},
  retryOptions: RetryOptions = {}
): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = Math.max(1, retryOptions.attempts ?? (method === 'GET' ? 4 : 1));
  const initialDelayMs = Math.max(100, retryOptions.initialDelayMs ?? 900);
  const maxDelayMs = Math.max(initialDelayMs, retryOptions.maxDelayMs ?? 4500);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await api<T>(path, options);
    } catch (error) {
      const canRetry = method === 'GET' && shouldRetryRequest(error);
      if (!canRetry || attempt === attempts) {
        throw error;
      }

      const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delay);
    }
  }

  throw new ApiError('Не удалось выполнить запрос.');
}
