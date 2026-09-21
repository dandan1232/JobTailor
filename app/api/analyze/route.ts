import { aiIsConfigured, analyzeResume, requestAiAnalysisStream } from "@/lib/analysis";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { resume_text?: string; job_description?: string };
    const resumeText = body.resume_text?.trim() ?? "";
    const jobDescription = body.job_description?.trim() ?? "";
    if (resumeText.length < 40 || resumeText.length > 30_000) return Response.json({ detail: "简历文本长度必须在 40 到 30000 个字符之间" }, { status: 422 });
    if (jobDescription.length < 30 || jobDescription.length > 20_000) return Response.json({ detail: "职位描述长度必须在 30 到 20000 个字符之间" }, { status: 422 });

    if (!aiIsConfigured()) {
      const local = analyzeResume(resumeText, jobDescription);
      const events = [
        JSON.stringify({ type: "summary", data: { ...local, revisions: [] } }),
        ...local.revisions.map((revision) => JSON.stringify({ type: "revision", data: revision })),
        JSON.stringify({ type: "done" }),
      ];
      return new Response(`${events.join("\n")}\n`, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
    }

    const upstream = await requestAiAnalysisStream(resumeText, jobDescription);
    if (!upstream?.body) throw new Error("模型没有返回可读取的数据流。");
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let sseBuffer = "";
    let modelBuffer = "";

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const frames = sseBuffer.split("\n\n");
            sseBuffer = frames.pop() ?? "";
            for (const frame of frames) {
              for (const line of frame.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") continue;
                const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
                modelBuffer += chunk.choices?.[0]?.delta?.content ?? "";
                const rows = modelBuffer.split("\n");
                modelBuffer = rows.pop() ?? "";
                for (const row of rows) {
                  const cleaned = row.trim().replace(/^```(?:json)?\s*|```$/g, "");
                  if (!cleaned) continue;
                  JSON.parse(cleaned);
                  controller.enqueue(encoder.encode(`${cleaned}\n`));
                }
              }
            }
          }
          const last = modelBuffer.trim().replace(/^```(?:json)?\s*|```$/g, "");
          if (last) {
            JSON.parse(last);
            controller.enqueue(encoder.encode(`${last}\n`));
          }
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
        } catch (error) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", detail: error instanceof Error ? error.message : "流式分析失败" })}\n`));
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "分析服务暂时不可用" }, { status: 502 });
  }
}
