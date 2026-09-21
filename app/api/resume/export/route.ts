import { Document, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";
import { join } from "node:path";

export const runtime = "nodejs";

function safeName(name: string) {
  return name.replace(/\.(pdf|docx)$/i, "").replace(/[<>:"/\\|?*]/g, "-").slice(0, 80) || "简历";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { content?: string; format?: "docx" | "pdf"; filename?: string };
    const content = body.content?.trim();
    if (!content || !body.format) return Response.json({ detail: "缺少导出内容或格式" }, { status: 422 });
    const lines = content.split(/\r?\n/);
    const base = safeName(body.filename ?? "简历");

    if (body.format === "docx") {
      const document = new Document({
        styles: { default: { document: { run: { font: "Microsoft YaHei", size: 21 }, paragraph: { spacing: { after: 100, line: 300 } } } } },
        sections: [{
          properties: { page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } } },
          children: lines.map((line, index) => new Paragraph({
            spacing: { before: index === 0 ? 0 : 80, after: line ? 80 : 30 },
            children: [new TextRun({ text: line || " ", bold: index === 0, size: index === 0 ? 32 : 21, color: "17252A" })],
          })),
        }],
      });
      const buffer = await Packer.toBuffer(document);
      return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base}-优化版.docx`)}` } });
    }

    const chunks: Buffer[] = [];
    const pdf = new PDFDocument({ size: "A4", margins: { top: 48, right: 54, bottom: 48, left: 54 } });
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => { pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); });
    const fontPath = process.platform === "win32" ? "C:/Windows/Fonts/msyh.ttc" : join(process.cwd(), "node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff");
    pdf.registerFont("Resume", fontPath);
    pdf.font("Resume").fillColor("#17252A");
    lines.forEach((line, index) => {
      if (!line) return pdf.moveDown(0.55);
      pdf.fontSize(index === 0 ? 20 : 10.5).text(line, { lineGap: 4 });
      pdf.moveDown(index === 0 ? 0.6 : 0.25);
    });
    pdf.end();
    return new Response(new Uint8Array(await completed), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base}-优化版.pdf`)}` } });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "文件导出失败" }, { status: 500 });
  }
}
