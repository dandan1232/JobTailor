export type Dimension = { name: string; score: number | null; note: string };
export type Requirement = { label: string; status: "pass" | "missing"; evidence: string; importance?: "required" | "preferred" };
export type Evidence = { skill: string; evidence: string };
export type Gap = { skill: string; suggestion: string };
export type Revision = {
  id: string;
  kind?: "replacement" | "reminder";
  priority: "高" | "中" | "低";
  category: string;
  title: string;
  original: string;
  revised: string;
  reason: string;
};

export type AnalyzeResult = {
  analysis_mode: "ai" | "local";
  score: number | null;
  scope_note?: string;
  verdict: string;
  dimensions: Dimension[];
  requirements: Requirement[];
  matched: Evidence[];
  gaps: Gap[];
  revisions: Revision[];
};

const SKILLS = [
  ["Python", "Python3", "Python2"], ["FastAPI", "Fast API"], ["Django"],
  ["PostgreSQL", "Postgres"], ["MySQL"], ["Redis"], ["Docker"],
  ["Kubernetes", "K8s"], ["AWS", "Amazon Web Services", "亚马逊云"],
  ["React", "React.js", "ReactJS"], ["JavaScript", "JS"], ["TypeScript", "TS"],
  ["Java"], ["Spring Boot", "SpringBoot"], ["Vue", "Vue.js", "VueJS"],
  ["Node.js", "NodeJS", "Node JS"], ["微服务", "Microservice", "Microservices"],
  ["高并发"], ["团队协作", "团队合作"],
].map(([name, ...aliases]) => ({
  name,
  pattern: new RegExp(`(?<![a-z0-9_])(?:${[name, ...aliases]
    .sort((a, b) => b.length - a.length)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*"))
    .join("|")})(?![a-z0-9_])`, "gi"),
}));

type SkillMatch = { skill: string; start: number; end: number };
type LocalRequirement = { skills: string[]; importance: "required" | "preferred" };

function findSkills(text: string): SkillMatch[] {
  const matches = SKILLS.flatMap(({ name, pattern }) => Array.from(text.matchAll(pattern), (match) => ({
    skill: name, start: match.index, end: match.index + match[0].length,
  }))).sort((a, b) => a.start - b.start || b.end - a.end);
  // Prefer the complete name: the JS in Node.js is not JavaScript evidence.
  const completeMatches: SkillMatch[] = [];
  for (const match of matches) {
    if (!completeMatches.length || match.start >= completeMatches.at(-1)!.end) completeMatches.push(match);
  }
  return completeMatches;
}

function localRequirements(jobDescription: string): LocalRequirement[] {
  const requirements = new Map<string, LocalRequirement>();
  let sectionImportance: LocalRequirement["importance"] = "required";
  const preferredHeading = /^(?:加分(?:项|条件)?|优先(?:项|条件)?|preferred(?:\s+(?:skills|qualifications))?|nice[\s-]+to[\s-]+have|bonus(?:\s+skills)?)\s*[:：]?$/i;
  const requiredHeading = /^(?:任职要求|岗位要求|职位要求|职责要求|基本要求|硬性要求|必备技能|必需技能|requirements?|required(?:\s+(?:skills|qualifications))?|must[\s-]+have)\s*[:：]?$/i;
  const clauses = jobDescription.split(/[\n。；;，,!?！？]+|\.(?=\s|$)/);
  for (const rawClause of clauses) {
    const clause = rawClause.trim().replace(/^[-•*\s]+/, "");
    const heading = clause.split(/[:：]/)[0];
    if (preferredHeading.test(heading)) sectionImportance = "preferred";
    else if (requiredHeading.test(heading)) sectionImportance = "required";
    const importance = /优先|加分|更佳|preferred|nice[\s-]+to[\s-]+have|bonus/i.test(clause) ? "preferred" : sectionImportance;
    const matches = findSkills(clause);
    const groups: string[][] = [];
    const chooseOne = /任选|任[一意]|至少[一1]|其中之一|one\s+of|either/i.test(clause);
    matches.forEach((match, index) => {
      const previous = matches[index - 1];
      const connector = previous ? clause.slice(previous.end, match.start).trim() : "";
      const alternative = /^(?:或(?:者)?|or|\/|\|)$/i.test(connector)
        || (chooseOne && /^(?:、|和|及|以及|and)$/i.test(connector));
      if (previous && alternative) groups.at(-1)!.push(match.skill);
      else groups.push([match.skill]);
    });
    for (const skills of groups) {
      const uniqueSkills = [...new Set(skills)];
      const key = [...uniqueSkills].sort().join("|");
      const existing = requirements.get(key);
      if (existing) {
        if (importance === "required") existing.importance = "required";
      } else {
        requirements.set(key, { skills: uniqueSkills, importance });
      }
    }
  }
  return [...requirements.values()].sort((a, b) => Number(a.importance === "preferred") - Number(b.importance === "preferred"));
}

