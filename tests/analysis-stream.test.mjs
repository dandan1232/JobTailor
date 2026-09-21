import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/analysis-stream.ts", import.meta.url), "utf8");
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject });
const { AnalysisEventDecoder, AnalysisSseDecoder } = exportsObject;

const summary = { type: "summary", data: { score: 35, verdict: "匹配度较低" } };
const revision = { type: "revision", data: { id: "add_ai_skill", title: "补充技能" } };

test("emits each raw JSON object as soon as its closing brace arrives", () => {
  const decoder = new AnalysisEventDecoder();
  assert.deepEqual(Array.from(decoder.push(JSON.stringify(summary).slice(0, 20))), []);
  assert.deepEqual(Array.from(decoder.push(`${JSON.stringify(summary).slice(20)}\n${JSON.stringify(revision)}`)), [
    JSON.stringify(summary),
    JSON.stringify(revision),
  ]);
});

test("incrementally decodes a JSON-string encoded NDJSON response", () => {
  const decoder = new AnalysisEventDecoder();
  const encoded = JSON.stringify(`${JSON.stringify(summary)}\n${JSON.stringify(revision)}`);
  const splitAfterSummary = encoded.indexOf("\\n") + 2;
  assert.deepEqual(Array.from(decoder.push(encoded.slice(0, splitAfterSummary))), [JSON.stringify(summary)]);
  assert.deepEqual(Array.from(decoder.push(encoded.slice(splitAfterSummary))), [JSON.stringify(revision)]);
});

test("handles CRLF SSE frames and arbitrary network chunk boundaries", () => {
  const decoder = new AnalysisSseDecoder();
  const firstFrame = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(summary) } }] })}\r\n\r\n`;
  const secondFrame = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(revision) } }] })}\n\n`;
  const wire = firstFrame + secondFrame;
  const rows = [
    ...decoder.push(wire.slice(0, 17)),
    ...decoder.push(wire.slice(17, firstFrame.length + 11)),
    ...decoder.push(wire.slice(firstFrame.length + 11)),
    ...decoder.finish(),
  ];
  assert.deepEqual(rows, [JSON.stringify(summary), JSON.stringify(revision)]);
});
