import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../lib/api-protection.ts", import.meta.url), "utf8");
const protection = {};
const compile = (text) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
vm.runInNewContext(compile(source), {
  exports: protection, require, Request, Response, Headers, ReadableStream, AbortController,
  Buffer, Uint8Array, setTimeout, clearTimeout, URL,
});
const { createApiProtection, readJsonObject, validText, AI_USAGE_LIMITS } = protection;
const encoder = new TextEncoder();
const request = (cookie, body = "{}", extraHeaders = {}, signal) => new Request("https://jobtailor.test/api", {
  method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...extraHeaders }, body, signal,
  ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
});
const sessionCookie = (response) => response.headers.get("set-cookie").split(";")[0];
const success = () => new Response("完成");
const consume = async (response) => { await response.text(); return response; };

test("body limits count actual streamed bytes even without or with forged Content-Length", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    const protect = createApiProtection();
    let called = false;
    let cancelled = false;
    const body = new ReadableStream({
      start(output) { output.enqueue(new Uint8Array(200_000)); output.enqueue(new Uint8Array(70_000)); },
      cancel() { cancelled = true; },
    });
    const response = await protect(request(null, body, headers), "refine", () => { called = true; return success(); });
    assert.equal(response.status, 413);
    assert.equal(called, false);
    assert.equal(cancelled, true);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    assert.match((await response.json()).detail, /过大/);
  }
});

test("streamed bodies below the byte limit reach the parser intact", async () => {
  const protect = createApiProtection();
  const text = JSON.stringify({ content: "中文简历".repeat(1_000) });
  const bytes = encoder.encode(text);
  const response = await protect(request(null, new ReadableStream({
    start(output) { output.enqueue(bytes.slice(0, 5)); output.enqueue(bytes.slice(5)); output.close(); },
  })), "refine", async (incoming) => Response.json(await readJsonObject(incoming)));
  assert.deepEqual(await response.json(), JSON.parse(text));
});

test("extract permits a 5MB file plus multipart overhead and rejects oversized uploads", async () => {
  const protect = createApiProtection();
  const form = new FormData();
  form.set("file", new File([new Uint8Array(5 * 1024 * 1024)], "resume.pdf"));
  const response = await protect(new Request("https://jobtailor.test/api", { method: "POST", body: form }), "extract", async (incoming) => {
    const parsed = await incoming.formData();
    return Response.json({ bytes: parsed.get("file").size });
  });
  assert.equal((await response.json()).bytes, 5 * 1024 * 1024);
  const oversized = await protect(request(null, new Uint8Array(5 * 1024 * 1024 + 64 * 1024 + 1)), "extract", success);
  assert.equal(oversized.status, 413);
});

test("signed HttpOnly cookies enforce client AI rate limits across operations and reset after the window", async () => {
  let time = 0;
  const protect = createApiProtection({ now: () => time });
  const first = await consume(await protect(request(), "analyze", success));
  const cookie = sessionCookie(first);
  assert.match(first.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  assert.match(first.headers.get("set-cookie"), /Secure/);
  for (let index = 1; index < AI_USAGE_LIMITS.perClientRequests; index++) await consume(await protect(request(cookie), "refine", success));
  const limited = await protect(request(cookie), "analyze", success);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "600");
  const detail = await limited.json();
  assert.match(detail.detail, /频繁.*10 分钟/);
  assert.equal(detail.retry_after_seconds, 600);
  time += AI_USAGE_LIMITS.clientWindowSeconds * 1000;
  assert.equal((await consume(await protect(request(cookie), "refine", success))).status, 200);
});

test("global AI rate limit still applies after clearing cookies and forging forwarding headers", async () => {
  const protect = createApiProtection();
  for (let index = 0; index < AI_USAGE_LIMITS.globalRequests; index++) {
    const response = await consume(await protect(request(null, "{}", { "x-forwarded-for": `192.0.2.${index}`, "x-real-ip": `${index}` }), "analyze", success));
    assert.equal(response.status, 200);
  }
  const blocked = await protect(request(null, "{}", { "x-forwarded-for": "198.51.100.1" }), "refine", success);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.match((await blocked.json()).detail, /额度/);
});

test("forged forwarding headers cannot reset a signed client's quota", async () => {
  const protect = createApiProtection();
  const first = await consume(await protect(request(), "refine", success));
  const cookie = sessionCookie(first);
  for (let index = 1; index < AI_USAGE_LIMITS.perClientRequests; index++) await consume(await protect(request(cookie, "{}", { "x-forwarded-for": `${index}` }), "analyze", success));
  assert.equal((await protect(request(cookie, "{}", { "x-forwarded-for": "new-address" }), "refine", success)).status, 429);
});

test("client and global concurrency stay leased while responses are streaming", async () => {
  const protect = createApiProtection();
  const first = await protect(request(), "analyze", () => new Response(new ReadableStream()));
  const cookie = sessionCookie(first);
  const second = await protect(request(cookie), "refine", () => new Response(new ReadableStream()));
  assert.equal((await protect(request(cookie), "analyze", success)).status, 429);
  const third = await protect(request(), "analyze", () => new Response(new ReadableStream()));
  const fourth = await protect(request(), "refine", () => new Response(new ReadableStream()));
  assert.equal((await protect(request(), "analyze", success)).status, 429);
  await first.body.cancel();
  const afterCancel = await consume(await protect(request(cookie), "refine", success));
  assert.equal(afterCancel.status, 200);
  await Promise.all([second.body.cancel(), third.body.cancel(), fourth.body.cancel()]);
});

