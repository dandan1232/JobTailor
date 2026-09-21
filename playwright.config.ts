import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results/playwright",
  fullyParallel: true,
  reporter: "line",
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3001",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: true,
    env: {
      ...process.env,
      NO_PROXY: "127.0.0.1,localhost",
      AI_BASE_URL: "",
      AI_API_KEY: "",
      AI_MODEL: "",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3001",
    channel: "msedge",
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
