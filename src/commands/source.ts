import { withPage } from "../lib/browser.js";

export async function source(): Promise<void> {
  await withPage(async (page) => {
    const html = await page.content();
    process.stdout.write(html);
  });
}
