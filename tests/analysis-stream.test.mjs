import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/analysis-stream.ts", import.meta.url), "utf8");
const validationSource = readFileSync(new URL("../lib/analysis-validation.ts", import.meta.url), "utf8");
const validationExports = {};
vm.runInNewContext(ts.transpileModule(validationSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: validationExports });
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: exportsObject,
  require: (name) => {
    assert.equal(name, "./analysis-validation");
    return validationExports;
  },
});
const { AnalysisEventDecoder, AnalysisSseDecoder } = exportsObject;

const summary = { type: "summary", data: {
  analysis_mode: "ai", score: 35, verdict: "匹配度较低，需要核实岗位证据。",
  dimensions: ["关键词覆盖", "经历证据", "岗位相关性", "表达清晰度"].map((name) => ({ name, score: 35, note: "需要补充已有经历的具体证据。" })),
  requirements: [{ label: "Python", status: "pass", evidence: "使用 Python 开发订单服务。" }],
  matched: [{ skill: "Python", evidence: "使用 Python 开发订单服务。" }],
  gaps: [{ skill: "AWS", suggestion: "有真实经历时补充项目，否则保留为缺口。" }],
} };
const revision = { type: "revision", data: {
  id: "project-clarity", priority: "中", category: "项目经历", title: "明确技术动作",
  original: "使用 Python 开发订单服务。", revised: "开发基于 Python 的订单服务。", reason: "将动作和技术表达得更直接。",
} };
const row = (value) => JSON.stringify(value);
const frame = (value, ending = "\n\n") => `data: ${JSON.stringify(value)}${ending}`;
const contentFrame = (content, finish_reason = null) => frame({ choices: [{ delta: { content }, finish_reason }] });

test("emits each raw JSON object as soon as its closing brace arrives", () => {
  const decoder = new AnalysisEventDecoder();
  assert.deepEqual(Array.from(decoder.push(JSON.stringify(summary).slice(0, 20))), []);
  assert.deepEqual(Array.from(decoder.push(`${JSON.stringify(summary).slice(20)}\n${JSON.stringify(revision)}`)), [
    JSON.stringify(summary),
    JSON.stringify(revision),
  ]);
  assert.deepEqual(Array.from(decoder.finish()), []);
});

test("incrementally decodes a JSON-string encoded NDJSON response", () => {
  const decoder = new AnalysisEventDecoder();
  const encoded = JSON.stringify(`${JSON.stringify(summary)}\n${JSON.stringify(revision)}`);
  const splitAfterSummary = encoded.indexOf("\\n") + 2;
  assert.deepEqual(Array.from(decoder.push(encoded.slice(0, splitAfterSummary))), [JSON.stringify(summary)]);
  assert.deepEqual(Array.from(decoder.push(encoded.slice(splitAfterSummary))), [JSON.stringify(revision)]);
  assert.deepEqual(Array.from(decoder.finish()), []);
});

test("handles CRLF SSE frames and arbitrary network chunk boundaries", () => {
  const decoder = new AnalysisSseDecoder();
  const firstFrame = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(summary) } }] })}\r\n\r\n`;
  const secondFrame = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(revision) }, finish_reason: "stop" }] })}\n\n`;
  const wire = firstFrame + secondFrame;
  const rows = [
    ...decoder.push(wire.slice(0, 17)),
    ...decoder.push(wire.slice(17, firstFrame.length + 11)),
    ...decoder.push(wire.slice(firstFrame.length + 11)),
    ...decoder.finish(),
  ];
  assert.deepEqual(rows, [JSON.stringify(summary), JSON.stringify(revision)]);
});

test("accepts a complete summary without requiring revisions", () => {
  const decoder = new AnalysisEventDecoder();
  assert.deepEqual(Array.from(decoder.push(row(summary))), [row(summary)]);
  assert.deepEqual(Array.from(decoder.finish()), []);
});

