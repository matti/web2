#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// --- HTML helpers ---

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body><main><article>
<h1>${title}</h1>
${body}
</article></main></body></html>`;
}

function linksParagraph(links: [string, string][]): string {
  return links
    .map(([href, text]) => `<p><a href="${href}">${text}</a></p>`)
    .join("\n");
}

function page(title: string, description: string, links: [string, string][]): string {
  return htmlPage(title, `<p>${description}</p>\n${linksParagraph(links)}`);
}

// --- Route definitions ---

const PAGES: Record<string, () => string> = {
  "/": () =>
    page("Home", "Welcome to the mock site.", [
      ["/about", "About"],
      ["/blog", "Blog"],
      ["/products", "Products"],
      ["/redirect/temp", "Temporary redirect"],
      ["/redirect/chain", "Chain redirect"],
    ]),
  "/about": () =>
    page("About", "About this mock site.", [
      ["/team", "Team"],
      ["/contact", "Contact"],
      ["/cycle/a", "Cycle A"],
      ["/external-only", "External Only"],
      ["/error/404", "Missing page"],
    ]),
  "/blog": () =>
    page("Blog", "Blog index.", [
      ["/blog/post-1", "Post One"],
      ["/blog/post-2", "Post Two"],
      ["/blog/post-3", "Post Three"],
    ]),
  "/blog/post-1": () =>
    page("Post One", "First blog post.", [
      ["/blog/post-2", "Post Two"],
      ["/about", "About"],
      ["/canonical?utm_source=x&fbclid=y", "Canonical with tracking"],
    ]),
  "/blog/post-2": () =>
    page("Post Two", "Second blog post.", [
      ["/blog/post-1", "Post One"],
    ]),
  "/blog/post-3": () =>
    page("Post Three", "Third blog post. This is a leaf page.", []),
  "/products": () =>
    page("Products", "Product catalog.", [
      ["/products/widget", "Widget"],
      ["/products/gadget", "Gadget"],
      ["/trap/1", "Trap entry"],
      ["/dup/version-a", "Dup A"],
      ["/dup/version-b", "Dup B"],
    ]),
  "/products/widget": () =>
    page("Widget", "The widget product page.", [
      ["/products", "Back to Products"],
    ]),
  "/products/gadget": () =>
    page("Gadget", "The gadget product page.", [
      ["/products/widget", "Widget"],
    ]),
  "/team": () =>
    page("Team", "Meet the team.", [
      ["/about", "About"],
    ]),
  "/contact": () =>
    page("Contact", "Contact us.", [
      ["/slow/3s", "Slow page"],
    ]),

  // Cycle
  "/cycle/a": () =>
    page("Cycle A", "Cycle node A.", [["/cycle/b", "Cycle B"]]),
  "/cycle/b": () =>
    page("Cycle B", "Cycle node B.", [["/cycle/c", "Cycle C"]]),
  "/cycle/c": () =>
    page("Cycle C", "Cycle node C.", [["/cycle/a", "Cycle A"]]),

  // External-only
  "/external-only": () =>
    page("External Only", "This page only links externally.", [
      ["https://example.com", "Example.com"],
    ]),

  // Canonical (target of tracking-param link)
  "/canonical": () =>
    page("Canonical", "The canonical page, no tracking params here.", []),

  // Duplicate content
  "/dup/version-a": () =>
    page("Duplicate Content", "This content is duplicated across two URLs.", []),
  "/dup/version-b": () =>
    page("Duplicate Content", "This content is duplicated across two URLs.", []),

  // Sitemap-only pages (not linked from any page)
  "/sitemap-only-1": () =>
    page("Sitemap Only 1", "Discoverable only via sitemap.", []),
  "/sitemap-only-2": () =>
    page("Sitemap Only 2", "Discoverable only via sitemap.", []),

  // Error pages
  "/error/empty": () => "",

  // Dialog page (tests dialog content not being skipped in semdown)
  "/dialog-page": () => `<!DOCTYPE html>
<html><head><title>Dialog Page</title></head>
<body>
<dialog open>
  <p>We use cookies to improve your experience</p>
  <button>Accept all cookies</button>
</dialog>
<main><article>
<h1>Dialog Page</h1>
<p>Main content of the dialog page.</p>
</article></main></body></html>`,

  // WordPress-style article with nested divs (tests reader doesn't truncate)
  "/article": () => `<!DOCTYPE html>