const fragments = (text: string) => text.split(/[\n。；;]/).map((part) => part.trim().replace(/^[-•*\s]+/, "")).filter(Boolean);
const hasSkill = (text: string, skill: string) => findSkills(text).some((match) => match.skill === skill);
const evidenceFor = (resume: string, skill: string) => fragments(resume).find((part) => hasSkill(part, skill)) ?? "简历中未找到直接证据";

function buildRevisions(resume: string, role: string, matched: string[], gaps: string[]): Revision[] {
  const projectLine = fragments(resume).find((line) => /\d/.test(line)) ?? fragments(resume)[0] ?? "尚未识别到可用项目描述";
  const openingLine = resume.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const normalizedResume = resume.replace(/\s/g, "");
  const openingTarget = openingLine.replace(/\s/g, "");
  const openingStart = normalizedResume.indexOf(openingTarget);
  const canReplaceOpening = openingTarget.length > 0 && openingStart >= 0 && normalizedResume.indexOf(openingTarget, openingStart + 1) < 0;
  const skillSummary = matched.slice(0, 4).join("、");
  const roleLabel = role === "目标岗位" ? role : `${role}岗位`;
  const revisions: Revision[] = [
    {
      id: "summary-focus", priority: "高", category: "个人摘要", title: "让开头直接回应目标岗位",
      kind: canReplaceOpening ? "replacement" : "reminder",
      original: openingLine || "尚未识别到开头内容。",
      revised: canReplaceOpening
        ? `${openingLine}\n面向${roleLabel}${skillSummary ? `，已有经历涉及${skillSummary}` : ""}。`
        : "先确认需要修改的开头段落，保留姓名与已有事实，再补充目标岗位和有真实证据的技能。",
      reason: canReplaceOpening
        ? "招聘方通常先扫描顶部摘要。先说明岗位方向和已有证据，能更快建立相关性。"
        : "开头为空或有多处相同文字，需要先确认要修改的位置。",
    },
    {
      id: "project-result", priority: "中", category: "项目经历", title: "把项目描述改成动作与结果",
      kind: "reminder",
      original: projectLine,
      revised: `围绕业务目标说明具体动作、技术选择和可验证结果。原始证据：${projectLine}`,
      reason: "只罗列职责很难判断贡献大小，动作、技术选择和结果更容易被追问和验证。",
    },
  ];
  if (gaps.length) {
    const missing = gaps.slice(0, 3).join("、");
    revisions.splice(1, 0, {
      id: "skill-gap", priority: "高", category: "技能缺口", title: `确认 ${missing} 是否有真实证据`,
      kind: "reminder",
      original: `JD 要求 ${missing}，当前简历没有找到直接证据。`,
      revised: `如果真实使用过 ${missing}，补充对应项目、职责和结果；如果没有，不要为了匹配度强行加入。`,
      reason: "缺少证据的关键词容易在面试追问时失真，这里应补真实经历，而不是补漂亮话。",
    });
  }
  if (!fragments(resume).some((line) => /%|\d+\s*(秒|人|次|万|小时|天)/.test(line))) {
    revisions.push({
      id: "quantify-impact", priority: "中", category: "结果表达", title: "补充可核实的结果",
      kind: "reminder",
      original: "多数经历没有结果数据或明确影响。",
      revised: "有真实记录时补充性能、效率、规模或交付结果；没有准确数字时使用定性结果，不要编造。",
      reason: "结果证据能区分‘参与过’和‘真正产生过影响’。",
    });
  }
  return revisions;
}

