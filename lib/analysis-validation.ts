export type AnalysisDimension = { name: string; score: number | null; note: string };
export type AnalysisRequirement = {
  label: string;
  status: "pass" | "missing";
  evidence: string;
  importance?: "required" | "preferred";
};
export type AnalysisEvidence = { skill: string; evidence: string };
export type AnalysisGap = { skill: string; suggestion: string };
export type AnalysisRevision = {
  id: string;
  priority: "高" | "中" | "低";
  category: string;
  title: string;
  original: string;
  revised: string;
  reason: string;
  kind?: "replacement" | "reminder";
};
export type AnalysisSummary = {
  analysis_mode: "ai" | "local";
  score: number | null;
  verdict: string;
  dimensions: AnalysisDimension[];
  requirements: AnalysisRequirement[];
  matched: AnalysisEvidence[];
  gaps: AnalysisGap[];
  scope_note?: string;
};
export type AnalysisEvent =
  | { type: "summary"; data: AnalysisSummary }
  | { type: "revision"; data: AnalysisRevision }
  | { type: "error"; detail: string }
  | { type: "done" };

function invalid(field: string): never {
  throw new Error(`分析结果中的“${field}”格式不完整或有误，请重新分析。`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(field);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maximum = Infinity): string {
  if (typeof value !== "string" || !value.trim()) return invalid(field);
  if (value.length > maximum) throw new Error(`分析结果中的“${field}”超过 ${maximum} 字，请重新分析。`);
  return value;
}

function score(value: unknown, field: string, allowNull: boolean): number | null {
  if (allowNull && value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) return invalid(field);
  return value;
}

function list<T>(value: unknown, field: string, maximum: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > maximum) return invalid(field);
  return Array.from(value, parse);
}

function revision(value: unknown): AnalysisRevision {
  const item = record(value, "修改建议");
  const priority = item.priority;
  if (priority !== "高" && priority !== "中" && priority !== "低") return invalid("建议优先级");
  const kind = item.kind;
  if (kind !== undefined && kind !== "replacement" && kind !== "reminder") return invalid("建议类型");
  return {
    id: text(item.id, "建议编号", 100), priority,
    category: text(item.category, "建议分类", 100), title: text(item.title, "建议标题", 200),
    original: text(item.original, "建议原文", 30_000), revised: text(item.revised, "建议正文", 60_000),
    reason: text(item.reason, "修改原因", 2_000),
    ...(kind === "replacement" || kind === "reminder" ? { kind } : {}),
  };
}

function summary(value: unknown): AnalysisSummary {
  const item = record(value, "诊断摘要");
  const mode = item.analysis_mode === undefined ? "ai" : item.analysis_mode;
  if (mode !== "ai" && mode !== "local") return invalid("分析模式");
  const scopeNote = item.scope_note === undefined ? undefined : text(item.scope_note, "分析范围说明");
  const allowNull = mode === "local" || scopeNote !== undefined;
  const maximum = mode === "local" ? 32 : 12;
  const dimensions = list(item.dimensions, "分析维度", 4, (value) => {
    const dimension = record(value, "分析维度");
    return {
      name: text(dimension.name, "维度名称"),
      score: score(dimension.score, "维度分数", allowNull),
      note: text(dimension.note, "维度说明"),
    };
  });
  if (dimensions.length !== 4) return invalid("分析维度");
  return {
    analysis_mode: mode, score: score(item.score, "匹配分数", allowNull),
    verdict: text(item.verdict, "诊断结论"), dimensions,
    requirements: list(item.requirements, "岗位要求", maximum, (value) => {
      const requirement = record(value, "岗位要求");
      const status = requirement.status;
      if (status !== "pass" && status !== "missing") return invalid("要求覆盖状态");
      const importance = requirement.importance;
      if (importance !== undefined && importance !== "required" && importance !== "preferred") return invalid("要求重要程度");
      return {
        label: text(requirement.label, "要求名称"), status,
        evidence: text(requirement.evidence, "要求证据"),
        ...(importance === "required" || importance === "preferred" ? { importance } : {}),
      };
    }),
    matched: list(item.matched, "匹配证据", maximum, (value) => {
      const evidence = record(value, "匹配证据");
      return { skill: text(evidence.skill, "匹配技能"), evidence: text(evidence.evidence, "匹配证据说明") };
    }),
    gaps: list(item.gaps, "待确认缺口", maximum, (value) => {
      const gap = record(value, "待确认缺口");
      return { skill: text(gap.skill, "缺口名称"), suggestion: text(gap.suggestion, "缺口建议") };
    }),
    ...(scopeNote === undefined ? {} : { scope_note: scopeNote }),
  };
}

/** Validate untrusted NDJSON before either the server or the UI uses its fields. */
export function parseAnalysisEvent(value: unknown): AnalysisEvent {
  const event = record(value, "分析事件");
  switch (event.type) {
    case "summary": return { type: "summary", data: summary(event.data) };
    case "revision": return { type: "revision", data: revision(event.data) };
    case "error": return { type: "error", detail: text(event.detail, "错误说明") };
    case "done": return { type: "done" };
    default: return invalid("分析事件类型");
  }
}
