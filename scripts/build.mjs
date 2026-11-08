#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (C) 2026 D-LAB-5
/**
 * Builds docs.dlab5.net from sites.json: every product's docs repository
 * (made from template-dlab5-shared), each under /<domain>/<slug>/, with an
 * index of the domains and one page per domain.
 *
 *   node scripts/build.mjs [--out _site] [--cache cache] [--sources <dir>]
 *
 * For each product: a shallow clone of its main branch, `npm ci`, and its own
 * scripts/site.mjs with --base /<domain>/<slug>/, so its pages are exactly the
 * ones it builds for itself. A product that fails keeps its last good copy
 * from --cache (CI restores it), and the index marks it; one that has never
 * built is left out and named. The stylesheet comes from the template.
 *
 * --sources <dir> uses <dir>/<repo name> instead of cloning, when it is there:
 * a local checkout, for a build before anything is pushed.
 *
 * Exit status 1 when any product failed, after writing everything else.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const OUT = resolve(ROOT, arg("--out", "_site"));
const CACHE = resolve(ROOT, arg("--cache", "cache"));
const SOURCES = arg("--sources", "") && resolve(arg("--sources"));
const DOMAIN = "docs.dlab5.net";
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

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

function buildProduct(domain, p, work) {
  const base = `/${domain.id}/${p.slug}/`;
  const to = join(OUT, domain.id, p.slug);
  try {
    const dir = checkout(p.repo, work);
    if (!existsSync(join(dir, "scripts", "site.mjs"))) throw new Error("no scripts/site.mjs: is it made from template-dlab5-shared?");
    if (!existsSync(join(dir, "node_modules"))) run("npm", ["ci", "--silent", "--no-audit", "--no-fund"], dir);
    rmSync(to, { recursive: true, force: true });
    run("node", ["scripts/site.mjs", "--base", base, "--out", to], dir);
    rmSync(join(to, "CNAME"), { force: true });            // the product's own domain is not this site's
    const m = JSON.parse(readFileSync(join(to, "site.json"), "utf8"));
    if (m.slug !== p.slug || m.domain !== domain.id) {
      throw new Error(`its shared.json says ${m.domain}/${m.slug}, the registry ${domain.id}/${p.slug}`);
    }
    mkdirSync(join(CACHE, domain.id), { recursive: true });
    rmSync(join(CACHE, domain.id, p.slug), { recursive: true, force: true });
    cpSync(to, join(CACHE, domain.id, p.slug), { recursive: true });
    return { ...p, base, manifest: m, state: "built" };
  } catch (e) {
    const why = String(e.stderr || e.message || e).trim().split("\n").slice(-3).join(" ").slice(0, 400);
    const kept = join(CACHE, domain.id, p.slug);
    if (existsSync(join(kept, "site.json"))) {
      rmSync(to, { recursive: true, force: true });
      cpSync(kept, to, { recursive: true });
      return { ...p, base, manifest: JSON.parse(readFileSync(join(to, "site.json"), "utf8")), state: "stale", why };
    }
    return { ...p, base, manifest: null, state: "failed", why };
  }
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
  const c = m.counts || {};
  const size = [c.diagrams && `${c.diagrams} diagrams`, c.adrs && `${c.adrs} decisions`, c.classes && `${c.classes} classes`].filter(Boolean).join(" · ");
  return `<article class="card"><a class="card__main" href="${esc(p.base)}"><span class="kind">${esc(p.slug)}</span><h3>${esc(m.product)}</h3>${
    m.description ? `<p>${esc(m.description)}</p>` : ""}<p class="size">${esc(size)}${p.state === "stale" ? " · last night's build failed; this is the copy before" : ""}</p></a>${
    m.own_domain ? `<a class="card__adr" href="https://${esc(m.own_domain)}/">${esc(m.own_domain)}</a>` : ""}</article>`;
}

function domainSection(d, products, link) {
  const shown = products.filter((p) => p.manifest);
  const head = link ? `<h2><a href="/${esc(d.id)}/">${esc(d.label)}</a></h2>` : "";
  return `<section class="group" id="${esc(d.id)}">${head}<p class="lead">${esc(d.about || "")}</p>${
    shown.length ? `<div class="grid">${shown.map(card).join("")}</div>`
      : `<p class="empty">No product docs yet. Make them with <a href="https://github.com/d-lab-5/template-dlab5-shared">template-dlab5-shared</a> and add a line to <code>sites.json</code>.</p>`}</section>`;
}

export function build() {
  const r = registry();
  const work = join(tmpdir(), `dlab5-docs-${process.pid}`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  mkdirSync(work, { recursive: true });
  const results = [];
  try {
    const tpl = checkout(r.template, work);
    const css = [join(tpl, "template", "site", "site.css"), join(tpl, "site", "site.css")].find((f) => existsSync(f));
    if (!css) throw new Error(`${r.template} has no site/site.css`);
    mkdirSync(join(OUT, "assets"), { recursive: true });
    cpSync(css, join(OUT, "assets", "site.css"));
    for (const d of r.domains) {
      const products = (d.products || []).map((p) => {
        const res = buildProduct(d, p, work);
        console.log(`${res.state === "built" ? "built " : res.state === "stale" ? "KEPT  " : "FAILED"} ${d.id}/${p.slug} (${p.repo})${res.why ? `: ${res.why}` : ""}`);
        return res;
      });
      results.push(...products);
      mkdirSync(join(OUT, d.id), { recursive: true });
      writeFileSync(join(OUT, d.id, "index.html"), frame({ title: `${d.label} · D-LAB-5 docs`,
        body: `<p class="crumbs"><a href="/">All domains</a></p><h1>${esc(d.label)}</h1>${domainSection(d, products, false)}` }));
      d.built = products;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const results = build();
    const bad = results.filter((p) => p.state !== "built");
    console.log(`wrote ${OUT}: ${results.length - bad.length} built, ${bad.length} not`);
    process.exit(bad.length ? 1 : 0);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
