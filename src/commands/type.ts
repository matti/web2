import { withPage } from "../lib/browser.js";

export async function type(
  text: string,
  options: { selector?: string; delay?: number } = {},
): Promise<void> {
  const delay = options.delay ?? 0;

  await withPage(async (page) => {
    if (options.selector) {
      await page.type(options.selector, text, { delay });
    } else {
      await page.keyboard.type(text, { delay });
    }
    process.stderr.write(`Typed: ${text.length} characters\n`);
  });
}

export async function press(key: string): Promise<void> {
  await withPage(async (page) => {
    await page.keyboard.press(key);
    process.stderr.write(`Pressed: ${key}\n`);
  });
}
