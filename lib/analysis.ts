export type Dimension = { name: string; score: number; note: string };
export type Requirement = { label: string; status: "pass" | "missing"; evidence: string };
export type Evidence = { skill: string; evidence: string };
export type Gap = { skill: string; suggestion: string };
export type Revision = {
  id: string;
  priority: "高" | "中" | "低";
  category: string;
  title: string;
  original: string;
  revised: string;
  reason: string;
};

export type AnalyzeResult = {
  analysis_mode: "ai" | "local";
  score: number;
  verdict: string;
  dimensions: Dimension[];
  requirements: Requirement[];
  matched: Evidence[];
  gaps: Gap[];
  revisions: Revision[];
};

const SKILLS = [
  "Python", "FastAPI", "Django", "PostgreSQL", "MySQL", "Redis", "Docker",
  "Kubernetes", "AWS", "React", "TypeScript", "Java", "Spring Boot", "Vue",
  "Node.js", "微服务", "高并发", "团队协作",
];

const fragments = (text: string) => text.split(/[\n。；;]/).map((part) => part.trim().replace(/^[-•*\s]+/, "")).filter(Boolean);
const hasSkill = (text: string, skill: string) => text.toLocaleLowerCase().includes(skill.toLocaleLowerCase());
const evidenceFor = (resume: string, skill: string) => fragments(resume).find((part) => hasSkill(part, skill)) ?? "简历中未找到直接证据";

function buildRevisions(resume: string, role: string, matched: string[], gaps: string[]): Revision[] {
  const projectLine = fragments(resume).find((line) => /\d/.test(line)) ?? fragments(resume)[0] ?? "尚未识别到可用项目描述";
  const skillSummary = matched.slice(0, 4).join("、") || "相关技术";
  const revisions: Revision[] = [
    {
      id: "summary-focus", priority: "高", category: "个人摘要", title: "让开头直接回应目标岗位",
      original: "简历开头缺少针对当前岗位的能力定位。",
      revised: `面向${role}岗位，具备${skillSummary}等相关经验，能够独立推进服务开发、问题定位与交付。`,
      reason: "招聘方通常先扫描顶部摘要。先说明岗位方向和已有证据，能更快建立相关性。",
    },
    {
      id: "project-result", priority: "中", category: "项目经历", title: "把项目描述改成动作与结果",
      original: projectLine,
      revised: `围绕业务目标说明具体动作、技术选择和可验证结果。原始证据：${projectLine}`,
      reason: "只罗列职责很难判断贡献大小，动作、技术选择和结果更容易被追问和验证。",
    },
  ];
  if (gaps.length) {
    const missing = gaps.slice(0, 3).join("、");
    revisions.splice(1, 0, {
      id: "skill-gap", priority: "高", category: "技能缺口", title: `确认 ${missing} 是否有真实证据`,
      original: `JD 要求 ${missing}，当前简历没有找到直接证据。`,
      revised: `如果真实使用过 ${missing}，补充对应项目、职责和结果；如果没有，不要为了匹配度强行加入。`,
      reason: "缺少证据的关键词容易在面试追问时失真，这里应补真实经历，而不是补漂亮话。",
    });
  }
  if (!fragments(resume).some((line) => /%|\d+\s*(秒|人|次|万|小时|天)/.test(line))) {
    revisions.push({
      id: "quantify-impact", priority: "中", category: "结果表达", title: "补充可核实的结果",
      original: "多数经历没有结果数据或明确影响。",
      revised: "有真实记录时补充性能、效率、规模或交付结果；没有准确数字时使用定性结果，不要编造。",
      reason: "结果证据能区分‘参与过’和‘真正产生过影响’。",
    });
  }
  return revisions;
}

