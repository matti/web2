import { withPage } from "../lib/browser.js";

export async function pdf(opts: {
  output?: string;
  format?: string;
  landscape?: boolean;
  scale?: number;
}): Promise<void> {
  const path = opts.output ?? "page.pdf";

  await withPage(async (page) => {
    try {
      await page.pdf({
        path,
        format: opts.format ?? "A4",
        landscape: opts.landscape ?? false,
        scale: opts.scale ?? 1,
      });
      process.stderr.write(`PDF saved to ${path}\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`PDF error: ${msg}\nNote: PDF only works in headless Chromium.\n`);
      process.exit(1);
    }
  });
}
