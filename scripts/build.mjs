#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (C) 2026 D-LAB-5
/**
 * Builds docs.dlab5.net from sites.json: every product's docs repository
 * (made from template-dlab5-shared), each under /<domain>/<slug>/, with an
 * index of the domains and one page per domain.
 *
 * A product's build runs that product's own code (npm ci, scripts/site.mjs),
 * so it is kept apart from everything else. In CI each product builds in a
 * job of its own and hands over only its folder; the assembler, which runs no
 * product code, takes from each folder only what is safe and puts it under
 * that product's path, and nowhere else.
 *
 *   node scripts/build.mjs --matrix                         the products, as JSON for the CI matrix
 *   node scripts/build.mjs --only <domain>/<slug> --out <dir> [--cache <dir>]
 *                                                           build one product into <dir>
 *   node scripts/build.mjs --assemble <parts> [--out _site] the site from the products' folders
 *   node scripts/build.mjs [--sources <dir>]                all of it, one after another (local use)
 *
 * --only: a shallow clone of the product's main, `npm ci --ignore-scripts`,
 * and its scripts/site.mjs with --base /<domain>/<slug>/. When that fails,
 * the last good copy from --cache is used and marked stale.
 *
 * --assemble <parts>: <parts>/<domain>__<slug>/ holds one product's folder.
 * Only regular files with known web types are taken; symlinks, anything
 * outside the folder, oversized files and a site.json naming another product
 * are refused, and the product is left out and named.
 *
 * --sources <dir> uses <dir>/<repo name> instead of cloning, when it is there.
 *
 * Exit status 1 when any product failed, after writing everything else.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const OUT = resolve(ROOT, arg("--out", "_site"));
const CACHE = resolve(ROOT, arg("--cache", "cache"));
const SOURCES = arg("--sources", "") && resolve(arg("--sources"));
const DOMAIN = "docs.dlab5.net";
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// what a product's folder may hold: the files the template's site.mjs writes
const SAFE = /\.(html|css|json|ttl|svg|png|jpe?g|webp|gif|ico|txt|woff2?)$/i;
const MAX_FILE = 15 * 1024 * 1024;
const MAX_FILES = 2000;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const run = (cmd, args, cwd, env) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
const partName = (d, slug) => `${d}__${slug}`;

/** The registry, checked: a mistake in it stops the build before anything is fetched. */
function registry() {
  const r = JSON.parse(readFileSync(join(ROOT, "sites.json"), "utf8"));
  const ids = new Set();
  const seen = new Set();
  for (const d of r.domains || []) {
    if (!SLUG.test(d.id || "") || ids.has(d.id)) throw new Error(`sites.json: domain id "${d.id}" is missing, malformed or repeated`);
    ids.add(d.id);
    for (const p of d.products || []) {
      if (!SLUG.test(p.slug || "")) throw new Error(`sites.json: ${d.id}: slug "${p.slug}" is lowercase letters, digits and -`);
      if (!REPO.test(p.repo || "")) throw new Error(`sites.json: ${d.id}/${p.slug}: repo is owner/name`);
      if (seen.has(`${d.id}/${p.slug}`)) throw new Error(`sites.json: ${d.id}/${p.slug} is listed twice`);
      seen.add(`${d.id}/${p.slug}`);
    }
  }
  if (!REPO.test(r.template || "")) throw new Error("sites.json: template is owner/name");
  return r;
}

/** A repository's working copy: a local checkout under --sources, or a fresh shallow clone of main. */
function checkout(repo, work) {
  const local = SOURCES && join(SOURCES, repo.split("/")[1]);
  if (local && existsSync(join(local, ".git"))) return local;
  const dir = join(work, repo.replace("/", "__"));
  rmSync(dir, { recursive: true, force: true });
  run("git", ["clone", "--quiet", "--depth", "1", "--branch", "main", `https://github.com/${repo}.git`, dir]);
  return dir;
}

/** The environment a product's code runs with: a path and a home, and no tokens of the job. */
function bare(work) {
  return { PATH: process.env.PATH, HOME: work, LANG: "C.UTF-8", npm_config_cache: join(work, ".npm") };
}

/** One product into `to`; on failure its last good copy from the cache. */
function buildProduct(domain, p, to, work) {
  const base = `/${domain.id}/${p.slug}/`;
  const kept = join(CACHE, domain.id, p.slug);
  try {
    const dir = checkout(p.repo, work);
    if (!existsSync(join(dir, "scripts", "site.mjs"))) throw new Error("no scripts/site.mjs: is it made from template-dlab5-shared?");
    if (!existsSync(join(dir, "node_modules"))) run("npm", ["ci", "--ignore-scripts", "--silent", "--no-audit", "--no-fund"], dir, bare(work));
    rmSync(to, { recursive: true, force: true });
    run("node", ["scripts/site.mjs", "--base", base, "--out", to], dir, bare(work));
    rmSync(join(to, "CNAME"), { force: true });            // the product's own domain is not this site's
    const m = JSON.parse(readFileSync(join(to, "site.json"), "utf8"));
    if (m.slug !== p.slug || m.domain !== domain.id) {
      throw new Error(`its shared.json says ${m.domain}/${m.slug}, the registry ${domain.id}/${p.slug}`);
    }
    rmSync(kept, { recursive: true, force: true });
    mkdirSync(dirname(kept), { recursive: true });
    cpSync(to, kept, { recursive: true });
    return { state: "built" };
  } catch (e) {
    const why = String(e.stderr || e.message || e).trim().split("\n").slice(-3).join(" ").slice(0, 400);
    if (existsSync(join(kept, "site.json"))) {
      rmSync(to, { recursive: true, force: true });
      cpSync(kept, to, { recursive: true });
      writeFileSync(join(to, ".stale"), why + "\n");
      return { state: "stale", why };
    }
    return { state: "failed", why };
  }
}

