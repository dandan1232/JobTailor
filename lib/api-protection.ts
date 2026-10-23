import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

type Operation = "analyze" | "localAnalyze" | "refine" | "generate" | "extract" | "export";
type Group = "ai" | "local";
type Counter = { startedAt: number; requests: number; active: number };
type Client = { ai: Counter; local: Counter; touchedAt: number };
type ProtectionState = { secret: string; clients: Map<string, Client>; ai: Counter; local: Counter };
type Handler = (request: Request) => Response | Promise<Response>;

// These limits apply per server process. Multiple replicas need a shared limiter.
export const API_LIMITS = {
  ai: { clientRequests: 6, clientWindowMs: 10 * 60_000, clientConcurrent: 2, globalRequests: 60, globalWindowMs: 60 * 60_000, globalConcurrent: 4 },
  local: { clientRequests: 60, clientWindowMs: 10 * 60_000, clientConcurrent: 4, globalRequests: 3_000, globalWindowMs: 60 * 60_000, globalConcurrent: 6 },
} as const;
export const AI_USAGE_LIMITS = {
  perClientRequests: API_LIMITS.ai.clientRequests,
  clientWindowSeconds: API_LIMITS.ai.clientWindowMs / 1000,
  perClientConcurrent: API_LIMITS.ai.clientConcurrent,
  globalRequests: API_LIMITS.ai.globalRequests,
  globalWindowSeconds: API_LIMITS.ai.globalWindowMs / 1000,
  globalConcurrent: API_LIMITS.ai.globalConcurrent,
} as const;

const BODY_LIMITS: Record<Operation, number> = {
  analyze: 256 * 1024,
  localAnalyze: 256 * 1024,
  refine: 256 * 1024,
  generate: 1024 * 1024,
  extract: 5 * 1024 * 1024 + 64 * 1024,
  export: 256 * 1024,
};
const COOKIE_NAME = "jobtailor_client";
const CLIENT_LIFETIME_MS = 60 * 60_000;
const MAX_CLIENTS = 10_000;
const REQUEST_TIMEOUT_MS = 5 * 60_000;

function counter(now: number): Counter { return { startedAt: now, requests: 0, active: 0 }; }
function newState(now: number): ProtectionState {
  return { secret: randomBytes(32).toString("hex"), clients: new Map(), ai: counter(now), local: counter(now) };
}

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); }
  catch { throw new RequestError("请求内容不是有效的 JSON，请检查后重试。", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("请求内容必须是 JSON 对象。", 400);
  return body as Record<string, unknown>;
}

export function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function session(request: Request, state: ProtectionState) {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  const sign = (id: string) => createHmac("sha256", state.secret).update(id).digest("hex");
  if (token && /^[a-f\d-]{36}\.[a-f\d]{64}$/i.test(token)) {
    const [id, signature] = token.split(".");
    if (timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id)))) return { id, cookie: null };
  }
  const id = randomUUID();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return { id, cookie: `${COOKIE_NAME}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secure}` };
}

function resetWindow(value: Counter, now: number, windowMs: number) {
  if (now - value.startedAt >= windowMs) { value.startedAt = now; value.requests = 0; }
}

async function boundedBody(request: Request, maximum: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("content-length")) > maximum) {
    void request.body?.cancel("Request body too large").catch(() => {});
    throw new RequestError("请求内容过大，请缩短文字或上传不超过 5MB 的简历。", 413);
  }
  if (signal.aborted) throw new RequestError("请求已取消，请重试。", 408);
  if (!request.body) return null;
  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new RequestError("请求已取消或超时，请重试。", 408);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        void reader.cancel("Request body too large").catch(() => {});
        throw new RequestError("请求内容过大，请缩短文字或上传不超过 5MB 的简历。", 413);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

