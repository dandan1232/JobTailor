import { aiIsConfigured } from "@/lib/analysis";

export const runtime = "nodejs";

export function GET() {
  return Response.json({ status: "ok", analysis_mode: aiIsConfigured() ? "ai" : "local" });
}