export function analyzeResume(resumeText: string, jobDescription: string): AnalyzeResult {
  const role = fragments(jobDescription).slice(0, 4).map((line) => line.replace(/^(岗位|职位|招聘职位|Job Title)\s*[:：]?\s*/i, "")).find((line) => line.length >= 2 && line.length <= 40) ?? "目标岗位";
  const requirements = localRequirements(jobDescription);
  const resumeSkills = new Set(findSkills(resumeText).map((match) => match.skill));
  const required = requirements.filter((item) => item.importance === "required");
  const isCovered = (item: LocalRequirement) => item.skills.some((skill) => resumeSkills.has(skill));
  const matched = [...new Set(requirements.flatMap((item) => item.skills.filter((skill) => resumeSkills.has(skill))))];
  const gaps = required.filter((item) => !isCovered(item)).map((item) => item.skills.join(" 或 "));
  const matchedRequired = required.filter(isCovered).length;
  const coverage = matchedRequired / Math.max(required.length, 1);
  const canScore = required.length > 0;
  const hasNumbers = /\d/.test(resumeText);
  const hasBullets = resumeText.split("\n").length >= 3;
  const keywordScore = Math.round(coverage * 100);
  const evidenceScore = Math.min(58 + (hasNumbers ? 18 : 0) + matchedRequired * 4, 96);
  const relevanceScore = Math.min(45 + Math.round(coverage * 45) + (role !== "目标岗位" ? 8 : 0), 96);
  const clarityScore = hasBullets ? 84 : 66;
  const score = canScore ? Math.round(keywordScore * 0.35 + evidenceScore * 0.3 + relevanceScore * 0.2 + clarityScore * 0.15) : null;
  const scopeNote = canScore
    ? "本地规则仅核对有限技能词表、明确的任选关系和加分表述；分数只参考已识别的必需技能，不代表完整岗位匹配或实际能力。"
    : requirements.length
      ? "本地规则仅识别到加分技能，无法据此评估岗位匹配度，因此暂不评分。加分项未命中不算必需缺口。"
      : "这份岗位描述没有命中本地支持的有限技能词表，暂不评分；这不表示简历不匹配，请结合完整岗位要求核对。";

  return {
    analysis_mode: "local", score, scope_note: scopeNote,
    verdict: score === null ? "本地规则不足以判断岗位匹配度，请结合完整岗位要求核实经历。"
      : gaps.length ? "已识别的必需技能仍有证据缺口，建议先核实真实经历并调整表达。"
        : "已识别的必需技能均有关键词证据，请继续核实项目经历和完整岗位要求。",
    dimensions: [
      { name: "关键词覆盖", score: canScore ? keywordScore : null, note: canScore ? `命中 ${matchedRequired}/${required.length} 项已识别必需要求，任选组满足一项即可` : "没有足够的已识别必需要求，暂不评分" },
      { name: "经历证据", score: canScore ? evidenceScore : null, note: "仅检查关键词和数字线索，无法确认项目深度与结果真实性" },
      { name: "岗位相关性", score: canScore ? relevanceScore : null, note: `仅参考${role}的已识别技能覆盖情况` },
      { name: "表达清晰度", score: canScore ? clarityScore : null, note: "仅检查换行结构，不能替代对表达质量的判断" },
    ],
    requirements: requirements.map((item) => {
      const evidenceSkill = item.skills.find((skill) => resumeSkills.has(skill));
      return { label: item.skills.join(" 或 "), importance: item.importance, status: evidenceSkill ? "pass" : "missing", evidence: evidenceSkill ? evidenceFor(resumeText, evidenceSkill) : "简历中暂未找到直接证据" };
    }),
    matched: matched.slice(0, 6).map((skill) => ({ skill, evidence: evidenceFor(resumeText, skill) })),
    gaps: gaps.slice(0, 4).map((skill) => ({ skill, suggestion: `如有 ${skill} 的真实经历，请补充项目、职责和结果；否则保留为缺口。` })),
    revisions: buildRevisions(resumeText, role, matched, gaps),
  };
}

