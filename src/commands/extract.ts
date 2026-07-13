import { withPage } from "../lib/browser.js";

export async function extract(
  selector: string,
  opts: { all?: boolean; attr?: string; json?: boolean },
): Promise<void> {
  await withPage(async (page) => {
    if (opts.all) {
      const results = await page.$$eval(
        selector,
        (els, attr) => {
          (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);
          return els.map((el) => {
            const text = el.textContent?.trim() ?? "";
            if (attr) return (el as HTMLElement).getAttribute(attr) ?? "";
            return text;
          });
        },
        opts.attr ?? null,
      );
      if (results.length === 0) {
        process.stderr.write(`No elements matching: ${selector}\n`);
        process.exit(1);
      }
      if (opts.json) {
        const items = await page.$$eval(selector, (els) => {
          (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);
          return els.map((el) => {
            const h = el as HTMLElement;
            const attrs: Record<string, string> = {};
            for (const a of Array.from(h.attributes)) attrs[a.name] = a.value;
            return { text: h.textContent?.trim() ?? "", attrs };
          });
        });
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(results.join("\n"));
      }
    } else {
      const el = await page.$(selector);
      if (!el) {
        process.stderr.write(`No elements matching: ${selector}\n`);
        process.exit(1);
      }
      if (opts.json) {
        const obj = await el.evaluate((e) => {
          (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);
          const h = e as HTMLElement;
          const attrs: Record<string, string> = {};
          for (const a of Array.from(h.attributes)) attrs[a.name] = a.value;
          return { text: h.textContent?.trim() ?? "", attrs };
        });
        console.log(JSON.stringify(obj, null, 2));
      } else if (opts.attr) {
        const val = await el.getAttribute(opts.attr);
        console.log(val ?? "");
      } else {
        const text = await el.evaluate((e) => {
          (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);
          return (e as HTMLElement).textContent?.trim() ?? "";
        });
        console.log(text);
      }
    }
  });
}
