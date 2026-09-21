import { aiIsConfigured, Revision } from "@/lib/analysis";

async function streamModel(prompt: string, finalize?: (content: string) => string): Promise<Response> {
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
  let generatedContent = "";
  const emitLine = (line: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const data = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (!data || data === "[DONE]") return;
    try {
      const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
      const content = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
      if (content) {
        if (finalize) generatedContent += content;
        else controller.enqueue(encoder.encode(content));
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
        if (finalize) controller.enqueue(encoder.encode(finalize(generatedContent)));
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

function applyAcceptedRevisions(original: string, revisions: Revision[]): string {
  return revisions.reduce((content, revision) => {
    if (content.includes(revision.original)) {
      return content.replace(revision.original, revision.revised);
    }
    if (content.includes(revision.revised)) return content;
    return `${content.trimEnd()}\n\n${revision.revised}`;
  }, original);
}

export function generateResumeStream(original: string, revisions: Revision[]): Promise<Response> | Response {
  const revisedDraft = applyAcceptedRevisions(original, revisions);
  if (!aiIsConfigured()) {
    return new Response(revisedDraft, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return streamModel(
    `下面的“已应用建议草稿”已经将用户采纳的修改逐条写入。请在完整保留原简历事实和这些已采纳修改的前提下，整理成自然、清晰的最终简历。不得恢复被替换的原文，不得遗漏或撤销任何已采纳修改，也不得新增事实。只返回最终简历纯文本。\n\n<原简历>\n${original}\n</原简历>\n\n<已采纳建议>\n${JSON.stringify(revisions)}\n</已采纳建议>\n\n<已应用建议草稿>\n${revisedDraft}\n</已应用建议草稿>`,
    (content) => applyAcceptedRevisions(content.trim() || revisedDraft, revisions),
  );
}

export function refineResumeStream(content: string, instruction: string): Promise<Response> {
  return streamModel(`按照用户要求修改简历。只改用户明确点名的部分；只有用户明确要求整体调整时才改全文。禁止新增事实。\n\n<当前简历>\n${content}\n</当前简历>\n\n<用户要求>\n${instruction}\n</用户要求>`);
}
