import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const runtime = "nodejs";
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

class ResumeParseError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return Response.json({ detail: "请上传 PDF 或 DOCX 简历" }, { status: 400 });
    const suffix = `.${file.name.toLowerCase().split(".").pop()}`;
    if (![".pdf", ".docx"].includes(suffix)) return Response.json({ detail: "仅支持 PDF 和 DOCX 简历" }, { status: 415 });
    if (file.size > MAX_RESUME_BYTES) return Response.json({ detail: "简历文件不能超过 5MB" }, { status: 413 });
    const data = new Uint8Array(await file.arrayBuffer());
    let text = "";
    if (suffix === ".pdf") {
      // PDF.js may transfer ownership of this array, so keep it isolated per request.
      const parser = new PDFParse({ data: data.slice() });
      try {
        const result = await parser.getText();
        text = result.text;
      } finally {
        await parser.destroy();
      }
    } else {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value;
    }
    const normalized = text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 30_000);
    if (normalized.length < 40) throw new ResumeParseError("文件中的可识别文字太少。如果这是扫描版 PDF，请先用 OCR 转成可搜索文字后再上传。");
    return Response.json({ filename: file.name, characters: normalized.length, text: normalized });
  } catch (error) {
    if (error instanceof ResumeParseError) return Response.json({ detail: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    console.error("Resume extraction failed:", error);
    if (message.includes("password")) return Response.json({ detail: "这份 PDF 有密码保护，请解除密码后再上传。" }, { status: 422 });
    if (message.includes("invalid pdf") || message.includes("pdf header")) return Response.json({ detail: "这不是有效的 PDF 文件，或文件内容已经损坏。" }, { status: 422 });
    if (message.includes("zip") || message.includes("mammoth")) return Response.json({ detail: "无法读取这份 DOCX，请用 Word 重新另存为 .docx 后再上传。" }, { status: 422 });
    return Response.json({ detail: "文件解析失败。请重新导出为 PDF 或 DOCX 后再上传。" }, { status: 422 });
  }
}