/**
 * The files of one product's folder that may be published, as relative
 * paths; throws a sentence when the folder breaks a rule.
 */
function vet(dir, d, p) {
  const files = [];
  const walk = (at) => {
    for (const f of readdirSync(at)) {
      const path = join(at, f);
      const st = lstatSync(path);
      const rel = relative(dir, path);
      if (rel.startsWith("..") || rel.split(sep).some((x) => x === ".." || x === "")) throw new Error(`a path outside its folder: ${rel}`);
      if (st.isSymbolicLink()) throw new Error(`a symlink: ${rel}`);
      if (st.isDirectory()) { walk(path); continue; }
      if (!st.isFile()) throw new Error(`not a regular file: ${rel}`);
      if (f === ".stale" || f === ".nojekyll") continue;
      if (!SAFE.test(f)) throw new Error(`a file type the site does not publish: ${rel}`);
      if (st.size > MAX_FILE) throw new Error(`too big: ${rel}`);
      files.push(rel);
      if (files.length > MAX_FILES) throw new Error(`more than ${MAX_FILES} files`);
    }
  };
  walk(dir);
  if (!files.includes("site.json") || !files.includes("index.html")) throw new Error("no site.json or index.html");
  const m = JSON.parse(readFileSync(join(dir, "site.json"), "utf8"));
  if (m.slug !== p.slug || m.domain !== d.id) throw new Error(`its site.json says ${m.domain}/${m.slug}`);
  const clean = (s, n) => String(s ?? "").slice(0, n);
  const manifest = { product: clean(m.product, 80) || p.slug, description: clean(m.description, 300),
    own_domain: /^[a-z0-9.-]{1,253}$/.test(m.own_domain || "") ? m.own_domain : null,
    commit: /^[0-9a-f]{40}$/.test(m.commit || "") ? m.commit : null,
    counts: Object.fromEntries(["diagrams", "adrs", "classes"].map((k) => [k, Number.isInteger(m.counts?.[k]) ? m.counts[k] : 0])) };
  return { files, manifest, stale: existsSync(join(dir, ".stale")) };
}

