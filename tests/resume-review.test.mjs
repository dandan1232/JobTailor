import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/resume-review.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { reviewResumeChanges } = exports;

test("flags new numbers and terms without duplicating unchanged facts or casing", () => {
  const result = reviewResumeChanges("使用 Python，性能提升 42%，3年经验", "使用 PYTHON 和 Redis，性能提升 80%，3年经验，Redis 缓存");
  assert.deepEqual(Array.from(result.addedNumbers), ["80%"]);
  assert.deepEqual(Array.from(result.addedTerms), ["Redis"]);
});

test("marks changed experience lines while retaining unchanged or moved lines", () => {
  const result = reviewResumeChanges("姓名\n项目A\n项目B", "项目B\n姓名\n项目A：负责带领团队");
  assert.deepEqual(Array.from(result.lines, (line) => line.changed), [false, false, true]);
  assert.equal(result.lines[2].text, "项目A：负责带领团队");
  assert.equal(result.originalLines[1].changed, true);
  assert.equal(result.originalLines[2].changed, false);
});

test("also marks deleted experience so the original facts stay visible during review", () => {
  const result = reviewResumeChanges("姓名\n重要项目成果", "姓名");
  assert.equal(result.lines[0].changed, false);
  assert.equal(result.originalLines[1].changed, true);
});

test("marks an added or removed occurrence even when another identical line remains", () => {
  const original = "姓名\n负责 Python 服务\n负责 Python 服务";
  const revised = "姓名\n负责 Python 服务";
  assert.deepEqual(Array.from(reviewResumeChanges(original, revised).originalLines, (line) => line.changed), [false, false, true]);
  assert.deepEqual(Array.from(reviewResumeChanges(revised, original).lines, (line) => line.changed), [false, false, true]);
});

test("handles C++ and C# terms, repeated numbers, empty text and literal markup safely", () => {
  const result = reviewResumeChanges("", "使用 C++ 和 C#，100%，100%\n<script>文字</script>");
  assert.deepEqual(Array.from(result.addedNumbers), ["100%"]);
  assert.ok(result.addedTerms.includes("C++"));
  assert.ok(result.addedTerms.includes("C#"));
  assert.equal(result.lines[1].text, "<script>文字</script>");
  assert.equal(reviewResumeChanges("", "").lines[0].changed, false);
});
