import { withPage } from "../lib/browser.js";

/**
 * Report the state of this browser: current URL, title, viewport, tab count.
 * The host binary adds container-level facts (uptime, timeouts) around this.
 */
export async function status(opts: { json?: boolean }): Promise<void> {
  await withPage(async (page) => {
    const title = await page.title().catch(() => "");
    const url = page.url();
    const vp = page.viewportSize();
    const tabs = page.context().pages().length;
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, url, title, viewport: vp, tabs }));
    } else {
      console.log(`url:      ${url}`);
      console.log(`title:    ${title}`);
      console.log(`viewport: ${vp ? `${vp.width}x${vp.height}` : "unknown"}`);
      console.log(`tabs:     ${tabs}`);
    }
  });
}
