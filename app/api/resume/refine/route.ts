import { refineResumeStream } from "@/lib/resume-editor";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { content?: string; instruction?: string };
    if (!body.content?.trim() || !body.instruction?.trim()) return Response.json({ detail: "缺少简历内容或修改要求" }, { status: 422 });
    return await refineResumeStream(body.content, body.instruction);
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "AI 修改失败" }, { status: 502 });
  }
}
