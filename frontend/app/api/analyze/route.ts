import { analyzeResume, requestAiAnalysis } from "@/lib/analysis";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { resume_text?: string; job_description?: string };
    const resumeText = body.resume_text?.trim() ?? "";
    const jobDescription = body.job_description?.trim() ?? "";
    if (resumeText.length < 40 || resumeText.length > 30_000) return Response.json({ detail: "简历文本长度必须在 40 到 30000 个字符之间" }, { status: 422 });
    if (jobDescription.length < 30 || jobDescription.length > 20_000) return Response.json({ detail: "职位描述长度必须在 30 到 20000 个字符之间" }, { status: 422 });
    const aiResult = await requestAiAnalysis(resumeText, jobDescription);
    return Response.json(aiResult ?? analyzeResume(resumeText, jobDescription));
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "分析服务暂时不可用" }, { status: 502 });
  }
}