<html><head><title>Nested Article</title><meta name="description" content="An article with nested div structure"></head>
<body><main><article>
<h1>Nested Article</h1>
<div class="entry-content">
  <p>First paragraph of the article. This is a longer introduction to ensure Readability considers this content substantial enough to extract. The article discusses important topics that span multiple sections and paragraphs.</p>
  <div class="wp-block-group">
    <h2>Section One</h2>
    <div class="wp-block-column">
      <p>Content inside nested divs that must not be lost. This paragraph contains critical information that the reader command should preserve even when wrapped in multiple layers of div elements, as is common in WordPress block editor output.</p>
      <p>Second paragraph in the nested div. Additional details about the topic being discussed in section one, providing further context and explanation for the reader.</p>
    </div>
  </div>
  <div class="wp-block-group">
    <h2>Section Two</h2>
    <div class="wp-block-column">
      <p>More content in another nested group. This section covers a different aspect of the topic with its own detailed explanation and supporting points listed below.</p>
      <ul><li>Item alpha</li><li>Item beta</li><li>Item gamma</li></ul>
    </div>
  </div>
  <p>Final paragraph of the article. This concludes the discussion with a summary of the key points covered in sections one and two above.</p>
</div>
</article></main></body></html>`,

  // Form page (for fill, type, select, click testing)
  "/form": () => `<!DOCTYPE html>
<html><head><title>Form Page</title></head>
<body>
<form id="test-form">
  <label for="name">Name</label>
  <input type="text" id="name" name="name" placeholder="Enter name">
  <label for="email">Email</label>
  <input type="email" id="email" name="email">
  <label for="message">Message</label>
  <textarea id="message" name="message"></textarea>
  <label for="color">Color</label>
  <select id="color" name="color">
    <option value="red">Red</option>
    <option value="green">Green</option>
    <option value="blue">Blue</option>
  </select>
  <button type="submit" id="submit-btn">Submit</button>
  <button type="button" id="click-btn" onclick="document.getElementById('result').textContent='clicked'">Click Me</button>
  <!-- Labels here must not contain each other as substrings: click --text
       matches by substring, so a "Double Click Me" would make --text "Click Me"
       ambiguous and fail with a strict-mode violation. -->
  <button type="button" id="double-btn" ondblclick="document.getElementById('result').textContent='double-clicked'">Double Tap</button>
  <div id="context-target" oncontextmenu="event.preventDefault(); document.getElementById('result').textContent='right-clicked'">Context Target</div>
  <div id="result"></div>
</form>
</body></html>`,

  // File inputs report the attached names and sizes so upload can be
  // verified through the page, not only through the command's own output.
  "/upload": () => `<!DOCTYPE html>
<html><head><title>Upload Page</title></head>
<body>
<label>Single file <input type="file" id="single-file"></label>
<output id="single-result"></output>
<label>Multiple files <input type="file" id="multiple-files" multiple></label>
<output id="multiple-result"></output>
<script>
  const describeFiles = (input) =>
    Array.from(input.files, (file) => file.name + ':' + file.size).join(',');
  document.getElementById('single-file').addEventListener('change', (event) => {
    document.getElementById('single-result').textContent = describeFiles(event.target);
  });
  document.getElementById('multiple-files').addEventListener('change', (event) => {
    document.getElementById('multiple-result').textContent = describeFiles(event.target);
  });
</script>
</body></html>`,

  // Exercises wait conditions against real asynchronous browser state.
  //
  // The page records its own starting state, so a test can prove the wait
  // observed a real transition without racing the timer: asking the browser
  // "is the spinner still here?" before waiting costs a CLI round trip and
  // eats the very window the test needs.
  "/wait-states": () => `<!DOCTYPE html>
<html><head><title>Wait States</title></head>
<body>
<div id="spinner">Working...</div>
<script>
  window.__spinnerExisted = document.getElementById('spinner') !== null;
  window.__initialPath = location.pathname;
  setTimeout(() => document.getElementById('spinner').remove(), 1500);
  setTimeout(() => history.replaceState(null, '', '/wait-complete'), 1500);
</script>
</body></html>`,

  // Hover page (tooltip on hover)
  "/hover": () => `<!DOCTYPE html>
<html><head><title>Hover Page</title></head>
<body>
<div id="hover-target" onmouseenter="document.getElementById('tooltip').style.display='block'" onmouseleave="document.getElementById('tooltip').style.display='none'">
  Hover over me
</div>
<div id="tooltip" style="display:none">Tooltip visible</div>
</body></html>`,

  // Delayed content page (content appears after delay)
  "/delayed": () => `<!DOCTYPE html>
<html><head><title>Delayed Page</title></head>
<body>
<div id="placeholder">Loading...</div>
<script>
  setTimeout(() => {
    document.getElementById('placeholder').textContent = 'Content loaded';
    const el = document.createElement('div');
    el.id = 'delayed-content';
    el.textContent = 'Delayed content appeared';
    document.body.appendChild(el);
  }, 500);
