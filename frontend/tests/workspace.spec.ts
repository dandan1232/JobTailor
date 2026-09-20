import { expect, test } from "@playwright/test";

test("analyzes a job description with the local API", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "把真实经历，对准这个岗位" })).toBeVisible();
  await expect(page.getByLabel("目标职位")).toHaveValue("Python 后端工程师");

  await page.getByRole("button", { name: "分析岗位匹配" }).click();

  await expect(page.getByLabel("岗位匹配度 56 分")).toBeVisible();
  await expect(page.getByText("Kubernetes", { exact: true })).toBeVisible();
  await expect(page.getByText("目标岗位为Python 后端工程师", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "创建简历版本" }).click();
  await expect(page.getByRole("button", { name: "简历版本已创建" })).toBeDisabled();
});

test("keeps the workflow usable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
  await expect(page.getByLabel("目标职位")).toBeVisible();
  await expect(page.getByRole("button", { name: "分析岗位匹配" })).toBeVisible();

  await page.screenshot({ path: "../test-results/mobile.png", fullPage: true });
});
