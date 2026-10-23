import { expect, test, type Page } from "@playwright/test";

async function generateSampleDraft(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例" }).click();
  await page.getByRole("button", { name: "开始匹配分析" }).click();
  await page.locator(".revision-item", { hasText: "让开头直接回应目标岗位" }).getByRole("button", { name: "采纳", exact: true }).click();
  await page.getByRole("button", { name: "重新生成简历" }).click();
  await expect(page.getByLabel("优化版简历正文")).toHaveValue(/面向Python 后端工程师岗位/);
}

test("analyzes a resume against a job and accepts a revision", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "让简历对准岗位，而不是堆关键词" })).toBeVisible();
  await page.getByRole("button", { name: "载入示例" }).click();
  await expect(page.getByText("示例-后端工程师简历.pdf")).toBeVisible();

  await page.getByRole("button", { name: "开始匹配分析" }).click();

  await expect(page.getByRole("heading", { name: "岗位匹配诊断" })).toBeVisible();
  await expect(page.getByText("本地分析预览", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "按影响程度逐条处理" })).toBeVisible();

  const summaryRevision = page.locator(".revision-item", { hasText: "让开头直接回应目标岗位" });
  await summaryRevision.getByRole("button", { name: "采纳" }).click();
  await expect(summaryRevision.getByText("已采纳")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新生成简历" })).toBeEnabled();
  await page.getByRole("button", { name: "重新生成简历" }).click();
  await expect(page.getByLabel("优化版简历正文")).toHaveValue(/面向Python 后端工程师岗位/);
  await expect(page.getByText("优化版简历已生成，可以直接编辑或下载。")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-analysis.png"), fullPage: true });
});

test("keeps upload, JD input, and analysis controls usable on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
  await expect(page.locator("#source").getByText("上传简历", { exact: true })).toBeVisible();
  await expect(page.getByLabel("目标岗位 JD")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始匹配分析" })).toBeDisabled();

  await page.screenshot({ path: testInfo.outputPath("mobile-upload.png"), fullPage: true });
});

test("shows a useful error when resume extraction returns an empty response", async ({ page }) => {
  await page.route("**/api/resume/extract", (route) => route.fulfill({ status: 502, body: "" }));
  await page.goto("/");

  await page.locator('input[type="file"]').setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test"),
  });

  await expect(page.getByText("简历读取服务暂时不可用（HTTP 502），请稍后重试。")).toBeVisible();
  await expect(page.getByText(/Unexpected end of JSON input/)).toHaveCount(0);
});

test("keeps reminders out of the draft and lets users reconsider decisions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例" }).click();
  await page.getByRole("button", { name: "开始匹配分析" }).click();

  const reminder = page.locator(".revision-item", { hasText: "技能缺口" });
  await expect(reminder.getByText("待补充提醒")).toBeVisible();
  await expect(reminder.getByRole("button", { name: "采纳", exact: true })).toHaveCount(0);
  await reminder.getByRole("button", { name: "跳过" }).click();
  await reminder.getByRole("button", { name: "重新考虑" }).click();
  await expect(reminder.getByRole("button", { name: "跳过" })).toBeVisible();

  const summary = page.locator(".revision-item", { hasText: "让开头直接回应目标岗位" });
  await summary.getByRole("button", { name: "采纳", exact: true }).click();
  await summary.getByRole("button", { name: "取消采纳" }).click();
  await expect(page.getByRole("button", { name: "重新生成简历" })).toBeDisabled();
  await summary.getByRole("button", { name: "采纳", exact: true }).click();
  await page.getByRole("button", { name: "重新生成简历" }).click();
  await expect(page.getByLabel("优化版简历正文")).not.toHaveValue(/围绕业务目标说明|如果真实使用过/);
});

test("regeneration preserves manual edits until confirmed and can be undone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await generateSampleDraft(page);
  const editor = page.getByLabel("优化版简历正文");
  const original = await editor.inputValue();
  const manual = `${original}\n用户手工补充的真实经历`;
  await editor.fill(manual);

  await page.getByRole("button", { name: "重新生成简历" }).click();
  await expect(page.getByRole("region", { name: "新版本对照" })).toBeVisible();
  await expect(editor).toHaveValue(manual);
  await page.screenshot({ path: testInfo.outputPath("mobile-draft-comparison.png"), fullPage: true });
  await page.getByRole("button", { name: "保留当前草稿" }).click();
  await expect(editor).toHaveValue(manual);

  await page.getByRole("button", { name: "重新生成简历" }).click();
  await page.getByRole("button", { name: "替换当前草稿" }).click();
  await expect(editor).toHaveValue(original);
  await page.getByRole("button", { name: "撤销上一步" }).click();
  await expect(editor).toHaveValue(manual);
});