export function aiIsConfigured() {
  return Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL);
}

export async function requestAiAnalysisStream(resumeText: string, jobDescription: string, signal?: AbortSignal): Promise<Response | null> {
  if (!aiIsConfigured()) return null;
  const prompt = `你是严谨的简历诊断助手。只根据简历和 JD 分析，禁止编造。
严格输出 NDJSON，每行一个完整 JSON，不要 Markdown，也不要在 JSON 内换行。
第 1 行：{"type":"summary","data":{"score":0到100整数或无法判断时null,"verdict":"结论","dimensions":[4项 name/score/note，其中 score 为0到100整数或null],"requirements":[最多6项 label/status/evidence/importance，其中 status 只能是 pass 或 missing，importance 只能是 required 或 preferred],"matched":[最多6项 skill/evidence],"gaps":[最多4项 skill/suggestion]}}
区分必需条件与优先、加分条件，后者 importance 为 preferred，不作为必需缺口扣分。FastAPI 或 Django 这类任选条件合并为一项，满足其中一项即 pass，不再把同组其他选项列入 gaps。requirements 优先展示必需条件，并保留加分条件的状态。evidence 逐字引用简历依据；没有证据时明确说明，不把关键词出现当作项目能力证明。无法判断时 score 和相关 dimensions.score 为 null，并在 scope_note 中说明原因。
之后每行一条：{"type":"revision","data":{"id":"唯一英文标识","priority":"高或中或低","category":"分类","title":"标题","original":"原文或缺失说明","revised":"建议表达","reason":"原因"}}
输出 3 到 6 条 revision，每完成一条就立即输出该行。
每条 revision 必须是可直接应用的原文替换：original 逐字引用简历中唯一、完整、连续的一段原文，revised 是该段修改后的完整正文。不要把缺失说明写入 original，不要把操作说明或“如果有经历请补充”写入 revised。新增摘要时引用开头段落，在 revised 中保留开头事实并加入摘要。缺乏事实依据的内容只写入 gaps，不生成可采纳建议。不同 revision 的 original 不得重叠。
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
      max_tokens: 6_000,
    }),
    signal: AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]),
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
  const prompt = `你是严谨的简历诊断助手。只根据用户提供的简历和 JD 分析，禁止编造技能、数字、职责或结果。只返回 JSON，不要 Markdown。JSON 必须包含 score(0-100整数或无法判断时null)、verdict、dimensions(四项 name/score/note，score可为null)、requirements(最多6项 label/status/evidence/importance)、matched(最多6项 skill/evidence)、gaps(最多4项 skill/suggestion)、revisions(3-6项 id/priority/category/title/original/revised/reason)。requirements 区分 required 必需条件和 preferred 加分条件；加分项缺失不算必需缺口，任选条件合并为一项、满足其一即可。evidence 逐字引用简历依据，无证据时明确说明，不能把关键词出现当作项目能力证明。无法判断时在 scope_note 中说明原因。\n<resume>\n${resumeText}\n</resume>\n<job_description>\n${jobDescription}\n</job_description>`;
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