test("decodes quoted Unicode escapes and braces inside strings across single-character chunks", () => {
  const decoder = new AnalysisEventDecoder();
  const escaped = structuredClone(summary);
  escaped.data.verdict = '诊断包含 {原文} 和 "引号"。';
  const encoded = JSON.stringify(row(escaped)).replace("诊", "\\u8bca");
  const rows = [...encoded].flatMap((character) => Array.from(decoder.push(character)));
  assert.deepEqual(rows, [row(escaped)]);
  decoder.finish();
});

test("rejects revisions before the summary and repeated summaries or revision ids", () => {
  assert.throws(() => new AnalysisEventDecoder().push(row(revision)), /前置诊断摘要/);
  const duplicateSummary = new AnalysisEventDecoder();
  duplicateSummary.push(row(summary));
  assert.throws(() => duplicateSummary.push(row(summary)), /重复返回诊断摘要/);
  const duplicateRevision = new AnalysisEventDecoder();
  duplicateRevision.push(`${row(summary)}\n${row(revision)}`);
  assert.throws(() => duplicateRevision.push(row(revision)), /重复的建议编号/);
});

test("validates every event and refuses a local-mode response from the AI", () => {
  assert.throws(() => new AnalysisEventDecoder().push('{"type":"summary","data":{"score":35}}'), /分析结果/);
  assert.throws(() => new AnalysisEventDecoder().push('{"type":"unrecognized"}'), /事件类型/);
  const local = structuredClone(summary);
  local.data.analysis_mode = "local";
  local.data.score = null;
  assert.throws(() => new AnalysisEventDecoder().push(row(local)), /分析模式/);
});

test("accepts AI null scores with an explanation while retaining strict AI stream mode", () => {
  const value = structuredClone(summary);
  value.data.score = null;
  value.data.dimensions[0].score = null;
  value.data.scope_note = "岗位描述未提供可核实的要求。";
  const decoder = new AnalysisEventDecoder();
  assert.deepEqual(Array.from(decoder.push(row(value))), [row(value)]);
  decoder.finish();
});

test("does not forward an upstream done before the API validates the whole stream", () => {
  const decoder = new AnalysisEventDecoder();
  assert.deepEqual(Array.from(decoder.push(`${row(summary)}\n{"type":"done"}`)), [row(summary)]);
  assert.throws(() => decoder.push(row(revision)), /结束后仍返回内容/);
  assert.throws(() => new AnalysisEventDecoder().push('{"type":"done"}'), /前置诊断摘要/);
});

test("reports model-supplied error events instead of completing successfully", () => {
  assert.throws(() => new AnalysisEventDecoder().push('{"type":"error","detail":"证据不足"}'), /证据不足/);
});

test("finish rejects empty, partial JSON and unclosed outer JSON strings", () => {
  for (const value of ["", " \n\t"]) {
    const decoder = new AnalysisEventDecoder();
    decoder.push(value);
    assert.throws(() => decoder.finish(), /结果为空/);
  }
  for (const value of [row(summary).slice(0, -1), `${row(summary)}\n{"type":"revision"`, JSON.stringify(row(summary)).slice(0, -1)]) {
    const decoder = new AnalysisEventDecoder();
    decoder.push(value);
    assert.throws(() => decoder.finish(), /接收不完整/);
  }
  const noSummary = new AnalysisEventDecoder();
  noSummary.push('""');
  assert.throws(() => noSummary.finish(), /缺少诊断摘要/);
});

test("rejects unrelated text, invalid quoted escapes and trailing garbage", () => {
  for (const value of ["not JSON", '"\\q"', '"\\uXXXX"', `${row(summary)}garbage`, `${JSON.stringify(row(summary))}tail`]) {
    assert.throws(() => new AnalysisEventDecoder().push(value), /格式/);
  }
});

test("SSE requires a proper transport ending even when the last JSON object is complete", () => {
  const decoder = new AnalysisSseDecoder();
  decoder.push(contentFrame(row(summary)));
  assert.throws(() => decoder.finish(), /连接提前结束/);
});

