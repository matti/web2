import { withPage } from "../lib/browser.js";

export async function fill(
  selector: string,
  value: string,
  options: { clear?: boolean; timeout?: number } = {},
): Promise<void> {
  const timeout = options.timeout ?? 2000;

  await withPage(async (page) => {
    if (options.clear && !value) {
      await page.fill(selector, "", { timeout });
    } else {
      await page.fill(selector, value, { timeout });
    }
    process.stderr.write(`Filled: ${selector}\n`);
  });
}