function frame({ title, body, up = "/" }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Documentation sites of the D-LAB-5 products.">
<link rel="stylesheet" href="${up}assets/site.css">
<!-- generated by scripts/build.mjs from sites.json -->
</head><body>
<header class="top"><a class="brand" href="${up}">D-LAB-5 <span>docs</span></a><nav><a href="${up}#domains">Domains</a><a href="https://github.com/d-lab-5/template-dlab5-shared">Template</a></nav></header>
<main>${body}</main>
<footer>D-LAB-5 · <a href="https://github.com/d-lab-5/d-lab-5.github.io">source of this index</a> · each product's pages from its own repository · text CC BY 4.0</footer>
</body></html>
`;
}

function card(p) {
  const m = p.manifest;
  const c = m.counts;
  const size = [c.diagrams && `${c.diagrams} diagrams`, c.adrs && `${c.adrs} decisions`, c.classes && `${c.classes} classes`].filter(Boolean).join(" · ");
  return `<article class="card"><a class="card__main" href="${esc(p.base)}"><span class="kind">${esc(p.slug)}</span><h3>${esc(m.product)}</h3>${
    m.description ? `<p>${esc(m.description)}</p>` : ""}<p class="size">${esc(size)}${p.state === "stale" ? " · the latest build failed; this is the copy before" : ""}</p></a>${
    m.own_domain ? `<a class="card__adr" href="https://${esc(m.own_domain)}/">${esc(m.own_domain)}</a>` : ""}</article>`;
}

function domainSection(d, products, link) {
  const shown = products.filter((p) => p.manifest);
  const head = link ? `<h2><a href="/${esc(d.id)}/">${esc(d.label)}</a></h2>` : "";
  return `<section class="group" id="${esc(d.id)}">${head}<p class="lead">${esc(d.about || "")}</p>${
    shown.length ? `<div class="grid">${shown.map(card).join("")}</div>`
      : `<p class="empty">No product docs yet. Make them with <a href="https://github.com/d-lab-5/template-dlab5-shared">template-dlab5-shared</a> and add a line to <code>sites.json</code>.</p>`}</section>`;
}

/** The site from the products' folders under `parts`. Runs no product code. */
export function assemble(parts) {
  const r = registry();
  const work = join(tmpdir(), `dlab5-docs-${process.pid}`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "assets"), { recursive: true });
  const results = [];
  try {
    const tpl = checkout(r.template, work);
    const css = [join(tpl, "template", "site", "site.css"), join(tpl, "site", "site.css")].find((f) => existsSync(f));
    if (!css) throw new Error(`${r.template} has no site/site.css`);
    cpSync(css, join(OUT, "assets", "site.css"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  for (const d of r.domains) {
    d.built = (d.products || []).map((p) => {
      const base = `/${d.id}/${p.slug}/`;
      const name = partName(d.id, p.slug);
      const dir = [join(parts, name), join(parts, `docs-part-${name}`)].find((x) => existsSync(x)) || join(parts, name);
      let res;
      if (!existsSync(join(dir, "site.json"))) res = { ...p, base, state: "failed", why: "no build of it" };
      else {
        try {
          const v = vet(dir, d, p);
          const to = join(OUT, d.id, p.slug);
          for (const f of v.files) { mkdirSync(dirname(join(to, f)), { recursive: true }); cpSync(join(dir, f), join(to, f)); }
          res = { ...p, base, manifest: v.manifest, state: v.stale ? "stale" : "built" };
        } catch (e) { res = { ...p, base, state: "failed", why: `refused: ${e.message}` }; }
      }
      console.log(`${res.state === "built" ? "placed" : res.state === "stale" ? "KEPT  " : "LEFT OUT"} ${d.id}/${p.slug}${res.why ? `: ${res.why}` : ""}`);
      results.push(res);
      return res;
    });
    mkdirSync(join(OUT, d.id), { recursive: true });
    writeFileSync(join(OUT, d.id, "index.html"), frame({ title: `${d.label} · D-LAB-5 docs`,
      body: `<p class="crumbs"><a href="/">All domains</a></p><h1>${esc(d.label)}</h1>${domainSection(d, d.built, false)}` }));
  }
  const count = results.filter((p) => p.manifest).length;
  writeFileSync(join(OUT, "index.html"), frame({ title: r.title, body: `<h1>${esc(r.title)}</h1>
<p class="lead">${esc(r.lead)}</p>
<p class="meta">${r.domains.length} domains · ${count} product${count === 1 ? "" : "s"}</p>
<div id="domains">${r.domains.map((d) => domainSection(d, d.built, true)).join("")}</div>` }));
  writeFileSync(join(OUT, "404.html"), frame({ title: "Not found · D-LAB-5 docs",
    body: `<h1>Not here</h1><p>That page does not exist. <a href="/">See all the docs sites.</a></p>` }));
  writeFileSync(join(OUT, "CNAME"), DOMAIN + "\n");
  writeFileSync(join(OUT, ".nojekyll"), "");
  writeFileSync(join(OUT, "sites.json"), JSON.stringify(results.map(({ slug, repo, base, state, manifest }) =>
    ({ slug, repo, base, state, commit: manifest?.commit || null })), null, 2) + "\n");
  return results;
}

function find(r, which) {
  const [id, slug] = String(which).split("/");
  const d = r.domains.find((x) => x.id === id);
  const p = d?.products?.find((x) => x.slug === slug);
  if (!p) throw new Error(`${which} is not in sites.json`);
  return [d, p];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const r = registry();
    if (process.argv.includes("--matrix")) {
      console.log(JSON.stringify(r.domains.flatMap((d) => (d.products || []).map((p) => ({ product: `${d.id}/${p.slug}`, part: partName(d.id, p.slug) })))));
      process.exit(0);
    }
    if (process.argv.includes("--only")) {
      const [d, p] = find(r, arg("--only"));
      const work = join(tmpdir(), `dlab5-docs-${process.pid}`);
      mkdirSync(work, { recursive: true });
      try {
        const res = buildProduct(d, p, OUT, work);
        console.log(`${res.state} ${d.id}/${p.slug} (${p.repo})${res.why ? `: ${res.why}` : ""}`);
        process.exit(res.state === "built" ? 0 : 1);
      } finally { rmSync(work, { recursive: true, force: true }); }
    }
    let parts = arg("--assemble", "");
    let failed = 0;
    if (!parts) {                                         // local: every product, then the site
      parts = join(tmpdir(), `dlab5-parts-${process.pid}`);
      const work = join(tmpdir(), `dlab5-docs-${process.pid}-w`);
      mkdirSync(work, { recursive: true });
      try {
        for (const d of r.domains) for (const p of d.products || []) {
          const res = buildProduct(d, p, join(parts, partName(d.id, p.slug)), work);
          if (res.state !== "built") { failed++; console.log(`${res.state} ${d.id}/${p.slug}: ${res.why}`); }
        }
      } finally { rmSync(work, { recursive: true, force: true }); }
    }
    const results = assemble(resolve(parts));
    if (!arg("--assemble", "")) rmSync(parts, { recursive: true, force: true });
    const bad = results.filter((p) => p.state !== "built").length;
    console.log(`wrote ${OUT}: ${results.length - bad} placed, ${bad} not`);
    process.exit(bad || failed ? 1 : 0);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
