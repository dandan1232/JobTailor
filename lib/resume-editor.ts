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
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) controller.enqueue(encoder.encode(content));
            }
          }
        }
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

export function generateResumeStream(original: string, revisions: Revision[]): Promise<Response> | Response {
  if (!aiIsConfigured()) {
    const content = revisions.reduce((text, revision) => text.includes(revision.original) ? text.replace(revision.original, revision.revised) : `${text}\n\n${revision.revised}`, original);
    return new Response(content, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return streamModel(`在完整保留原简历事实的前提下，将已采纳建议自然融入原简历。可以调整语句顺序和表达，但禁止新增事实。保留清晰的纯文本章节与换行。\n\n<原简历>\n${original}\n</原简历>\n\n<已采纳建议>\n${JSON.stringify(revisions)}\n</已采纳建议>`);
}

export function refineResumeStream(content: string, instruction: string): Promise<Response> {
  return streamModel(`按照用户要求修改简历。只改用户明确点名的部分；只有用户明确要求整体调整时才改全文。禁止新增事实。\n\n<当前简历>\n${content}\n</当前简历>\n\n<用户要求>\n${instruction}\n</用户要求>`);
}
