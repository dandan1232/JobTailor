import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Load the actual implementation; prevent external model calls in regression tests.
const source = readFileSync(new URL('../lib/resume-editor.ts', import.meta.url), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: exportsObject, Response,
  require: () => ({ aiIsConfigured: () => true }),
  fetch: () => { throw new Error('Generation must not rewrite approved suggestions'); },
});
const { generateResumeStream } = exportsObject;
const revision = (original, revised) => ({ id: original, title: '测试建议', original, revised });

test('approved AI copy replaces the original in place and preserves other facts', async () => {
  const result = await generateResumeStream('姓名\n旧项目表达\n教育经历', [revision('旧项目表达', '明确的项目成果')]).text();
  assert.equal(result, '姓名\n明确的项目成果\n教育经历');
  assert.ok(!result.includes('旧项目表达'));
});

test('PDF whitespace differences do not cause append-only changes', async () => {
  const result = await generateResumeStream('项目\n使用 FastAPI\r\n开发 API\n教育经历', [revision('使用FastAPI开发API', '使用 FastAPI 开发订单接口')]).text();
  assert.equal(result, '项目\n使用 FastAPI 开发订单接口\n教育经历');
});

test('multiple replacements use original positions, not previously inserted text', async () => {
  const result = await generateResumeStream('第一段\n第二段', [revision('第一段', '包含第二段的新文字'), revision('第二段', '新的第二部分')]).text();
  assert.equal(result, '包含第二段的新文字\n新的第二部分');
});

test('missing, ambiguous and overlapping targets fail instead of reporting success', () => {
  assert.throws(() => generateResumeStream('项目经历', [revision('缺少摘要', '添加摘要')]), /无法定位/);
  assert.throws(() => generateResumeStream('开发\n开发', [revision('开发', '改写')]), /多处原文/);
  assert.throws(() => generateResumeStream('开发订单系统', [revision('开发订单', '改写'), revision('订单系统', '改写')]), /重叠/);
});
