import { withPage } from "../lib/browser.js";

export async function exec(js: string): Promise<void> {
  await withPage(async (page) => {
    const result = await page.evaluate(js);
    console.log(result === undefined ? "undefined" : JSON.stringify(result, null, 2));
  });
}
