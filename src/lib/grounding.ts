import { withPage } from "./browser.js";

/**
 * Format the grounding line printed after a page-mutating command:
 *   → https://example.com/login - "Sign in"
 *
 * Split out from printGrounding so the documented format is unit-testable
 * without a browser.
 */
export function groundingLine(url: string, title: string): string {
  return `→ ${url} - "${title}"\n`;
}

/**
 * Print the grounding line after a page-mutating command.
 *
 * Written to stderr so stdout stays pipeable. Best-effort: a failure to read
 * the page (e.g. the tab was just closed) must never fail the command that
 * already succeeded.
 */
export async function printGrounding(): Promise<void> {
  try {
    await withPage(async (page) => {
      const title = await page.title().catch(() => "");
      process.stderr.write(groundingLine(page.url(), title));
    });
  } catch {
    /* best-effort */
  }
}
