import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = resolve(root, "docs");
const html = await readFile(resolve(docs, "index.html"), "utf8");
const css = await readFile(resolve(docs, "site.css"), "utf8");
const script = await readFile(resolve(docs, "site.js"), "utf8");

assert.match(html, /<title>\s*Engineering Observatory/);
assert.match(html, /Work in progress/i);
assert.match(html, /Get the desktop preview/);
assert.match(html, /Preview builds are unsigned/);
assert.match(html, /No repository execution/);
assert.match(html, /Optional AI explanation/);
assert.match(html, /Measured performance/);
assert.match(html, /implementation-status\.md/);
assert.doesNotMatch(html, /localhost|127\.0\.0\.1/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /@media \(max-width: 440px\)/);
assert.match(script, /IntersectionObserver/);

const localAssets = [...html.matchAll(/(?:href|src)="\.\/([^"#?]+)"/g)].map(
  ([, path]) => path,
);

assert.ok(
  localAssets.length >= 4,
  "Expected the page to reference its local assets",
);

for (const asset of localAssets) {
  await access(resolve(docs, asset));
}

console.log(
  `Site smoke passed (${new Set(localAssets).size} local assets checked).`,
);
