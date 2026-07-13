const enabled = process.env.WEB_DEBUG === "1";

export function dbg(msg: string): void {
  if (!enabled) return;
  const t = new Date();
  const ts = t.toTimeString().slice(0, 8) + "." + String(t.getMilliseconds()).padStart(3, "0");
  process.stderr.write(`[${ts}] ${msg}\n`);
}
