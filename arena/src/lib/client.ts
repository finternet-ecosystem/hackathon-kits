/**
 * Thin HTTP client for the arena — every persona action goes over real HTTP
 * to the running Vouch backend using the org's own API key. The public REST
 * API is arena's only way in (see arena/README.md), so declines, ledger
 * entries, and events are genuine, matching the repo root's run-stream.ts
 * architecture.
 */

export interface ArenaApiClientOptions {
  baseUrl: string;
  apiKey: string;
}

export class ArenaApiError extends Error {
  constructor(
    public method: string,
    public path: string,
    public status: number,
    public body: unknown,
  ) {
    super(`${method} ${path} -> ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.name = "ArenaApiError";
  }
}

export type EitherResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: unknown };

// Observed on the live shared sandbox: /payments/authorize's on-chain
// settlement path intermittently 500s on the first attempt and succeeds on
// an immediate retry with the identical request. Retrying ONLY 5xx (never
// 4xx — those are real policy decisions like a rate-limit denial, and
// retrying them would just waste calls and risk tripping velocity caps
// further) turns that transient infra flakiness back into a clean
// allow/deny signal, so it doesn't get misrecorded as a ground-truth
// mismatch in labels.jsonl.
const MAX_5XX_RETRIES = 2;
const RETRY_BACKOFF_MS = [400, 900];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ArenaApiClient {
  constructor(private opts: ArenaApiClientOptions) {}

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}${path}`;
    let attempt = 0;
    for (;;) {
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
      if (!res.ok && res.status >= 500 && attempt < MAX_5XX_RETRIES) {
        console.warn(`  [retry] ${method} ${path} -> ${res.status}, retrying (attempt ${attempt + 2}/${MAX_5XX_RETRIES + 1})...`);
        await sleep(RETRY_BACKOFF_MS[attempt] ?? 1000);
        attempt += 1;
        continue;
      }
      if (!res.ok) {
        throw new ArenaApiError(method, path, res.status, parsed);
      }
      return parsed as T;
    }
  }

  /** Like request(), but resolves the HTTP error (incl. 429s) instead of throwing — the engine needs to inspect declines/rate-limit responses as data, not exceptions. */
  async requestEither<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<EitherResult<T>> {
    try {
      const data = await this.request<T>(method, path, body, extraHeaders);
      return { ok: true, status: 200, data };
    } catch (err) {
      if (err instanceof ArenaApiError) {
        return { ok: false, status: err.status, error: err.body };
      }
      throw err;
    }
  }

  get<T = unknown>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, undefined, extraHeaders);
  }

  post<T = unknown>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>("POST", path, body, extraHeaders);
  }

  delete<T = unknown>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>("DELETE", path, undefined, extraHeaders);
  }
}
