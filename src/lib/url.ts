// Schemes that address something other than a network host. They are valid
// navigation targets but carry no "//" authority, so the ://-shape test below
// would not recognize them.
const AUTHORITYLESS_SCHEMES = new Set([
  "about",
  "blob",
  "chrome",
  "data",
  "javascript",
  "mailto",
  "view-source",
]);

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Turns what a user typed into something Playwright can navigate to.
 *
 * Bare hosts get an http:// prefix ("example.com", "localhost:3000"), while an
 * explicit scheme is left alone. The distinction is not "does it contain a
 * colon": "localhost:3000" is a host and port, not a scheme, so the presence
 * of an authority marker ("//") is what separates the two.
 */
export function normalizeNavigationUrl(url: string): string {
  const match = SCHEME.exec(url);
  if (match) {
    if (url.slice(match[0].length).startsWith("//")) return url;
    if (AUTHORITYLESS_SCHEMES.has(match[1].toLowerCase())) return url;
  }
  return `http://${url}`;
}
