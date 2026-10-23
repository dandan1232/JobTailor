import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/analysis.ts', import.meta.url), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject });
const { analyzeResume } = exportsObject;
const requirement = (result, label) => result.requirements.find((item) => item.label === label);

test('JavaScript and larger English words do not count as Java evidence', () => {
  const java = analyzeResume('使用 JavaScript 开发页面与交互组件', '后端工程师\n必须熟悉 Java');
  assert.equal(requirement(java, 'Java').status, 'missing');
  assert.equal(java.matched.length, 0);

  const frontend = analyzeResume('熟悉 JavaScript，负责 Reactivity 页面组件', '前端工程师\n熟悉 JavaScript 和 Reactivity');
  assert.deepEqual(Array.from(frontend.requirements, (item) => item.label), ['JavaScript']);
  assert.equal(requirement(frontend, 'JavaScript').status, 'pass');
});

test('common aliases and punctuation map to the complete canonical skill names', () => {
  const resume = '使用 k8s、Postgres、NodeJS、TS、SpringBoot、Vue.js、ReactJS 开发和部署服务';
  const job = '全栈工程师\n熟悉 Kubernetes、PostgreSQL、Node.js、TypeScript、Spring Boot、Vue、React';
  const result = analyzeResume(resume, job);
  assert.equal(result.requirements.length, 7);
  assert.ok(result.requirements.every((item) => item.status === 'pass'));
  assert.ok(!result.requirements.some((item) => item.label === 'JavaScript'));
  assert.ok(result.matched.every((item) => item.evidence === resume));

  const js = analyzeResume('使用 Node.js 开发服务接口', '前端工程师\n熟悉 JavaScript');
  assert.equal(requirement(js, 'JavaScript').status, 'missing');
});

test('an alternative group is satisfied by one skill without inventing the other gap', () => {
  const resume = '张三\n使用 FastAPI 开发订单接口\n负责接口维护';
  const grouped = analyzeResume(resume, '后端工程师\n熟悉 FastAPI 或 Django');
  const single = analyzeResume(resume, '后端工程师\n熟悉 FastAPI');
  assert.equal(grouped.requirements.length, 1);
  assert.equal(requirement(grouped, 'FastAPI 或 Django').status, 'pass');
  assert.equal(grouped.gaps.length, 0);
  assert.equal(grouped.score, single.score);
  assert.equal(grouped.dimensions[0].score, 100);
  assert.deepEqual(Array.from(grouped.matched, (item) => item.skill), ['FastAPI']);
});

test('an unmet alternative group is one missing requirement', () => {
  const result = analyzeResume('使用 Python 维护数据处理脚本', '后端工程师\n熟悉 FastAPI 或 Django');
  assert.equal(result.requirements.length, 1);
  assert.equal(requirement(result, 'FastAPI 或 Django').status, 'missing');
  assert.deepEqual(Array.from(result.gaps, (item) => item.skill), ['FastAPI 或 Django']);
});

test('explicit choose-one lists and English or clauses form one requirement', () => {
  const chosen = analyzeResume('使用 SpringBoot 开发订单系统', '后端工程师\nFastAPI、Django、Spring Boot 中任意一种项目经验');
  assert.equal(chosen.requirements.length, 1);
  assert.equal(chosen.requirements[0].status, 'pass');
  assert.equal(chosen.gaps.length, 0);

  const english = analyzeResume('Built APIs using Django', 'Backend engineer\nRequirements: FastAPI or Django. AWS preferred.');
  assert.equal(requirement(english, 'FastAPI 或 Django').status, 'pass');
  assert.equal(requirement(english, 'AWS').importance, 'preferred');
  assert.equal(english.gaps.length, 0);
});

test('comma-separated choose-one lists stay grouped without absorbing an adjacent bonus', () => {
  const resume = '张三\n使用 Django 开发订单接口\n负责接口维护';
  const single = analyzeResume(resume, '后端工程师\n熟悉 Django');
  for (const comma of [',', '，']) {
    for (const job of [
      `后端工程师\n熟悉 FastAPI${comma} Django${comma} Spring Boot 中任意一种框架${comma} AWS 使用经验优先`,
      `后端工程师\none of FastAPI${comma} Django${comma} Spring Boot${comma} AWS preferred`,
    ]) {
      const result = analyzeResume(resume, job);
      assert.equal(result.requirements.length, 2);
      assert.equal(requirement(result, 'FastAPI 或 Django 或 Spring Boot').status, 'pass');
      assert.equal(requirement(result, 'AWS').importance, 'preferred');
      assert.equal(requirement(result, 'AWS').status, 'missing');
      assert.equal(result.gaps.length, 0);
      assert.equal(result.score, single.score);
    }
  }
});

test('explicitly denied skills do not become matching evidence or claimed summary experience', () => {
  for (const denial of ['未使用过 Java', '不熟悉Java', '没有 Java 经验', 'Java 从未使用过', 'Java 项目经验为零', 'never used Java', 'not familiar with Java']) {
    const result = analyzeResume(`张三\n${denial}，主要负责 Python 数据处理\n工作经验 3 年`, '后端工程师\n必须熟悉 Java 和 Python');
    assert.equal(requirement(result, 'Java').status, 'missing', denial);
    assert.equal(requirement(result, 'Python').status, 'pass', denial);
    assert.deepEqual(Array.from(result.matched, (item) => item.skill), ['Python']);
    assert.deepEqual(Array.from(result.gaps, (item) => item.skill), ['Java']);
    assert.doesNotMatch(result.revisions[0].revised, /Java/);
    assert.match(result.revisions[0].revised, /已有经历涉及Python/);
  }
});

