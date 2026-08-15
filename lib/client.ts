/**
 * Vouch hackathon sandbox kits — thin HTTP client for the kit tools.
 *
 * Every mutation seed-kit.ts / run-stream.ts makes goes through this client
 * over real HTTP to the running backend — never a direct database write —
 * so declines, ledger entries, and events are genuine.
 */

export interface KitApiClientOptions {
  baseUrl: string;
  apiKey: string;
}

export class KitApiError extends Error {
  constructor(
    public method: string,
    public path: string,
    public status: number,
    public body: unknown,
  ) {
    super(`${method} ${path} -> ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.name = "KitApiError";
  }
}

export class KitApiClient {
  constructor(private opts: KitApiClientOptions) {}

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.opts.apiKey,
        ...extraHeaders,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      throw new KitApiError(method, path, res.status, parsed);
    }
    return parsed as T;
  }

  get<T = unknown>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, undefined, extraHeaders);
  }

  post<T = unknown>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>("POST", path, body, extraHeaders);
  }

  put<T = unknown>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>("PUT", path, body, extraHeaders);
  }

  patch<T = unknown>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>("PATCH", path, body, extraHeaders);
  }

  delete<T = unknown>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>("DELETE", path, undefined, extraHeaders);
  }
}

export type EitherResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: unknown };

/** Like KitApiClient.request, but resolves the HTTP error instead of throwing — used by run-stream.ts, which needs to inspect declines (403s) as expected outcomes, not exceptions. */
export async function requestExpectingEither<T = unknown>(
  client: KitApiClient,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<EitherResult<T>> {
  try {
    const data = await client.request<T>(method, path, body, extraHeaders);
    return { ok: true, status: 200, data };
  } catch (err) {
    if (err instanceof KitApiError) {
      return { ok: false, status: err.status, error: err.body };
    }
    throw err;
  }
}
