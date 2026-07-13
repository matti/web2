import type { Page } from "playwright";

export async function screenshotPage(
  page: Page,
  outputPath: string,
  opts: { fullPage?: boolean },
): Promise<void> {
  await page.screenshot({ path: outputPath, fullPage: opts.fullPage ?? false });
}
