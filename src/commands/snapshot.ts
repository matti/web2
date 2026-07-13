import { withPage } from "../lib/browser.js";
import { extractSemdown, formatArticle } from "../lib/extract.js";

export async function snapshot(opts: { format?: string }): Promise<void> {
  await withPage(async (page) => {
    const fmt = opts.format ?? "semdown";

    switch (fmt) {
      case "semdown":
      case "markdown": {
        const article = await extractSemdown(page);
        if (article) {
          console.log(formatArticle(article));
        } else {
          process.stderr.write("No content extracted.\n");
          process.exit(1);
        }
        break;
      }
      case "aria": {
        const yaml = await page.locator("body").ariaSnapshot();
        console.log(yaml);
        break;
      }
      default:
        process.stderr.write(`Unknown format: ${fmt}. Use semdown, aria, or markdown.\n`);
        process.exit(1);
    }
  });
}
