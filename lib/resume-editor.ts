import { aiIsConfigured, Revision } from "@/lib/analysis";

async function streamModel(prompt: string): Promise<Response> {
  if (!aiIsConfigured()) throw new Error("AI 服务尚未配置");
  const upstream = await fetch(`${process.env.AI_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_MODEL,
      messages: [
        { role: "system", content: "你是严谨的简历编辑。不得新增用户未提供的经历、技能、数字或成果。只返回修改后的简历纯文本，不要 Markdown 代码块。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      stream: true,
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!upstream.ok) throw new Error(`简历生成失败（HTTP ${upstream.status}）`);
  if (!upstream.body) throw new Error("模型没有返回可读取的数据流");

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const emitLine = (line: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const data = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (!data || data === "[DONE]") return;
    try {
      const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
      const content = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
      if (content) {
        controller.enqueue(encoder.encode(content));
      }
    } catch {
      // Ignore keep-alive/non-JSON lines; a partial JSON chunk is handled by the provider's next line.
    }
  };
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) emitLine(line, controller);
        }
        buffer += decoder.decode();
        if (buffer) emitLine(buffer, controller);
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}

export function applyAcceptedRevisions(original: string, revisions: Revision[]): string {
  // Match against the source once, so one replacement cannot change another's target.
  const positions: number[] = [];
  let normalized = "";
  for (let index = 0; index < original.length; index++) {
    if (/\s/.test(original[index])) continue;
    normalized += original[index];
    positions.push(index);
  }
  const edits = revisions.map((revision) => {
    if (typeof revision.original !== "string" || typeof revision.revised !== "string" || !revision.original.trim() || !revision.revised.trim()) {
      throw new Error("建议缺少可替换的原文或修改内容，请重新分析。");
    }
    const target = revision.original.replace(/\s/g, "");
    const start = normalized.indexOf(target);
    if (start < 0) {
      throw new Error(`无法定位建议“${revision.title}”的原文，尚未生成新版本。请重新分析，或在编辑区手动补充这条建议。`);
    }
    if (normalized.indexOf(target, start + 1) >= 0) {
      throw new Error(`建议“${revision.title}”对应多处原文，请重新分析以获取更完整的原文定位。`);
    }
    return { start: positions[start], end: positions[start + target.length - 1] + 1, text: revision.revised };
  }).sort((a, b) => a.start - b.start);
  for (let index = 1; index < edits.length; index++) {
    if (edits[index].start < edits[index - 1].end) {
      throw new Error("采纳的建议修改了同一段重叠内容，请一次只采纳其中一条。");
    }
  }
  return edits.reverse().reduce((content, edit) => content.slice(0, edit.start) + edit.text + content.slice(edit.end), original);
}

export function generateResumeStream(original: string, revisions: Revision[]): Promise<Response> | Response {
  const revisedDraft = applyAcceptedRevisions(original, revisions);
  // Suggestions already contain AI-written copy approved by the user.
  // A second full rewrite could undo those decisions.
  return new Response(revisedDraft, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export function refineResumeStream(content: string, instruction: string): Promise<Response> {
  return streamModel(`按照用户要求修改简历。只改用户明确点名的部分；只有用户明确要求整体调整时才改全文。禁止新增事实。\n\n<当前简历>\n${content}\n</当前简历>\n\n<用户要求>\n${instruction}\n</用户要求>`);
}
