function sanitizeLine(value: string): string {
  const line = value.split(/[\r\n\u2028\u2029]/, 1)[0];
  return line.replace(/\/app\/[^\s)"']*/g, "[internal path]");
}

export function formatCliError(err: unknown): string {
  const message = err == null
    ? "unknown error"
    : err instanceof Error
      ? err.message
      : String(err);

  const navigation = message.match(/net::(ERR_[A-Z0-9_]+) at (\S+)/);
  if (navigation) {
    const [, code, url] = navigation;
    return `error: navigation failed: ${code} (${sanitizeLine(url)})`;
  }

  const timeout = message.match(/Timeout (\d+)ms exceeded/);
  if (timeout) {
    return `error: timeout after ${timeout[1]}ms`;
  }

  return `error: ${sanitizeLine(message)}`;
}