export function analyzeResume(resumeText: string, jobDescription: string): AnalyzeResult {
  const role = fragments(jobDescription).slice(0, 4).map((line) => line.replace(/^(岗位|职位|招聘职位|Job Title)\s*[:：]?\s*/i, "")).find((line) => line.length >= 2 && line.length <= 40) ?? "目标岗位";
  const requirements = SKILLS.filter((skill) => hasSkill(jobDescription, skill));
  const matched = requirements.filter((skill) => hasSkill(resumeText, skill));
  const gaps = requirements.filter((skill) => !matched.includes(skill));
  const coverage = matched.length / Math.max(requirements.length, 1);
  const hasNumbers = /\d/.test(resumeText);
  const hasBullets = resumeText.split("\n").length >= 3;
  const keywordScore = Math.round(coverage * 100);
  const evidenceScore = Math.min(58 + (hasNumbers ? 18 : 0) + matched.length * 4, 96);
  const relevanceScore = Math.min(45 + Math.round(coverage * 45) + (role !== "目标岗位" ? 8 : 0), 96);
  const clarityScore = hasBullets ? 84 : 66;
  const score = Math.round(keywordScore * 0.35 + evidenceScore * 0.3 + relevanceScore * 0.2 + clarityScore * 0.15);

  return {
    analysis_mode: "local", score,
    verdict: score >= 70 ? "匹配基础较好，优先补齐高优先级证据后再投递。" : "存在明显要求缺口，建议先核实真实经历并调整表达。",
    dimensions: [
      { name: "关键词覆盖", score: keywordScore, note: `命中 ${matched.length}/${requirements.length} 项识别要求` },
      { name: "经历证据", score: evidenceScore, note: "检查技能是否有项目与结果支撑" },
      { name: "岗位相关性", score: relevanceScore, note: `围绕${role}判断经历关联度` },
      { name: "表达清晰度", score: clarityScore, note: "检查结构、动作和结果是否易读" },
    ],
    requirements: requirements.slice(0, 6).map((skill) => ({ label: skill, status: matched.includes(skill) ? "pass" : "missing", evidence: matched.includes(skill) ? evidenceFor(resumeText, skill) : "简历中暂未找到直接证据" })),
    matched: matched.slice(0, 6).map((skill) => ({ skill, evidence: evidenceFor(resumeText, skill) })),
    gaps: gaps.slice(0, 4).map((skill) => ({ skill, suggestion: `如有 ${skill} 的真实经历，请补充项目、职责和结果；否则保留为缺口。` })),
    revisions: buildRevisions(resumeText, role, matched, gaps),
  };
}

export function aiIsConfigured() {
  return Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL);
}

export async function requestAiAnalysisStream(resumeText: string, jobDescription: string): Promise<Response | null> {
  if (!aiIsConfigured()) return null;
  const prompt = `你是严谨的简历诊断助手。只根据简历和 JD 分析，禁止编造。
严格输出 NDJSON，每行一个完整 JSON，不要 Markdown，也不要在 JSON 内换行。
第 1 行：{"type":"summary","data":{"score":0到100整数,"verdict":"结论","dimensions":[4项 name/score/note],"requirements":[最多6项 label/status/evidence],"matched":[最多6项 skill/evidence],"gaps":[最多4项 skill/suggestion]}}
之后每行一条：{"type":"revision","data":{"id":"唯一英文标识","priority":"高或中或低","category":"分类","title":"标题","original":"原文或缺失说明","revised":"建议表达","reason":"原因"}}
输出 3 到 6 条 revision，每完成一条就立即输出该行。
<resume>\n${resumeText}\n</resume>\n<job_description>\n${jobDescription}\n</job_description>`;
  const response = await fetch(`${process.env.AI_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_MODEL,
      messages: [
        { role: "system", content: "你只进行基于证据的简历分析，并严格逐行输出 NDJSON。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      stream: true,
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 403 || /no access to model/i.test(detail)) {
      throw new Error(`当前 API Key 没有使用模型 ${process.env.AI_MODEL} 的权限。`);
    }
    throw new Error(`模型服务调用失败（HTTP ${response.status}）。`);
  }
  if (!response.body) throw new Error("模型没有返回可读取的数据流。");
  return response;
}

export async function requestAiAnalysis(resumeText: string, jobDescription: string): Promise<AnalyzeResult | null> {
  if (!aiIsConfigured()) return null;
  const prompt = `你是严谨的简历诊断助手。只根据用户提供的简历和 JD 分析，禁止编造技能、数字、职责或结果。只返回 JSON，不要 Markdown。JSON 必须包含 score(0-100整数)、verdict、dimensions(四项 name/score/note)、requirements(最多6项 label/status/evidence)、matched(最多6项 skill/evidence)、gaps(最多4项 skill/suggestion)、revisions(3-6项 id/priority/category/title/original/revised/reason)。\n<resume>\n${resumeText}\n</resume>\n<job_description>\n${jobDescription}\n</job_description>`;
  const response = await fetch(`${process.env.AI_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.AI_MODEL, messages: [{ role: "system", content: "你只进行基于证据的简历分析，并严格输出 JSON。" }, { role: "user", content: prompt }], temperature: 0.2, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    const permissionDenied = response.status === 403 || /no access to model/i.test(errorBody);
    if (permissionDenied) {
      throw new Error(`当前 API Key 没有使用模型 ${process.env.AI_MODEL} 的权限，请在模型服务后台授权或更换可用模型。`);
    }
    if (response.status === 401) throw new Error("AI API Key 无效或已过期，请检查密钥。");
    if (response.status === 404) throw new Error("AI 接口地址或模型名称不存在，请检查配置。");
    throw new Error(`模型服务调用失败（HTTP ${response.status}），请稍后重试。`);
  }
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型返回内容为空");
  return { analysis_mode: "ai", ...JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")) } as AnalyzeResult;
}
