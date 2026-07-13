import { withPage } from "../lib/browser.js";
import { dismissCookieBanner } from "../lib/extract.js";

export async function dismissCookies(): Promise<void> {
  await withPage(async (page) => {
    await dismissCookieBanner(page);
    process.stderr.write("Cookie banner dismissed.\n");
  });
}
