import { aiIsConfigured, Revision } from "@/lib/analysis";

async function askModel(prompt: string): Promise<string> {
  if (!aiIsConfigured()) throw new Error("AI 服务尚未配置");
  const response = await fetch(`${process.env.AI_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_MODEL,
      messages: [
        { role: "system", content: "你是严谨的简历编辑。不得新增用户未提供的经历、技能、数字或成果。只返回修改后的简历纯文本，不要 Markdown 代码块。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) throw new Error(`简历生成失败（HTTP ${response.status}）`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("模型没有返回简历内容");
  return content.replace(/^```(?:text|markdown)?\s*|\s*```$/g, "").trim();
}

export async function generateResume(original: string, revisions: Revision[]): Promise<string> {
  if (!aiIsConfigured()) {
    return revisions.reduce((text, revision) => text.includes(revision.original) ? text.replace(revision.original, revision.revised) : `${text}\n\n${revision.revised}`, original);
  }
  return askModel(`在完整保留原简历事实的前提下，将已采纳建议自然融入原简历。可以调整语句顺序和表达，但禁止新增事实。保留清晰的纯文本章节与换行。\n\n<原简历>\n${original}\n</原简历>\n\n<已采纳建议>\n${JSON.stringify(revisions)}\n</已采纳建议>`);
}

export async function refineResume(content: string, instruction: string): Promise<string> {
  return askModel(`按照用户要求修改简历。只改用户明确点名的部分；只有用户明确要求整体调整时才改全文。禁止新增事实。\n\n<当前简历>\n${content}\n</当前简历>\n\n<用户要求>\n${instruction}\n</用户要求>`);
}
