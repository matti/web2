import { withPage } from "../lib/browser.js";

interface ClickOptions {
  text?: string;
  right?: boolean;
  double?: boolean;
  force?: boolean;
  timeout?: number;
}

export async function click(selector: string, opts: ClickOptions): Promise<void> {
  await withPage(async (page) => {
    const timeout = opts.timeout ?? 2000;
    const button = opts.right ? "right" : "left";

    const locator = opts.text
      ? page.getByText(opts.text, { exact: false })
      : page.locator(selector);

    if (opts.double) {
      await locator.dblclick({ button, force: opts.force, timeout });
    } else {
      await locator.click({ button, force: opts.force, timeout });
    }

    const label = opts.text ?? selector;
    process.stderr.write(`Clicked: ${label}\n`);
  });
}