test('a denial stops at a new affirmative assertion and can cover a pure skill list', () => {
  for (const description of ['不熟悉Java但有Python开发经验', '不熟悉 Java，但是使用 Python 开发服务', '不熟悉 Java、Django，但有 Python 项目经验', 'Java、Django 均未使用过，但有 Python 项目经验']) {
    const result = analyzeResume(`张三\n${description}\n负责数据处理`, '后端工程师\n必须熟悉 Java、Django 和 Python');
    assert.equal(requirement(result, 'Java').status, 'missing', description);
    assert.equal(requirement(result, 'Django').status, 'missing', description);
    assert.equal(requirement(result, 'Python').status, 'pass', description);
    assert.deepEqual(Array.from(result.matched, (item) => item.skill), ['Python']);
  }
});

test('positive evidence remains usable after an earlier denial and unrelated empty fields', () => {
  const resume = '张三\n早期未使用过 Java\n后来使用 Java 开发订单服务\n证书：无\nPython 数据处理项目';
  const result = analyzeResume(resume, '后端工程师\n必须熟悉 Java 和 Python');
  assert.equal(requirement(result, 'Java').status, 'pass');
  assert.equal(requirement(result, 'Java').evidence, '后来使用 Java 开发订单服务');
  assert.equal(requirement(result, 'Python').status, 'pass');
  assert.equal(result.gaps.length, 0);
});

test('AWS preferred does not turn adjacent required skills into bonuses or reduce their score', () => {
  const resume = '张三\n使用 Docker 和 K8s 部署服务\n负责日常维护';
  const result = analyzeResume(resume, '后端工程师\n熟悉 Docker、Kubernetes，有 AWS 使用经验优先');
  assert.equal(requirement(result, 'Docker').importance, 'required');
  assert.equal(requirement(result, 'Kubernetes').importance, 'required');
  assert.equal(requirement(result, 'AWS').importance, 'preferred');
  assert.equal(requirement(result, 'AWS').status, 'missing');
  assert.equal(result.gaps.length, 0);
  assert.equal(result.score, analyzeResume(resume, '后端工程师\n熟悉 Docker、Kubernetes').score);
  assert.equal(result.score, analyzeResume(`${resume}，另使用 AWS`, '后端工程师\n熟悉 Docker、Kubernetes，有 AWS 使用经验优先').score);
});

test('preferred sections inherit across lines and required sections reset their importance', () => {
  const job = '后端工程师\n加分项：\nAWS\nK8s\n必需技能：\nPython\nDocker';
  const result = analyzeResume('使用 Python 和 Docker 开发服务', job);
  assert.deepEqual(Array.from(result.requirements, (item) => [item.label, item.importance]), [
    ['Python', 'required'], ['Docker', 'required'], ['AWS', 'preferred'], ['Kubernetes', 'preferred'],
  ]);
  assert.equal(result.gaps.length, 0);
});

test('a skill mentioned as required and preferred is deduplicated as required', () => {
  const result = analyzeResume('具备云服务部署经验', '后端工程师\n加分项：AWS\n任职要求：\n熟悉 Amazon Web Services');
  assert.equal(result.requirements.length, 1);
  assert.equal(requirement(result, 'AWS').importance, 'required');
  assert.deepEqual(Array.from(result.gaps, (item) => item.skill), ['AWS']);
});

test('required skills stay ahead of bonuses without hiding later recognized requirements', () => {
  const result = analyzeResume('使用 Python 开发服务', '后端工程师\nAWS 优先\n熟悉 Python、FastAPI、Docker、Redis、PostgreSQL、Kubernetes、MySQL');
  assert.equal(result.requirements.length, 8);
  assert.ok(result.requirements.slice(0, 7).every((item) => item.importance === 'required'));
  assert.equal(result.requirements.at(-1).label, 'AWS');
  assert.equal(result.requirements.at(-1).importance, 'preferred');
});

test('unsupported jobs have no numeric score and explain the limited local scope', () => {
  const result = analyzeResume('负责品牌活动策划、用户调研与内容制作', '市场运营专员\n负责用户研究、活动策划与品牌传播');
  assert.equal(result.score, null);
  assert.ok(result.dimensions.every((item) => item.score === null));
  assert.equal(result.requirements.length, 0);
  assert.equal(result.gaps.length, 0);
  assert.match(result.scope_note, /有限技能词表/);
  assert.match(result.verdict, /不足以判断/);
});

test('bonuses alone preserve their status without becoming a low match score', () => {
  const result = analyzeResume('负责品牌活动策划与用户研究', '运营专员\nAWS 使用经验优先');
  assert.equal(result.score, null);
  assert.ok(result.dimensions.every((item) => item.score === null));
  assert.equal(requirement(result, 'AWS').status, 'missing');
  assert.equal(requirement(result, 'AWS').importance, 'preferred');
  assert.equal(result.gaps.length, 0);
  assert.match(result.scope_note, /仅识别到加分技能/);
});
