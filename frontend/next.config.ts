import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse loads pdf.worker.mjs at runtime; bundling it breaks that path in dev.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
