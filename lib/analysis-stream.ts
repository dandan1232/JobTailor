type StreamEvent = { type?: unknown; data?: unknown; detail?: unknown };

function isAnalysisEvent(value: unknown): value is StreamEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as StreamEvent).type;
  return type === "summary" || type === "revision" || type === "done" || type === "error";
}

export class AnalysisEventDecoder {
  private mode: "unknown" | "raw" | "quoted" = "unknown";
  private quotedEscape = false;
  private unicodeEscape = "";
  private collecting = false;
  private objectBuffer = "";
  private depth = 0;
  private inString = false;
  private objectEscape = false;

  push(fragment: string): string[] {
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
          for (const decodedCharacter of decoded) this.collectCharacter(decodedCharacter, rows);
        }
      } else {
        this.collectCharacter(character, rows);
      }
    }
    return rows;
  }

  private decodeQuotedCharacter(character: string): string | null {
    if (this.unicodeEscape) {
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
      return ({ '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[character] ?? character;
    }
    if (character === "\\") {
      this.quotedEscape = true;
      return null;
    }
    if (character === '"') return null;
    return character;
  }

  private collectCharacter(character: string, rows: string[]) {
    if (!this.collecting) {
      if (character !== "{") return;
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
    const parsed: unknown = JSON.parse(this.objectBuffer);
    if (isAnalysisEvent(parsed)) rows.push(JSON.stringify(parsed));
    this.collecting = false;
    this.objectBuffer = "";
  }
}

export class AnalysisSseDecoder {
  private frameBuffer = "";
  private readonly eventDecoder = new AnalysisEventDecoder();

  push(chunk: string): string[] {
    this.frameBuffer += chunk;
    const frames = this.frameBuffer.split(/\r?\n\r?\n/);
    this.frameBuffer = frames.pop() ?? "";
    return frames.flatMap((frame) => this.decodeFrame(frame));
  }

  finish(): string[] {
    const frame = this.frameBuffer;
    this.frameBuffer = "";
    return frame.trim() ? this.decodeFrame(frame) : [];
  }

  private decodeFrame(frame: string): string[] {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return [];
    const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
    const content = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content;
    return content ? this.eventDecoder.push(content) : [];
  }
}