test("SSE accepts stop without DONE and DONE without a stop frame", () => {
  const stopped = new AnalysisSseDecoder();
  assert.deepEqual(Array.from(stopped.push(contentFrame(row(summary), "stop"))), [row(summary)]);
  assert.deepEqual(Array.from(stopped.finish()), []);
  const done = new AnalysisSseDecoder();
  done.push(contentFrame(row(summary)));
  done.push("data: [DONE]\n\n");
  assert.deepEqual(Array.from(done.finish()), []);
});

test("SSE flushes a final complete frame without a blank line", () => {
  const decoder = new AnalysisSseDecoder();
  decoder.push(frame({ choices: [{ message: { content: row(summary) }, finish_reason: "stop" }] }, ""));
  assert.deepEqual(Array.from(decoder.finish()), [row(summary)]);
});

test("SSE rejects a partial final JSON object even with DONE or stop", () => {
  for (const ending of ["data: [DONE]\n\n", contentFrame("", "stop")]) {
    const decoder = new AnalysisSseDecoder();
    decoder.push(contentFrame(`${row(summary)}\n{"type":"revision","data":`));
    decoder.push(ending);
    assert.throws(() => decoder.finish(), /接收不完整/);
  }
});

test("SSE rejects length and content filtering after a valid summary", () => {
  for (const [reason, message] of [["length", /长度限制/], ["content_filter", /被模型服务中止/], ["tool_calls", /没有正常完成/]]) {
    const decoder = new AnalysisSseDecoder();
    decoder.push(contentFrame(row(summary)));
    assert.throws(() => decoder.push(contentFrame("", reason)), message);
  }
});

test("SSE reports top-level provider errors before and after valid content", () => {
  for (const error of [{ message: "上游服务繁忙" }, "上游服务繁忙", null]) {
    const decoder = new AnalysisSseDecoder();
    decoder.push(contentFrame(row(summary)));
    assert.throws(() => decoder.push(frame({ error })), /模型服务返回错误/);
  }
});

test("SSE ignores comments and usage but rejects empty responses, malformed frames and content after termination", () => {
  const decoder = new AnalysisSseDecoder();
  decoder.push(": heartbeat\n\n");
  decoder.push(contentFrame(row(summary), "stop"));
  decoder.push(frame({ choices: [], usage: { completion_tokens: 100 } }));
  decoder.push("data: [DONE]\n\n");
  assert.deepEqual(Array.from(decoder.finish()), []);
  const empty = new AnalysisSseDecoder();
  empty.push("data: [DONE]\n\n");
  assert.throws(() => empty.finish(), /结果为空/);
  assert.throws(() => new AnalysisSseDecoder().push("data: {broken}\n\n"), /格式/);
  const trailing = new AnalysisSseDecoder();
  trailing.push(contentFrame(row(summary), "stop"));
  assert.throws(() => trailing.push(contentFrame(row(revision))), /结束后仍返回内容/);
});

test("accepts six unique suggestions and rejects a seventh before generation can be offered", () => {
  const decoder = new AnalysisEventDecoder();
  decoder.push(row(summary));
  for (let index = 0; index < 6; index++) {
    const value = structuredClone(revision);
    value.data.id = `revision-${index}`;
    assert.deepEqual(Array.from(decoder.push(row(value))), [row(value)]);
  }
  assert.deepEqual(Array.from(decoder.finish()), []);
  const overflow = new AnalysisEventDecoder();
  overflow.push(row(summary));
  for (let index = 0; index < 6; index++) {
    const value = structuredClone(revision); value.data.id = `revision-${index}`;
    overflow.push(row(value));
  }
  const seventh = structuredClone(revision); seventh.data.id = "revision-6";
  assert.throws(() => overflow.push(row(seventh)), /超过 6 条/);
});
