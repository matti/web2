import { withPage } from "../lib/browser.js";
import { dbg } from "../lib/debug.js";

export async function reload(opts: { wait?: string }): Promise<void> {
  await withPage(async (page) => {
    const waitMap: Record<string, "commit" | "domcontentloaded" | "networkidle"> = {
      commit: "commit",
      load: "domcontentloaded",
      idle: "networkidle",
    };
    const waitUntil = waitMap[opts.wait ?? "load"] ?? "domcontentloaded";

    const start = performance.now();
    dbg(`reloading (waitUntil=${waitUntil})`);

    await page.reload({ waitUntil: "commit", timeout: 2000 });
    dbg("commit received");
    if (waitUntil === "commit") {
      // Done
    } else if (waitUntil === "domcontentloaded") {
      await page.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {});
    } else {
      await page.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
    }

    const elapsed = Math.round(performance.now() - start);
    dbg(`reload complete in ${elapsed}ms`);

    process.stdout.write(`${page.url()} (${elapsed}ms)\n`);
  });
}
