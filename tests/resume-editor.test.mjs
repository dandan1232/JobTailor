import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Load the actual implementation; prevent external model calls in regression tests.
const analysisSource = readFileSync(new URL('../lib/analysis.ts', import.meta.url), 'utf8');
const analysisExports = {};
vm.runInNewContext(ts.transpileModule(analysisSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: analysisExports });
const { analyzeResume } = analysisExports;

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

test('all replacement suggestions from the local sample can be applied together', async () => {
  const resume = `陈默｜Python 后端工程师｜3 年经验

电商订单系统
• 使用 FastAPI 重构订单服务 API，拆分核心模块并补充自动化测试
• 引入 Redis 缓存热点商品数据，接口响应时间降低 42%
• 使用 PostgreSQL 优化慢查询，订单报表生成时间从 18 秒降至 6 秒
• 通过 Docker 统一开发和部署环境，协助 4 人团队完成版本交付`;
  const job = `岗位：Python 后端工程师

职责要求：
1. 负责核心业务服务的设计、开发与维护
2. 熟练掌握 Python，具有 FastAPI 或 Django 项目经验
3. 熟悉 PostgreSQL、Redis 和微服务架构
4. 熟悉 Docker、Kubernetes，有 AWS 使用经验优先
5. 具备良好的团队协作和问题定位能力`;
  const analysis = analyzeResume(resume, job);
  const replacements = analysis.revisions.filter((item) => item.kind !== 'reminder');
  assert.equal(replacements.length, 1);
  const summary = replacements[0];
  const content = await generateResumeStream(resume, replacements).text();
  assert.equal(content, resume.replace(summary.original, summary.revised));
  assert.ok(content.includes('面向Python 后端工程师岗位'));
  assert.ok(!content.includes('围绕业务目标说明'));
  assert.equal(analysis.revisions.find((item) => item.id === 'project-result').kind, 'reminder');
  assert.equal(analysis.revisions.find((item) => item.id === 'skill-gap').kind, 'reminder');
});

test('missing skills, project guidance and missing results remain reminders', async () => {
  const resume = '张三\n使用 Python 开发订单接口\n负责日常维护与需求沟通';
  const analysis = analyzeResume(resume, '后端工程师\n熟悉 Python 和 Docker，负责订单服务的开发与维护');
  for (const id of ['skill-gap', 'project-result', 'quantify-impact']) {
    assert.equal(analysis.revisions.find((item) => item.id === id).kind, 'reminder');
  }
  const content = await generateResumeStream(resume, analysis.revisions.filter((item) => item.kind !== 'reminder')).text();
  assert.ok(content.includes('已有经历涉及Python'));
  assert.ok(!content.includes('Docker'));
  assert.ok(!content.includes('有真实记录时'));
});

test('reminders cannot be applied even when their source text exists', () => {
  assert.throws(() => generateResumeStream('原项目经历', [{
    ...revision('原项目经历', '请补充真实结果'), kind: 'reminder',
  }]), /待补充提醒/);
});

test('generation refuses combined output that could not be edited or exported', () => {
  assert.throws(() => generateResumeStream('第一段\n第二段', [revision('第一段', '字'.repeat(40_000)), revision('第二段', '字'.repeat(30_000))]), /60000/);
});

test('repeated opening text never produces an ambiguous replacement', () => {
  for (const resume of ['张三\n使用 Python 开发接口\n张三', '张 三\n使用 Python 开发接口\n张三']) {
    const analysis = analyzeResume(resume, '后端工程师\n熟悉 Python，负责业务服务开发与维护');
    assert.equal(analysis.revisions.find((item) => item.id === 'summary-focus').kind, 'reminder');
    assert.equal(analysis.revisions.filter((item) => item.kind !== 'reminder').length, 0);
  }
});

test('single-line resumes without matched skills keep their facts without invented experience', async () => {
  const resume = '负责品牌活动策划与用户调研，整理活动反馈并推动跨部门协作，跟进活动执行与复盘';
  const analysis = analyzeResume(resume, '市场运营专员\n负责品牌活动策划、用户调研、内容制作与社群维护');
  assert.equal(analysis.matched.length, 0);
  const replacements = analysis.revisions.filter((item) => item.kind !== 'reminder');
  assert.equal(replacements.length, 1);
  const content = await generateResumeStream(resume, replacements).text();
  assert.equal(content, `${resume}\n面向市场运营专员岗位。`);
  assert.ok(!content.includes('已有经历涉及'));
  assert.ok(!content.includes('相关技术'));
});

test('blank lines and CRLF around the opening do not duplicate indentation or lose facts', async () => {
  const resume = '\r\n  张三  \r\n\r\n使用 Python 开发接口\r\n负责维护订单系统';
  const analysis = analyzeResume(resume, '后端工程师\n熟悉 Python，负责业务服务开发与维护');
  const replacements = analysis.revisions.filter((item) => item.kind !== 'reminder');
  const content = await generateResumeStream(resume, replacements).text();
  assert.equal(content, '\r\n  张三\n面向后端工程师岗位，已有经历涉及Python。  \r\n\r\n使用 Python 开发接口\r\n负责维护订单系统');
});