</script>
</body></html>`,

  // Printable page (clean page for PDF testing)
  "/printable": () => `<!DOCTYPE html>
<html><head><title>Printable Page</title></head>
<body>
<h1>Printable Page</h1>
<p>This is a clean page for PDF generation testing.</p>
<p>It has minimal styling and simple content.</p>
</body></html>`,

  // Table page (for extract and table testing)
  "/table-page": () => `<!DOCTYPE html>
<html><head><title>Table Page</title></head>
<body>
<h1>Products</h1>
<p>Browse our <a href="/about">catalog</a> of products.</p>
<table id="products">
  <tr><th>Name</th><th>Price</th><th>Stock</th></tr>
  <tr><td>Widget</td><td>$9.99</td><td>42</td></tr>
  <tr><td>Gadget</td><td>$24.99</td><td>7</td></tr>
  <tr><td>Doohickey</td><td>$4.50</td><td>100</td></tr>
</table>
</body></html>`,

  // Scroll page (tall content for scroll testing)
  "/scroll-page": () => {
    let paras = "";
    for (let i = 1; i <= 100; i++) {
      paras += `<p>Paragraph ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>\n`;
    }
    return htmlPage("Scroll Page", paras);
  },
};

// --- Redirects ---

const REDIRECTS: Record<string, [number, string]> = {
  "/redirect/temp": [302, "/about"],
  "/redirect/perm": [301, "/products"],
  "/redirect/chain": [301, "/redirect/chain2"],
  "/redirect/chain2": [301, "/team"],
  "/redirect/external": [302, "https://example.com"],
};

// --- Handler ---

function handler(baseUrl: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || "/", baseUrl);
  const path = url.pathname;

  // robots.txt
  if (path === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap-index.xml\n`);
    return;
  }

  // Sitemap index
  if (path === "/sitemap-index.xml") {
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${baseUrl}/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`);
    return;
  }

  // Sitemap pages
  if (path === "/sitemap-pages.xml") {
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${baseUrl}/sitemap-only-1</loc></url>
  <url><loc>${baseUrl}/sitemap-only-2</loc></url>
  <url><loc>${baseUrl}/canonical</loc></url>
</urlset>`);
    return;
  }

  // Redirects
  if (REDIRECTS[path]) {
    const [code, target] = REDIRECTS[path];
    const location = target.startsWith("http") ? target : `${baseUrl}${target}`;
    res.writeHead(code, { Location: location });
    res.end();
    return;
  }

  // Slow endpoints
  if (path === "/slow/3s") {
    setTimeout(() => {
      const body = page("Slow Page", "This page took 3 seconds to load.", []);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(body);
    }, 3000);
    return;
  }
  if (path === "/slow/forever") {
    // Never respond - tests navigate timeout
    return;
  }

  // Infinite trap: /trap/N → links to /trap/N+1 and /trap/N+2
  const trapMatch = path.match(/^\/trap\/(\d+)$/);
  if (trapMatch) {
    const n = parseInt(trapMatch[1], 10);
    const body = page(`Trap ${n}`, `Trap page ${n}.`, [
      [`/trap/${n + 1}`, `Trap ${n + 1}`],
      [`/trap/${n + 2}`, `Trap ${n + 2}`],
    ]);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body);
    return;
  }

  // Error pages
  if (path === "/error/404") {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(htmlPage("Not Found", "<p>404 - page not found.</p>"));
    return;
  }
  if (path === "/error/500") {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(htmlPage("Server Error", "<p>500 - internal server error.</p>"));
    return;
  }

  // Cookie-setting page (needs custom headers, can't use PAGES map)
  if (path === "/cookies-page") {
    const body = page("Cookie Page", "This page sets cookies.", []);
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Set-Cookie": [
        "mockCookie=hello; Path=/",
        "testSession=abc123; Path=/; HttpOnly",
      ],
    });
    res.end(body);
    return;
  }

  // Static pages
  if (PAGES[path]) {
    const body = PAGES[path]();
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body);
    return;
  }

  // Default: 404
  res.writeHead(404, { "Content-Type": "text/html" });
  res.end(htmlPage("Not Found", "<p>404 - page not found.</p>"));
}

// --- Start server ---

const server = createServer((req, res) => handler(baseUrl, req, res));

let baseUrl = "";

server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  if (addr && typeof addr === "object") {
    baseUrl = `http://127.0.0.1:${addr.port}`;
    // Print URL to stdout so callers can pick it up
    process.stdout.write(baseUrl + "\n");
  }
});
