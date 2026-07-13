import { execFileSync } from "node:child_process";
import { withPage } from "../lib/browser.js";
import { screenshotPage } from "../lib/screenshot.js";

export async function screenshot(opts: {
  output?: string;
  fullPage?: boolean;
  selector?: string;
  desktop?: boolean;
}): Promise<void> {
  const outputPath = opts.output ?? "screenshot.png";

  if (opts.desktop) {
    execFileSync("scrot", [outputPath], { env: { ...process.env, DISPLAY: ":99" }, stdio: "ignore" });
  } else {
    await withPage(async (page) => {
      if (opts.selector) {
        const el = page.locator(opts.selector).first();
        await el.screenshot({ path: outputPath });
      } else {
        await screenshotPage(page, outputPath, { fullPage: opts.fullPage });
      }
    });
  }

  process.stderr.write(`Screenshot saved to ${outputPath}\n`);
}
