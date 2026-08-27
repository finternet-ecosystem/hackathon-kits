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

// Observed on the live shared sandbox: /payments/authorize's on-chain settlement
// path intermittently 500s on the first attempt and succeeds on an immediate
// retry with the identical request. Retrying ONLY 5xx (never 4xx — those are
// real policy decisions like a 403 rate-limit denial, and retrying them would
// just waste calls and risk tripping velocity caps further) turns that
// transient infra flakiness back into a clean allow/deny signal.
const MAX_5XX_RETRIES = 2;
const RETRY_BACKOFF_MS = [400, 900];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finishRequest<T>(method: string, path: string, res: Response, parsed: unknown): T {
  if (!res.ok) {
    throw new KitApiError(method, path, res.status, parsed);
  }
  return parsed as T;
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
    let attempt = 0;
    for (;;) {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          // Omitted rather than sent empty so callers that authenticate another
          // way (approve-proposal.ts uses a portal bearer token) send no key at all.
          ...(this.opts.apiKey ? { "x-api-key": this.opts.apiKey } : {}),
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
      return finishRequest<T>(method, path, res, parsed);
    }
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
