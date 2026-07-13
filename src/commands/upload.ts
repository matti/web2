import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { withPage } from "../lib/browser.js";

// upload attaches one or more files to an <input type="file"> element.
// It resolves the element with the SAME page-level selector logic that
// fill uses (page.<verb>(selector, ...)), then calls Playwright's
// setInputFiles so the browser treats the files as if the user picked them.
export async function upload(
  selector: string,
  files: string[],
  options: { timeout?: number } = {},
): Promise<void> {
  const timeout = options.timeout ?? 2000;

  if (files.length === 0) {
    process.stderr.write("Error: provide at least one file to upload\n");
    process.exit(1);
  }

  const paths = files.map((f) => resolve(f));
  for (const p of paths) {
    if (!existsSync(p)) {
      process.stderr.write(`Error: file not found: ${p}\n`);
      process.exit(1);
    }
  }

  await withPage(async (page) => {
    await page.setInputFiles(selector, paths, { timeout });
    process.stderr.write(`Uploaded: ${selector} <- ${paths.join(", ")}\n`);
  });
}
