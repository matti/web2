import { withPage } from "../lib/browser.js";

interface HoverOptions {
  timeout?: number;
}

export async function hover(selector: string, opts: HoverOptions): Promise<void> {
  await withPage(async (page) => {
    const timeout = opts.timeout ?? 2000;
    await page.locator(selector).hover({ timeout });
    process.stderr.write(`Hovered: ${selector}\n`);
  });
}