test("exports an earlier draft with its own filename after the source is changed", async ({ page }) => {
  await generateSampleDraft(page);
  const content = await page.getByLabel("优化版简历正文").inputValue();
  await page.getByRole("button", { name: "移除简历" }).click();
  await page.route("**/api/resume/extract", (route) => route.fulfill({ json: {
    filename: "另一份简历.pdf", characters: 80, text: "另一份简历的正文，与之前的简历内容不同。".repeat(4),
  } }));
  await page.locator('input[type="file"]').setInputFiles({
    name: "另一份简历.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-test"),
  });
  await expect(page.getByText("另一份简历.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("这份草稿对应之前的简历或岗位");
  await expect(page.getByLabel("优化版简历正文")).toHaveValue(content);

  await page.route("**/api/resume/export", (route) => route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4 test" }));
  const requested = page.waitForRequest("**/api/resume/export");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PDF" }).click();
  expect((await requested).postDataJSON()).toMatchObject({ filename: "示例-后端工程师简历.pdf", content });
  expect((await downloaded).suggestedFilename()).toBe("示例-后端工程师简历-优化版.pdf");
});

test("only saves drafts on opt-in and restores their source after a reload", async ({ page }) => {
  await generateSampleDraft(page);
  const content = "陈默的手工编辑版本\n真实项目成果：接口响应时间降低42%";
  await page.getByLabel("优化版简历正文").fill(content);
  expect(await page.evaluate(() => localStorage.getItem("jobtailor:draft:v1"))).toBeNull();
  await page.getByRole("checkbox", { name: "在此设备自动保存草稿" }).check();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jobtailor:draft:v1") ?? "null")?.draft.content)).toBe(content);
  await page.reload();
  await page.getByRole("button", { name: "恢复本机草稿" }).click();
  await expect(page.getByLabel("优化版简历正文")).toHaveValue(content);
  await expect(page.getByText("示例-后端工程师简历.pdf", { exact: true })).toBeVisible();
  await expect(page.getByLabel("目标岗位 JD")).toHaveValue(/Python 后端工程师/);
  await page.getByRole("button", { name: "清除本机草稿" }).click();
  expect(await page.evaluate(() => localStorage.getItem("jobtailor:draft:v1"))).toBeNull();
  await expect(page.getByLabel("优化版简历正文")).toHaveValue(content);
});

test("ignores analysis results for a job description that has changed", async ({ page }) => {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  let routeCompleted: () => void = () => {};
  const completed = new Promise<void>((resolve) => { routeCompleted = resolve; });
  await page.route("**/api/analyze", async (route) => {
    await released;
    await route.fulfill({ contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "summary", data: {
      analysis_mode: "local", score: 99, verdict: "旧岗位的诊断", dimensions: [], requirements: [], matched: [], gaps: [],
    } })}\n${JSON.stringify({ type: "done" })}\n` });
    routeCompleted();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例" }).click();
  const requested = page.waitForRequest("**/api/analyze");
  await page.getByRole("button", { name: "开始匹配分析" }).click();
  await requested;
  await page.getByLabel("目标岗位 JD").fill("新的岗位描述，需要完全不同的岗位技能与经历，请根据新的要求进行分析。".repeat(2));
  release();
  await completed;
  await expect(page.getByRole("button", { name: "开始匹配分析" })).toBeEnabled();
  await expect(page.getByText("分析结果会显示在这里")).toBeVisible();
  await expect(page.getByText("旧岗位的诊断")).toHaveCount(0);
});

test("prevents editing and downloading a draft while AI changes are arriving", async ({ page }) => {
  await generateSampleDraft(page);
  const editor = page.getByLabel("优化版简历正文");
  const original = await editor.inputValue();
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/resume/refine", async (route) => {
    await released;
    await route.fulfill({ contentType: "text/plain", body: `${original}\n更简洁的已有经历表达` });
  });
  await page.getByLabel("AI 修改要求").fill("让表达更简洁");
  await page.getByRole("button", { name: "应用 AI 修改" }).click();
  await expect(editor).toBeDisabled();
  await expect(page.getByLabel("AI 修改要求")).toBeDisabled();
  await expect(page.getByRole("button", { name: "撤销上一步" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "下载 PDF" })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "替换当前草稿" })).toBeEnabled();
  await expect(editor).toHaveValue(original);
  await expect(page.getByRole("region", { name: "AI 修改预览" })).toContainText("更简洁的已有经历表达");
  await page.getByRole("button", { name: "替换当前草稿" }).click();
  await expect(editor).toHaveValue(`${original}\n更简洁的已有经历表达`);
  await page.getByRole("button", { name: "撤销上一步" }).click();
  await expect(editor).toHaveValue(original);
});

test("restores the complete draft if the page reloads during a partial AI response", async ({ page }) => {
  await generateSampleDraft(page);
  const original = `${await page.getByLabel("优化版简历正文").inputValue()}\n用户手工保留的真实成果`;
  await page.getByLabel("优化版简历正文").fill(original);
  await page.getByRole("checkbox", { name: "在此设备自动保存草稿" }).check();
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      if (args[0] === "/api/resume/refine") {
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode("半截 AI 修改内容")); },
        }));
      }
      return originalFetch(...args);
    };
  });
  await page.getByLabel("AI 修改要求").fill("精简当前简历");
  await page.getByRole("button", { name: "应用 AI 修改" }).click();
  await expect(page.getByRole("region", { name: "AI 修改预览" })).toContainText("半截 AI 修改内容");
  await expect(page.getByLabel("优化版简历正文")).toHaveValue(original);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jobtailor:draft:v1") ?? "null")?.draft.content)).toBe(original);
  await page.reload();
  await page.getByRole("button", { name: "恢复本机草稿" }).click();
  await expect(page.getByLabel("优化版简历正文")).toHaveValue(original);
});

test("explains data use and separates alternatives from preferred requirements", async ({ page }) => {
  await page.goto("/");
  await page.getByText("数据如何使用与使用限额", { exact: true }).click();
  await expect(page.locator(".privacy-details")).toContainText("简历和岗位文本不会发送给模型服务");
  await expect(page.locator(".privacy-details")).toContainText("每个浏览器每 10 分钟最多 6 次 AI 请求");
  await page.getByRole("button", { name: "载入示例" }).click();
  await page.getByRole("button", { name: "开始匹配分析" }).click();
  const alternatives = page.locator(".requirement", { hasText: "FastAPI 或 Django" });
  await expect(alternatives).toHaveClass(/pass/);
  await expect(page.locator(".requirement", { hasText: "AWS" })).toContainText("加分");
  await expect(page.locator(".revision-item", { hasText: "技能缺口" })).not.toContainText("Django");
  await expect(page.locator(".revision-item", { hasText: "技能缺口" })).not.toContainText("AWS");
});

test("shows no numeric match score when the local rules cannot recognize the job", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例" }).click();
  await page.getByLabel("目标岗位 JD").fill("市场运营专员，负责品牌活动策划、用户调研、内容制作与社群维护，并跟进活动执行和复盘。");
  await page.getByRole("button", { name: "开始匹配分析" }).click();
  await expect(page.locator(".score-ring")).toContainText("暂不评分");
  await expect(page.locator(".scope-note")).toContainText("不表示简历不匹配");
});

test("highlights new facts in an AI preview and lets users keep their original", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await generateSampleDraft(page);
  const editor = page.getByLabel("优化版简历正文");
  const original = await editor.inputValue();
  await page.route("**/api/resume/refine", (route) => route.fulfill({ contentType: "text/plain", body: `${original}\n负责 Kubernetes 项目，性能提升 99%` }));
  await page.getByLabel("AI 修改要求").fill("更简洁地表达项目贡献");
  await page.getByRole("button", { name: "应用 AI 修改" }).click();
  const preview = page.getByRole("region", { name: "AI 修改预览" });
  await expect(preview).toContainText("新增数字，请核对：99%");
  await expect(preview).toContainText("新增技术或英文术语，请核对：Kubernetes");
  await expect(preview.locator("mark")).toContainText(["负责 Kubernetes 项目，性能提升 99%"]);
  await expect(editor).toHaveValue(original);
  await page.screenshot({ path: testInfo.outputPath("mobile-ai-review.png"), fullPage: true });
  await page.getByRole("button", { name: "保留当前草稿" }).click();
  await expect(editor).toHaveValue(original);
  await expect(preview).toHaveCount(0);
});

test("rejects malformed and incomplete analysis without crashing or enabling generation", async ({ page }) => {
  await page.route("**/api/analyze", (route) => route.fulfill({ contentType: "application/x-ndjson", body: '{"type":"summary","data":{"score":88}}\n{"type":"done"}\n' }));
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例" }).click();
  await page.getByRole("button", { name: "开始匹配分析" }).click();
  await expect(page.locator(".error-message")).toContainText("格式不完整或有误");
  await expect(page.getByRole("button", { name: "开始匹配分析" })).toBeEnabled();
  await expect(page.getByLabel("目标岗位 JD")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新生成简历" })).toHaveCount(0);
});

test("keeps failed AI previews unapplied and displays retry time on a rate limit", async ({ page }) => {
  await generateSampleDraft(page);
  const editor = page.getByLabel("优化版简历正文");
  const original = await editor.inputValue();
  await page.route("**/api/resume/refine", (route) => route.fulfill({ status: 429, json: { detail: "操作过于频繁，请约 10 分钟后再试。", retry_after_seconds: 600 }, headers: { "Retry-After": "600" } }));
  await page.getByLabel("AI 修改要求").fill("精简项目");
  await page.getByRole("button", { name: "应用 AI 修改" }).click();
  await expect(page.locator(".error-message")).toContainText("10 分钟");
  await expect(editor).toHaveValue(original);
  await expect(page.getByRole("button", { name: "替换当前草稿" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下载 PDF" })).toBeEnabled();
});

test("keeps partial analysis visible but prevents generation before a verified completion", async ({ page }) => {
  const summary = { type: "summary", data: {
    analysis_mode: "ai", score: 70, verdict: "部分诊断已返回。",
    dimensions: ["关键词覆盖", "经历证据", "岗位相关性", "表达清晰度"].map((name) => ({ name, score: 70, note: "核对原文依据。" })),
    requirements: [], matched: [], gaps: [],
  } };
  const revision = { type: "revision", data: { id: "partial", priority: "中", category: "摘要", title: "明确岗位方向", original: "陈默", revised: "陈默", reason: "表达更直接。" } };
  await page.route("**/api/analyze", (route) => route.fulfill({ contentType: "application/x-ndjson", body: `${JSON.stringify(summary)}\n${JSON.stringify(revision)}\n` }));
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例" }).click();
  await page.getByRole("button", { name: "开始匹配分析" }).click();
  await expect(page.getByRole("status")).toContainText("分析未完成");
  await page.locator(".revision-item").getByRole("button", { name: "采纳", exact: true }).click();
  await expect(page.getByRole("button", { name: "重新生成简历" })).toBeDisabled();
});

test("an empty code block from AI cannot replace a nonempty draft", async ({ page }) => {
  await generateSampleDraft(page);
  const editor = page.getByLabel("优化版简历正文");
  const original = await editor.inputValue();
  await page.route("**/api/resume/refine", (route) => route.fulfill({ contentType: "text/plain", body: "```text\n```" }));
  await page.getByLabel("AI 修改要求").fill("精简项目");
  await page.getByRole("button", { name: "应用 AI 修改" }).click();
  await expect(page.locator(".error-message")).toContainText("没有可用正文");
  await expect(page.getByRole("button", { name: "替换当前草稿" })).toBeDisabled();
  await expect(editor).toHaveValue(original);
  await page.getByRole("button", { name: "保留当前草稿" }).click();
  await expect(editor).toBeEnabled();
});

test("cancels AI editing while preserving the original and allowing retry", async ({ page }) => {
  await generateSampleDraft(page);
  const editor = page.getByLabel("优化版简历正文");
  const original = await editor.inputValue();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/resume/refine", async (route) => {
    await pending;
    await route.fulfill({ contentType: "text/plain", body: "不应应用的过期修改" });
  });
  await page.getByLabel("AI 修改要求").fill("精简项目");
  const requested = page.waitForRequest("**/api/resume/refine");
  await page.getByRole("button", { name: "应用 AI 修改" }).click();
  await requested;
  await page.getByRole("button", { name: "取消 AI 修改" }).click();
  await expect(page.locator(".error-message")).toContainText("已取消");
  await expect(editor).toHaveValue(original);
  await expect(page.getByRole("button", { name: "应用 AI 修改" })).toBeEnabled();
  release();
});