/** Isolated instances let tests exercise limits without affecting other requests. */
export function createApiProtection(options: { now?: () => number; maxClients?: number } = {}, state = newState((options.now ?? Date.now)())) {
  const now = options.now ?? Date.now;
  return async (request: Request, operation: Operation, handler: Handler): Promise<Response> => {
    const identity = session(request, state);
    const headers = new Headers({ "Cache-Control": "no-store, no-transform" });
    if (identity.cookie) headers.set("Set-Cookie", identity.cookie);
    const errorResponse = (detail: string, status: number, retryAfter?: number) => {
      if (retryAfter === undefined) return Response.json({ detail }, { status, headers });
      headers.set("Retry-After", String(retryAfter));
      const wait = retryAfter >= 60 ? `${Math.ceil(retryAfter / 60)} 分钟` : `${retryAfter} 秒`;
      return Response.json({ detail: `${detail}请在 ${wait} 后重试。`, retry_after_seconds: retryAfter }, { status, headers });
    };
    const time = now();
    // Pruning expired, idle records bounds memory without evicting active clients.
    for (const [id, client] of state.clients) {
      if (time - client.touchedAt >= CLIENT_LIFETIME_MS && client.ai.active === 0 && client.local.active === 0) state.clients.delete(id);
    }
    const group: Group = operation === "analyze" || operation === "refine" ? "ai" : "local";
    const limits = API_LIMITS[group];
    const global = state[group];
    resetWindow(global, time, limits.globalWindowMs);
    if (global.requests >= limits.globalRequests) return errorResponse("服务本小时的使用额度已用完，请稍后再试。", 429, Math.max(1, Math.ceil((global.startedAt + limits.globalWindowMs - time) / 1000)));
    if (global.active >= limits.globalConcurrent) return errorResponse("正在处理的请求较多，请等待当前操作完成后重试。", 429, 5);
    let client = state.clients.get(identity.id);
    if (!client) {
      if (state.clients.size >= (options.maxClients ?? MAX_CLIENTS)) return errorResponse("当前访问人数较多，请稍后再试。", 429, 60);
      client = { ai: counter(time), local: counter(time), touchedAt: time };
      state.clients.set(identity.id, client);
    }
    client.touchedAt = time;
    const local = client[group];
    resetWindow(local, time, limits.clientWindowMs);
    if (local.requests >= limits.clientRequests) return errorResponse("操作过于频繁，请稍后再试。", 429, Math.max(1, Math.ceil((local.startedAt + limits.clientWindowMs - time) / 1000)));
    if (local.active >= limits.clientConcurrent) return errorResponse("正在处理的请求较多，请等待当前操作完成后重试。", 429, 5);
    local.requests++; global.requests++; local.active++; global.active++;
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancellation: Promise<void> | undefined;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      local.active--; global.active--;
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
    };
    const cancelResponse = (reason: unknown) => {
      if (!reader) return Promise.resolve();
      cancellation ??= reader.cancel(reason);
      return cancellation;
    };
    const abort = () => {
      controller.abort(request.signal.reason ?? new Error("请求已取消或超时"));
      // A handler such as PDF parsing may not stop on abort; keep its lease until it settles.
      if (reader) void cancelResponse(controller.signal.reason).then(release, release);
    };
    const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    try {
      const body = await boundedBody(request, BODY_LIMITS[operation], controller.signal);
      const protectedRequest = new Request(request.url, { method: request.method, headers: request.headers, body, signal: controller.signal });
      const response = await handler(protectedRequest);
      const responseHeaders = new Headers(response.headers);
      for (const [name, value] of headers) responseHeaders.set(name, value);
      if (!response.body) { release(); return new Response(null, { status: response.status, statusText: response.statusText, headers: responseHeaders }); }
      reader = response.body.getReader();
      const responseReader = reader;
      if (controller.signal.aborted) {
        await cancelResponse(controller.signal.reason).catch(() => {});
        release();
        return errorResponse("请求已取消或超时，请重试。", 408);
      }
      const stream = new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            const next = await responseReader.read();
            if (next.done) {
              // cancel() closes pending reads before its asynchronous cleanup finishes.
              if (cancellation) await cancellation;
              release(); output.close();
            }
            else output.enqueue(next.value);
          } catch (error) {
            if (cancellation) await cancellation.catch(() => {});
            release(); output.error(error);
          }
        },
        async cancel(reason) {
          controller.abort(reason);
          try { await cancelResponse(reason); }
          finally { release(); }
        },
      });
      return new Response(stream, { status: response.status, statusText: response.statusText, headers: responseHeaders });
    } catch (error) {
      controller.abort(error);
      release();
      return errorResponse(error instanceof RequestError ? error.message : "请求处理失败，请稍后重试。", error instanceof RequestError ? error.status : 500);
    }
  };
}

const shared = globalThis as typeof globalThis & { __jobTailorProtection?: ProtectionState };
shared.__jobTailorProtection ??= newState(Date.now());
export const withApiProtection = createApiProtection({}, shared.__jobTailorProtection);
