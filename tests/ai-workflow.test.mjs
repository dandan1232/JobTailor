import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fixture = { analysis_mode: "ai", score: 70, verdict: "已有证据，仍需核实岗位要求。", dimensions: ["关键词覆盖", "经历证据", "岗位相关性", "表达清晰度"].map((name) => ({ name, score: 70, note: "依据原简历核对。" })), requirements: [], matched: [], gaps: [] };
const encoder = new TextEncoder();
const globals = { Response, Request, Headers, TextEncoder, TextDecoder, ReadableStream, AbortController, AbortSignal, Uint8Array };
const frame = (content, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`;

function loadEditor(fetch) {
  const exports = {};
  vm.runInNewContext(compile("../lib/resume-editor.ts"), {
    exports, ...globals, process: { env: { AI_BASE_URL: "https://model.test/v1", AI_API_KEY: "test-only", AI_MODEL: "test" } },
    require: () => ({ aiIsConfigured: () => true }), fetch,
  });
  return exports;
}

test("AI editing streams complete text with an output budget and propagates cancellation", async () => {
  let options;
  const editor = loadEditor(async (_url, init) => {
    options = init;
    return new Response(frame("完整简历", "stop") + "data: [DONE]\n\n");
  });
  const caller = new AbortController();
  assert.equal(await (await editor.refineResumeStream("原稿", "精简", caller.signal)).text(), "完整简历");
  assert.equal(JSON.parse(options.body).max_tokens, 12_000);
  caller.abort();
  assert.equal(options.signal.aborted, true);
});

test("AI editing refuses truncation, malformed data and provider errors", async () => {
  for (const wire of [frame("半截内容"), frame("半截内容", "length"), frame("", "content_filter"), "data: {broken}\n\n", 'data: {"error":{"message":"failed"}}\n\n', frame("", "stop")]) {
    const editor = loadEditor(async () => new Response(wire));
    const response = await editor.refineResumeStream("原稿", "精简");
    await assert.rejects(response.text(), /未完成|中断|中止|格式|不完整|异常/);
  }
});

test("AI editing rejects oversized output and cancels the provider when the client stops reading", async () => {
  const tooLong = loadEditor(async () => new Response(frame("字".repeat(60_001), "stop")));
  await assert.rejects((await tooLong.refineResumeStream("原稿", "精简")).text(), /60000/);
  let cancelled = false;
  let signal;
  const editor = loadEditor(async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({
      start(output) { output.enqueue(encoder.encode(frame("第一部分"))); },
      cancel() { cancelled = true; },
    }));
  });
  const response = await editor.refineResumeStream("原稿", "精简");
  await response.body.cancel();
  assert.equal(cancelled, true);
  assert.equal(signal.aborted, true);
});

function loadAnalyzeRoute(wire) {
  const validation = {};
  vm.runInNewContext(compile("../lib/analysis-validation.ts"), { exports: validation });
  const streaming = {};
  vm.runInNewContext(compile("../lib/analysis-stream.ts"), { exports: streaming, require: () => validation });
  const exports = {};
  vm.runInNewContext(compile("../app/api/analyze/route.ts"), { exports, ...globals,
    require: (name) => {
      if (name === "@/lib/analysis") return { aiIsConfigured: () => true, requestAiAnalysisStream: async () => new Response(wire) };
      if (name === "@/lib/analysis-stream") return streaming;
      if (name === "@/lib/api-protection") return {
        withApiProtection: (request, _operation, handler) => handler(request),
        readJsonObject: (request) => request.json(), validText: (value, max) => typeof value === "string" && value.length <= max && Boolean(value.trim()),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports.POST;
}

const analyzeRequest = () => new Request("https://jobtailor.test/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resume_text: "真实简历文字".repeat(20), job_description: "目标岗位描述".repeat(20) }) });

test("the analysis route emits done only after complete, valid model output", async () => {
  for (const [wire, success] of [
    [frame(JSON.stringify({ type: "summary", data: fixture }), "stop"), true],
    [frame(JSON.stringify({ type: "summary", data: fixture })), false],
    [frame('{"type":"summary","data":{} }', "stop"), false],
    [frame(`${JSON.stringify({ type: "summary", data: fixture })}\n{"type":"revision"`, "stop"), false],
  ]) {
    const response = await loadAnalyzeRoute(wire)(analyzeRequest());
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.equal(events.some((event) => event.type === "done"), success);
    assert.equal(events.at(-1).type, success ? "done" : "error");
  }
});
