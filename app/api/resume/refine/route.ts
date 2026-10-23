import { refineResumeStream } from "@/lib/resume-editor";
import { readJsonObject, validText, withApiProtection } from "@/lib/api-protection";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiProtection(request, "refine", async (request) => {
    const body = await readJsonObject(request);
    if (!validText(body.content, 60_000)) return Response.json({ detail: "简历内容不能为空，且不能超过 60000 字。" }, { status: 422 });
    if (!validText(body.instruction, 2_000)) return Response.json({ detail: "修改要求不能为空，且不能超过 2000 字。" }, { status: 422 });
    try {
      return await refineResumeStream(body.content, body.instruction, request.signal);
    } catch (error) {
      return Response.json({ detail: error instanceof Error ? error.message : "AI 修改失败" }, { status: 502 });
    }
  });
}
