import { withPage } from "../lib/browser.js";
import { scrollToBottom } from "../lib/extract.js";

export async function scroll(direction: string): Promise<void> {
  await withPage(async (page) => {
    if (direction === "bottom") {
      await scrollToBottom(page);
    } else {
      await page.evaluate((dir: string) => {
        switch (dir) {
          case "down":
            window.scrollBy(0, window.innerHeight);
            break;
          case "up":
            window.scrollBy(0, -window.innerHeight);
            break;
          case "top":
            window.scrollTo(0, 0);
            break;
          default: {
            const px = parseInt(dir, 10);
            if (!isNaN(px)) {
              window.scrollBy(0, px);
            } else {
              throw new Error(`Unknown scroll direction: ${dir}. Use down, up, bottom, top, or a pixel amount.`);
            }
          }
        }
      }, direction);
    }

    const pos = await page.evaluate(() => ({
      y: Math.round(window.scrollY),
      max: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    }));
    process.stderr.write(`Scrolled to ${pos.y}/${pos.max}px\n`);
  });
}
