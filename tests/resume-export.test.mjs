import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fontFile = "node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff";
const content = "陈默｜Python 后端工程师｜3 年经验\n\n项目经历\n• 使用 FastAPI 重构订单服务，接口响应时间降低 42%\n• 优化 PostgreSQL 慢查询，报表生成时间从 18 秒降至 6 秒\n教育经历：厦门大学\n联系邮箱：resume@example.com";
const source = readFileSync(join(root, "app/api/resume/export/route.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function loadRoute(readFont = readFile, platform = process.platform) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Buffer, Response, Uint8Array,
    process: { cwd: () => root, platform },
    require: (name) => name === "node:fs/promises" ? { readFile: readFont } : require(name),
  });
  return exports.POST;
}

function exportRequest(format) {
  return new Request("http://localhost/api/resume/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, format, filename: "中文简历.pdf" }),
  });
}

const compact = (text) => text.replace(/\s/g, "");

test("PDF exports preserve Chinese, English and numbers using the bundled font on Windows and Linux", async () => {
  for (const platform of ["win32", "linux"]) {
    const fontPaths = [];
    const post = loadRoute(async (path) => {
      fontPaths.push(path);
      return readFile(path);
    }, platform);
    const response = await post(exportRequest("pdf"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/pdf");
    assert.match(response.headers.get("Content-Disposition"), new RegExp(encodeURIComponent("中文简历-优化版.pdf")));
    assert.deepEqual(fontPaths, [join(root, fontFile)]);
    const parser = new PDFParse({ data: new Uint8Array(await response.arrayBuffer()) });
    try {
      const result = await parser.getText({ pageJoiner: "" });
      assert.equal(compact(result.text), compact(content));
    } finally {
      await parser.destroy();
    }
  }
});

test("a missing deployment font gives a clear error without using a machine font", async () => {
  const paths = [];
  const post = loadRoute(async (path) => {
    paths.push(path);
    throw Object.assign(new Error("ENOENT: missing font"), { code: "ENOENT" });
  }, "win32");
  const response = await post(exportRequest("pdf"));
  assert.equal(response.status, 500);
  assert.equal((await response.json()).detail, "PDF 导出字体不可用，请联系维护者检查部署文件。");
  assert.deepEqual(paths, [join(root, fontFile)]);
});

test("DOCX export keeps the current text and does not depend on the PDF font", async () => {
  const post = loadRoute(async () => { throw new Error("DOCX must not load a PDF font"); });
  const response = await post(exportRequest("docx"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.match(response.headers.get("Content-Disposition"), new RegExp(encodeURIComponent("中文简历-优化版.docx")));
  const result = await mammoth.extractRawText({ buffer: Buffer.from(await response.arrayBuffer()) });
  assert.equal(compact(result.value), compact(content));
});

test("standalone tracing explicitly includes the font used by PDF export", () => {
  const configSource = readFileSync(join(root, "next.config.ts"), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(configSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports });
  const included = exports.default.outputFileTracingIncludes["/api/resume/export"];
  assert.ok(included.includes(`./${fontFile}`), "the PDF font must be copied into standalone deployments");
  assert.ok(readFileSync(join(root, fontFile)).length > 0, "the traced font must exist in the installed package");
});
