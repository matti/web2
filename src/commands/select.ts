import { withPage } from "../lib/browser.js";

export async function select(selector: string, values: string[]): Promise<void> {
  await withPage(async (page) => {
    await page.selectOption(selector, values);
    process.stderr.write(`Selected: ${values.join(", ")}\n`);
  });
}
