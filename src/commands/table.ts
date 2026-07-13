import { withPage } from "../lib/browser.js";

export async function table(
  selector: string,
  opts: { json?: boolean; csv?: boolean; headers?: boolean },
): Promise<void> {
  await withPage(async (page) => {
    const sel = selector || "table";
    const found = await page.$(sel);
    if (!found) {
      process.stderr.write("No table found\n");
      process.exit(1);
    }

    const data = await page.$eval(sel, (tbl: Element) => {
      (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);
      const rows = Array.from(tbl.querySelectorAll("tr"));
      const result: string[][] = rows.map((tr) =>
        Array.from(tr.querySelectorAll("th, td")).map(
          (cell) => (cell.textContent || "").trim(),
        ),
      );
      const hasThInFirst =
        rows.length > 0 &&
        rows[0].querySelector("th") !== null;
      return { rows: result, hasThInFirst };
    });

    let headers: string[] | null = null;
    let rows = data.rows;

    if (data.hasThInFirst || opts.headers) {
      headers = rows[0] || [];
      rows = rows.slice(1);
    }

    if (opts.json) {
      if (headers) {
        const objects = rows.map((row) => {
          const obj: Record<string, string> = {};
          headers!.forEach((h, i) => (obj[h] = row[i] ?? ""));
          return obj;
        });
        console.log(JSON.stringify(objects, null, 2));
      } else {
        console.log(JSON.stringify(rows, null, 2));
      }
    } else if (opts.csv) {
      const csvRow = (r: string[]) =>
        r.map((f) => (f.includes(",") || f.includes('"') || f.includes("\n") || f.includes("\r") ? `"${f.replace(/"/g, '""')}"` : f)).join(",");
      if (headers) console.log(csvRow(headers));
      rows.forEach((r) => console.log(csvRow(r)));
    } else {
      const all = headers ? [headers, ...rows] : rows;
      if (all.length === 0) return;
      const colCount = Math.max(...all.map((r) => r.length));
      const widths = Array.from({ length: colCount }, (_, i) =>
        Math.max(...all.map((r) => (r[i] || "").length)),
      );
      const pad = (r: string[]) =>
        r.map((v, i) => (v || "").padEnd(widths[i])).join("  ");
      if (headers) {
        console.log(pad(headers));
        console.log(widths.map((w) => "-".repeat(w)).join("  "));
      }
      rows.forEach((r) => console.log(pad(r)));
    }
  });
}
