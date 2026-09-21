import { generateResume } from "@/lib/resume-editor";
import type { Revision } from "@/lib/analysis";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { original?: string; revisions?: Revision[] };
    if (!body.original?.trim()) return Response.json({ detail: "缺少原简历内容" }, { status: 422 });
    if (!body.revisions?.length) return Response.json({ detail: "请至少采纳一条建议" }, { status: 422 });
    return Response.json({ content: await generateResume(body.original, body.revisions) });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "简历生成失败" }, { status: 502 });
  }
}
