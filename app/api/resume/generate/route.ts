import { generateResumeStream } from "@/lib/resume-editor";
import type { Revision } from "@/lib/analysis";
import { readJsonObject, validText, withApiProtection } from "@/lib/api-protection";

export const runtime = "nodejs";

function isRevision(value: unknown): value is Revision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return validText(item.id, 100) && validText(item.category, 100) && validText(item.title, 200)
    && validText(item.original, 30_000) && validText(item.revised, 60_000) && validText(item.reason, 2_000)
    && ["高", "中", "低"].includes(item.priority as string)
    && (item.kind === undefined || item.kind === "replacement" || item.kind === "reminder");
}

export async function POST(request: Request) {
  return withApiProtection(request, "generate", async (request) => {
    const body = await readJsonObject(request);
    if (!validText(body.original, 30_000)) return Response.json({ detail: "原简历内容不能为空，且不能超过 30000 字。" }, { status: 422 });
    if (!Array.isArray(body.revisions) || body.revisions.length < 1 || body.revisions.length > 6 || !body.revisions.every(isRevision)) {
      return Response.json({ detail: "请提交 1 到 6 条完整、有效的建议。" }, { status: 422 });
    }
    if (new Set(body.revisions.map((item) => item.id)).size !== body.revisions.length) return Response.json({ detail: "建议编号不能重复，请重新分析。" }, { status: 422 });
    try {
      return await generateResumeStream(body.original, body.revisions);
    } catch (error) {
      return Response.json({ detail: error instanceof Error ? error.message : "简历生成失败" }, { status: 422 });
    }
  });
}
