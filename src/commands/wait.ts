import { withPage } from "../lib/browser.js";

export async function wait(condition: string, opts: { timeout?: number }): Promise<void> {
  const timeout = opts.timeout ?? 2000;

  await withPage(async (page) => {
    try {
      if (condition === "network-idle") {
        await page.waitForLoadState("networkidle", { timeout });
      } else if (condition.startsWith("url:")) {
        await page.waitForURL(condition.slice(4), { timeout });
      } else if (condition.startsWith("text:")) {
        await page.waitForSelector(`text=${condition.slice(5)}`, { timeout });
      } else if (condition.startsWith("hidden:")) {
        await page.waitForSelector(condition.slice(7), { state: "hidden", timeout });
      } else {
        await page.waitForSelector(condition, { timeout });
      }
      process.stderr.write(`Ready: ${condition}\n`);
    } catch {
      process.stderr.write(`Timeout waiting for: ${condition} (${timeout}ms)\n`);
      process.exit(1);
    }
  });
}