test("response cancellation aborts the handler signal and cancels its upstream stream", async () => {
  const protect = createApiProtection();
  let signal;
  let cancelled = false;
  const response = await protect(request(), "refine", (incoming) => {
    signal = incoming.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  await response.body.cancel("用户取消");
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test("request disconnect propagates through the handler and frees concurrency", async () => {
  const protect = createApiProtection();
  const controller = new AbortController();
  let signal;
  const first = await protect(request(null, "{}", {}, controller.signal), "analyze", (incoming) => {
    signal = incoming.signal;
    return new Response(new ReadableStream());
  });
  const cookie = sessionCookie(first);
  const second = await protect(request(cookie), "refine", () => new Response(new ReadableStream()));
  controller.abort();
  assert.equal(signal.aborted, true);
  assert.equal((await consume(await protect(request(cookie), "analyze", success))).status, 200);
  await first.body.cancel();
  await second.body.cancel();
});

test("handler failures and stream errors release their slots", async () => {
  const protect = createApiProtection();
  const failed = await protect(request(), "refine", () => { throw new Error("private provider error"); });
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /private provider/);
  const cookie = sessionCookie(failed);
  const held = await protect(request(cookie), "refine", () => new Response(new ReadableStream()));
  const broken = await protect(request(cookie), "analyze", () => new Response(new ReadableStream({ start(output) { output.error(new Error("network failed")); } })));
  await assert.rejects(broken.text(), /network failed/);
  assert.equal((await consume(await protect(request(cookie), "analyze", success))).status, 200);
  await held.body.cancel();
});

test("disconnect during body upload cancels the upload and never invokes the handler", async () => {
  const protect = createApiProtection();
  const controller = new AbortController();
  let cancelled = false;
  let called = false;
  const pending = protect(request(null, new ReadableStream({ cancel() { cancelled = true; } }), {}, controller.signal), "refine", () => { called = true; return success(); });
  controller.abort();
  const response = await pending;
  assert.equal(response.status, 408);
  assert.equal(cancelled, true);
  assert.equal(called, false);
});

test("client records have a hard capacity and expire when idle", async () => {
  let time = 0;
  const protect = createApiProtection({ now: () => time, maxClients: 2 });
  await consume(await protect(request(), "localAnalyze", success));
  await consume(await protect(request(), "generate", success));
  assert.equal((await protect(request(), "export", success)).status, 429);
  time += 60 * 60_000;
  assert.equal((await consume(await protect(request(), "extract", success))).status, 200);
});

test("local operations do not consume AI request quota", async () => {
  const protect = createApiProtection();
  const first = await consume(await protect(request(), "refine", success));
  const cookie = sessionCookie(first);
  for (let index = 1; index < AI_USAGE_LIMITS.perClientRequests; index++) await consume(await protect(request(cookie), "refine", success));
  for (const operation of ["localAnalyze", "generate", "extract", "export"]) assert.equal((await consume(await protect(request(cookie), operation, success))).status, 200);
});

function loadRoute(name) {
  const exports = {};
  const protect = createApiProtection();
  vm.runInNewContext(compile(readFileSync(new URL(`../app/api/resume/${name}/route.ts`, import.meta.url), "utf8")), {
    exports, Request, Response, File, Buffer, Uint8Array, console,
    require: (module) => {
      if (module === "@/lib/api-protection") return { readJsonObject, validText, withApiProtection: protect };
      if (module === "@/lib/resume-editor") return { generateResumeStream: () => { throw new Error("unexpected generation"); }, refineResumeStream: () => { throw new Error("unexpected AI request"); } };
      if (module === "docx") return {};
      if (module === "pdfkit") return { default: class {} };
      return require(module);
    },
  });
  return exports.POST;
}

test("JSON routes reject invalid JSON, wrong types and oversized text before model or export work", async () => {
  const examples = {
    refine: [{ content: [], instruction: "调整" }, { content: "a".repeat(60_001), instruction: "调整" }, { content: "简历", instruction: "a".repeat(2_001) }],
    generate: [{ original: 1, revisions: [] }, { original: "简历", revisions: [{ original: "简历", revised: "正文" }] }, { original: "简历", revisions: Array(7).fill({}) }],
    export: [{ content: "简历", format: "html" }, { content: {}, format: "pdf" }, { content: "简历", format: "pdf", filename: [] }],
  };
  for (const [name, bodies] of Object.entries(examples)) {
    const post = loadRoute(name);
    assert.equal((await post(request(null, "{"))).status, 400, `${name} malformed JSON`);
    assert.equal((await post(request(null, "[]"))).status, 400, `${name} array body`);
    for (const body of bodies) assert.equal((await post(request(null, JSON.stringify(body)))).status, 422, `${name} invalid fields`);
  }
});
