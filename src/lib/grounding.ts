import { withPage } from "./browser.js";

/**
 * Print the grounding line after a page-mutating command:
 *   → https://example.com/login — "Sign in"
 *
 * Written to stderr so stdout stays pipeable. Best-effort: a failure to read
 * the page (e.g. the tab was just closed) must never fail the command that
 * already succeeded.
 */
export async function printGrounding(): Promise<void> {
  try {
    await withPage(async (page) => {
      const title = await page.title().catch(() => "");
      process.stderr.write(`→ ${page.url()} — "${title}"\n`);
    });
  } catch {
    /* best-effort */
  }
}
