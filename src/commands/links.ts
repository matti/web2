import { withPage } from "../lib/browser.js";
import { extractLinks } from "../lib/extract.js";

export async function links(): Promise<void> {
  await withPage(async (page) => {
    const baseUrl = page.url();
    const urls = await extractLinks(page, baseUrl);
    for (const url of urls) {
      process.stdout.write(url + "\n");
    }
  });
}
