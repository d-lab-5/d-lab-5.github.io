#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (C) 2026 D-LAB-5
/**
 * Every internal link in the built site resolves to a file in it: root-absolute
 * ones against the site, relative ones against their page. Archify's diagram
 * pages are skipped (their links are their own viewer's).
 *
 *   node scripts/links.mjs [_site]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] || "_site");
const pages = [];
(function walk(d) {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, f.name);
    if (f.isDirectory()) walk(p); else if (p.endsWith(".html")) pages.push(p);
  }
})(root);
const archify = (p) => /\/diagrams\/[^/]+\.html$/.test(p) && !p.endsWith("/diagrams/index.html");
let bad = 0, links = 0;
for (const p of pages.filter((p) => !archify(p))) {
  for (const [, href] of readFileSync(p, "utf8").matchAll(/(?:href|src)="([^"#?]*)/g)) {
    if (!href || /^(https?:|mailto:|data:)/.test(href)) continue;
    links++;
    let t = href.startsWith("/") ? join(root, href) : resolve(dirname(p), href);
    if (existsSync(t) && statSync(t).isDirectory()) t = join(t, "index.html");
    if (!existsSync(t)) { bad++; console.error(`✗ ${relative(root, p)}: ${href}`); }
  }
}
if (bad) { console.error(`${bad} of ${links} links broken`); process.exit(1); }
console.log(`✓ ${links} links in ${pages.length} pages resolve`);
