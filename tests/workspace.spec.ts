import { expect, test } from "@playwright/test";

test("analyzes a resume against a job and accepts a revision", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "让简历对准岗位，而不是堆关键词" })).toBeVisible();
  await page.getByRole("button", { name: "载入示例" }).click();
  await expect(page.getByText("示例-后端工程师简历.pdf")).toBeVisible();

  await page.getByRole("button", { name: "开始匹配分析" }).click();

  await expect(page.getByRole("heading", { name: "岗位匹配诊断" })).toBeVisible();
  await expect(page.getByText("本地分析预览")).toBeVisible();
  await expect(page.getByRole("heading", { name: "按影响程度逐条处理" })).toBeVisible();

  const summaryRevision = page.locator(".revision-item", { hasText: "让开头直接回应目标岗位" });
  await summaryRevision.getByRole("button", { name: "采纳" }).click();
  await expect(summaryRevision.getByText("已采纳")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新生成简历" })).toBeEnabled();
  await page.screenshot({ path: "../test-results/desktop-analysis.png", fullPage: true });
});

test("keeps upload, JD input, and analysis controls usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
  await expect(page.locator("#source").getByText("上传简历", { exact: true })).toBeVisible();
  await expect(page.getByLabel("目标岗位 JD")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始匹配分析" })).toBeDisabled();

  await page.screenshot({ path: "../test-results/mobile-upload.png", fullPage: true });
});
