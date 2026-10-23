import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/analysis-validation.ts", import.meta.url), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { parseAnalysisEvent } = exports;
const summary = () => ({ type: "summary", data: {
  analysis_mode: "ai", score: 75, verdict: "已有 Python 证据，AWS 需要确认。",
  dimensions: ["关键词覆盖", "经历证据", "岗位相关性", "表达清晰度"].map((name) => ({ name, score: 75, note: "根据简历原文核对。" })),
  requirements: [{ label: "Python", status: "pass", evidence: "使用 Python 开发 API。", importance: "required" }],
  matched: [{ skill: "Python", evidence: "使用 Python 开发 API。" }],
  gaps: [{ skill: "AWS", suggestion: "补充真实项目证据，否则保留缺口。" }],
} });
const revision = () => ({ type: "revision", data: {
  id: "project-focus", priority: "高", category: "项目经历", title: "聚焦开发动作",
  original: "使用 Python 开发 API。", revised: "开发基于 Python 的 API。", reason: "让已有事实表达更清楚。",
} });
const plain = (value) => JSON.parse(JSON.stringify(value));

test("accepts complete AI summaries and defaults an omitted mode to AI", () => {
  const value = summary();
  assert.deepEqual(plain(parseAnalysisEvent(value)), value);
  delete value.data.analysis_mode;
  assert.equal(parseAnalysisEvent(value).data.analysis_mode, "ai");
});

test("allows explicit local null scores, scope notes and up to 32 recognized requirements", () => {
  const value = summary();
  value.data.analysis_mode = "local";
  value.data.score = null;
  value.data.dimensions.forEach((dimension) => { dimension.score = null; });
  value.data.scope_note = "本地规则只识别有限技术关键词。";
  for (const field of ["requirements", "matched", "gaps"]) value.data[field] = Array.from({ length: 32 }, () => value.data[field][0]);
  assert.deepEqual(plain(parseAnalysisEvent(value)), value);
  value.data.requirements.push(value.data.requirements[0]);
  assert.throws(() => parseAnalysisEvent(value), /岗位要求/);
});

test("rejects non-integer, out-of-range or missing AI scores", () => {
  for (const score of [null, undefined, "75", -1, 101, 75.5, NaN, Infinity]) {
    const value = summary();
    value.data.score = score;
    assert.throws(() => parseAnalysisEvent(value), /匹配分数/);
  }
  for (const score of [0, 100]) {
    const value = summary(); value.data.score = score;
    assert.equal(parseAnalysisEvent(value).data.score, score);
  }
});

test("allows unavailable AI scores only when a nonempty scope note explains the limitation", () => {
  const value = summary();
  value.data.score = null;
  value.data.dimensions[0].score = null;
  value.data.scope_note = "岗位要求不足，无法可靠评估匹配程度。";
  assert.deepEqual(plain(parseAnalysisEvent(value)), value);
  delete value.data.scope_note;
  assert.throws(() => parseAnalysisEvent(value), /分析结果/);
  value.data.score = 75;
  assert.throws(() => parseAnalysisEvent(value), /维度分数/);
});

test("requires exactly four fully described dimensions with valid scores", () => {
  for (const dimensions of [null, [], new Array(4), summary().data.dimensions.slice(0, 3), [...summary().data.dimensions, summary().data.dimensions[0]]]) {
    const value = summary(); value.data.dimensions = dimensions;
    assert.throws(() => parseAnalysisEvent(value), /分析维度/);
  }
  for (const [field, invalid] of [["name", " "], ["note", undefined], ["score", null], ["score", 100.5]]) {
    const value = summary(); value.data.dimensions[0][field] = invalid;
    assert.throws(() => parseAnalysisEvent(value), /维度/);
  }
});

test("rejects malformed or oversized AI requirement, evidence and gap arrays", () => {
  for (const field of ["requirements", "matched", "gaps"]) {
    for (const invalid of [null, undefined, {}, [null], ["text"], Array.from({ length: 13 }, () => summary().data[field][0])]) {
      const value = summary(); value.data[field] = invalid;
      assert.throws(() => parseAnalysisEvent(value), /分析结果/);
    }
    const empty = summary(); empty.data[field] = [];
    assert.equal(parseAnalysisEvent(empty).data[field].length, 0);
  }
});

test("validates coverage states, importance and every evidence field", () => {
  for (const [field, invalid] of [["label", ""], ["status", "covered"], ["evidence", []], ["importance", "optional"]]) {
    const value = summary(); value.data.requirements[0][field] = invalid;
    assert.throws(() => parseAnalysisEvent(value), /分析结果/);
  }
  for (const [array, field] of [["matched", "skill"], ["matched", "evidence"], ["gaps", "skill"], ["gaps", "suggestion"]]) {
    const value = summary(); delete value.data[array][0][field];
    assert.throws(() => parseAnalysisEvent(value), /分析结果/);
  }
  const preferred = summary(); preferred.data.requirements[0].importance = "preferred";
  assert.equal(parseAnalysisEvent(preferred).data.requirements[0].importance, "preferred");
});

test("requires a nonempty verdict and validates optional mode and scope notes", () => {
  for (const [field, invalid] of [["verdict", " "], ["verdict", 0], ["analysis_mode", null], ["analysis_mode", "preview"], ["scope_note", " "]]) {
    const value = summary(); value.data[field] = invalid;
    assert.throws(() => parseAnalysisEvent(value), /分析结果/);
  }
});

test("accepts replacement and reminder revisions but requires all fields and a valid priority", () => {
  assert.deepEqual(plain(parseAnalysisEvent(revision())), revision());
  for (const kind of ["replacement", "reminder"]) {
    const value = revision(); value.data.kind = kind;
    assert.equal(parseAnalysisEvent(value).data.kind, kind);
  }
  for (const field of ["id", "category", "title", "original", "revised", "reason"]) {
    for (const invalid of [undefined, " ", 7]) {
      const value = revision(); value.data[field] = invalid;
      assert.throws(() => parseAnalysisEvent(value), /分析结果/);
    }
  }
  for (const [field, invalid] of [["priority", "紧急"], ["kind", "generated"]]) {
    const value = revision(); value.data[field] = invalid;
    assert.throws(() => parseAnalysisEvent(value), /分析结果/);
  }
});

test("accepts only known event types and requires a useful error message", () => {
  assert.deepEqual(plain(parseAnalysisEvent({ type: "done" })), { type: "done" });
  assert.deepEqual(plain(parseAnalysisEvent({ type: "error", detail: "模型服务繁忙。" })), { type: "error", detail: "模型服务繁忙。" });
  for (const value of [null, [], "summary", {}, { type: "unknown" }, { type: "summary" }, { type: "revision", data: [] }, { type: "error", detail: " " }]) {
    assert.throws(() => parseAnalysisEvent(value), /分析结果/);
  }
});

test("revision field lengths match the generation API limits, including exact boundaries", () => {
  for (const [field, maximum] of [["id", 100], ["category", 100], ["title", 200], ["original", 30_000], ["revised", 60_000], ["reason", 2_000]]) {
    const value = revision();
    value.data[field] = "字".repeat(maximum);
    assert.equal(parseAnalysisEvent(value).data[field].length, maximum);
    value.data[field] += "字";
    assert.throws(() => parseAnalysisEvent(value), new RegExp(`超过 ${maximum} 字`));
  }
});
