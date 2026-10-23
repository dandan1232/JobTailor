import { aiIsConfigured } from "@/lib/analysis";
import { AI_USAGE_LIMITS } from "@/lib/api-protection";

export const runtime = "nodejs";

export function GET() {
  return Response.json({ status: "ok", analysis_mode: aiIsConfigured() ? "ai" : "local", usage_limits: AI_USAGE_LIMITS }, { headers: { "Cache-Control": "no-store" } });
}
