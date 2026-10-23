import { parseAnalysisEvent } from "./analysis-validation";

function malformed(): never {
  throw new Error("AI 分析数据格式不完整或有误，请重新分析。");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return malformed();
  }
}

export class AnalysisEventDecoder {
  private mode: "unknown" | "raw" | "quoted" = "unknown";
  private quotedClosed = false;
  private quotedEscape = false;
  private unicodeEscape = "";
  private collecting = false;
  private objectBuffer = "";
  private depth = 0;
  private inString = false;
  private objectEscape = false;
  private summarySeen = false;
  private readonly revisionIds = new Set<string>();
  private ended = false;
  private finished = false;

  push(fragment: string): string[] {
    if (this.finished) throw new Error("AI 分析已经结束，不能继续接收内容。");
    const rows: string[] = [];
    for (const character of fragment) {
      if (this.mode === "unknown") {
        if (/\s/.test(character)) continue;
        this.mode = character === '"' ? "quoted" : "raw";
        if (this.mode === "quoted") continue;
      }

      if (this.mode === "quoted") {
        const decoded = this.decodeQuotedCharacter(character);
        if (decoded !== null) {
          this.collectCharacter(decoded, rows);
        }
      } else {
        this.collectCharacter(character, rows);
      }
    }
    return rows;
  }

  finish(): string[] {
    if (this.finished) return [];
    if (this.mode === "unknown") throw new Error("AI 分析结果为空，请重新分析。");
    if (this.collecting || (this.mode === "quoted" && (!this.quotedClosed || this.quotedEscape || this.unicodeEscape))) {
      throw new Error("AI 分析结果接收不完整，请重新分析。");
    }
    if (!this.summarySeen) throw new Error("AI 分析缺少诊断摘要，请重新分析。");
    this.finished = true;
    return [];
  }

  private decodeQuotedCharacter(character: string): string | null {
    if (this.quotedClosed) {
      if (!/\s/.test(character)) return malformed();
      return null;
    }
    if (this.unicodeEscape) {
      if (!/[\da-f]/i.test(character)) return malformed();
      this.unicodeEscape += character;
      if (this.unicodeEscape.length < 5) return null;
      const decoded = String.fromCharCode(Number.parseInt(this.unicodeEscape.slice(1), 16));
      this.unicodeEscape = "";
      this.quotedEscape = false;
      return decoded;
    }
    if (this.quotedEscape) {
      if (character === "u") {
        this.unicodeEscape = "u";
        return null;
      }
      this.quotedEscape = false;
      const decoded = ({ '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[character];
      if (decoded === undefined) return malformed();
      return decoded;
    }
    if (character === "\\") {
      this.quotedEscape = true;
      return null;
    }
    if (character === '"') {
      this.quotedClosed = true;
      return null;
    }
    if (character.charCodeAt(0) < 32) return malformed();
    return character;
  }

  private collectCharacter(character: string, rows: string[]) {
    if (!this.collecting) {
      if (/\s/.test(character)) return;
      if (character !== "{") return malformed();
      this.collecting = true;
      this.objectBuffer = "{";
      this.depth = 1;
      this.inString = false;
      this.objectEscape = false;
      return;
    }

    this.objectBuffer += character;
    if (this.inString) {
      if (this.objectEscape) this.objectEscape = false;
      else if (character === "\\") this.objectEscape = true;
      else if (character === '"') this.inString = false;
      return;
    }
    if (character === '"') this.inString = true;
    else if (character === "{") this.depth += 1;
    else if (character === "}") this.depth -= 1;

    if (this.depth !== 0) return;
    const event = parseAnalysisEvent(parseJson(this.objectBuffer));
    if (this.ended) throw new Error("AI 分析结束后仍返回内容，请重新分析。");
    if (event.type === "error") throw new Error(event.detail);
    if (event.type === "summary") {
      if (this.summarySeen) throw new Error("AI 分析重复返回诊断摘要，请重新分析。");
      if (event.data.analysis_mode !== "ai") throw new Error("AI 分析返回了错误的分析模式，请重新分析。");
      this.summarySeen = true;
    } else {
      if (!this.summarySeen) throw new Error("AI 分析缺少前置诊断摘要，请重新分析。");
      if (event.type === "done") this.ended = true;
      else {
        if (this.revisionIds.has(event.data.id)) throw new Error("AI 分析返回了重复的建议编号，请重新分析。");
        if (this.revisionIds.size >= 6) throw new Error("AI 分析返回的建议超过 6 条，请重新分析。");
        this.revisionIds.add(event.data.id);
      }
    }
    // The API emits its own done event only after the upstream stream is validated.
    if (event.type !== "done") rows.push(JSON.stringify(event));
    this.collecting = false;
    this.objectBuffer = "";
  }
}

type CompletionChunk = {
  error?: unknown;
  choices?: Array<{
    delta?: { content?: unknown };
    message?: { content?: unknown };
    finish_reason?: unknown;
  }>;
};

export class AnalysisSseDecoder {
  private frameBuffer = "";
  private readonly eventDecoder = new AnalysisEventDecoder();
  private terminated = false;
  private finished = false;

  push(chunk: string): string[] {
    if (this.finished) throw new Error("AI 分析已经结束，不能继续接收内容。");
    this.frameBuffer += chunk;
    const frames = this.frameBuffer.split(/\r?\n\r?\n/);
    this.frameBuffer = frames.pop() ?? "";
    return frames.flatMap((frame) => this.decodeFrame(frame));
  }

  finish(): string[] {
    if (this.finished) return [];
    const frame = this.frameBuffer;
    this.frameBuffer = "";
    const rows = frame.trim() ? this.decodeFrame(frame) : [];
    this.eventDecoder.finish();
    if (!this.terminated) throw new Error("AI 分析连接提前结束，结果可能不完整，请重新分析。");
    this.finished = true;
    return rows;
  }

  private decodeFrame(frame: string): string[] {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return [];
    if (data === "[DONE]") {
      this.terminated = true;
      return [];
    }
    const parsed = parseJson(data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return malformed();
    const payload = parsed as CompletionChunk;
    if (payload.error !== undefined) {
      throw new Error("模型服务返回错误，分析未完成，请稍后重试。");
    }
    if (!Array.isArray(payload.choices)) return malformed();
    if (payload.choices.length === 0) return [];
    const choice = payload.choices[0];
    if (!choice || typeof choice !== "object") return malformed();
    const content = choice.delta?.content ?? choice.message?.content;
    if (content !== undefined && content !== null && typeof content !== "string") return malformed();
    if (content && this.terminated) throw new Error("AI 分析结束后仍返回内容，请重新分析。");
    const rows = typeof content === "string" && content ? this.eventDecoder.push(content) : [];
    const reason = choice.finish_reason;
    if (reason === "length") throw new Error("AI 分析因输出长度限制而中断，请重新分析或缩短输入。");
    if (reason === "content_filter") throw new Error("AI 分析被模型服务中止，结果不完整，请调整输入后重试。");
    if (reason !== undefined && reason !== null) {
      if (reason !== "stop") throw new Error("AI 分析没有正常完成，请重新分析。");
      this.terminated = true;
    }
    return rows;
  }
}
