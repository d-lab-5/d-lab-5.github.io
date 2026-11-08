# docs.dlab5.net

The documentation of every D-LAB-5 product, in one site: decisions, diagrams,
roadmaps and ontology references, grouped by development domain.

| Domain | Path |
|---|---|
| D-LAB-5, the core | `/d-lab-5/` |
| DigitalHome.Cloud | `/digitalhome/` |
| ERP-LAB-5 | `/erp-lab-5/` |
| Atelier-5 | `/atelier-5/` |
| artdecoris labs | `/artdecoris/` |

Nothing here is written by hand except `sites.json`. Each product keeps its
docs in a public repository made from
[template-dlab5-shared](https://github.com/d-lab-5/template-dlab5-shared), and
`scripts/build.mjs` builds them all:

1. Shallow-clone the product's `main`.
2. Run `npm ci`, then its own `scripts/site.mjs --base /<domain>/<slug>/`.
3. Write the index of the domains, and one page per domain from each
   product's `site.json`.

The stylesheet is the template's, so every page looks alike.

## Adding a product

Make its docs repository from the template (see its README), push `main`, and
add it under its domain in `sites.json`:

```json
{ "slug": "example", "repo": "<owner>/example-shared" }
```

The slug and domain must match the product's own `shared.json`; the build
refuses a mismatch. Then run the workflow, or wait for the night.

## How it runs

`.github/workflows/build.yml` runs nightly at 03:17 UTC, on a push to `main`,
and on *Run workflow*.
- **A product that fails keeps last night's copy,** taken from the Actions
  cache. Its card says so, and the run is marked failed.
- **A product that has never built** is named in the log and left out.
- **The links:** `scripts/links.mjs` checks that every internal link
  resolves before anything is published.

The products are public, so no token is needed. A product's push does not
trigger a rebuild; that would need a token with access to this repository.

```bash
node scripts/build.mjs --sources ~/D-LAB-5   # use local checkouts where they exist
node scripts/links.mjs
python3 -m http.server 8793 --bind 127.0.0.1 --directory _site
```

The domain is a CNAME `docs.dlab5.net` → `d-lab-5.github.io`. A product with a
domain of its own, such as docs.mediathek.digitalhome.cloud, is built here too
and names that domain as canonical.

## Licence

Scripts MIT; the index text CC BY 4.0. Each product's pages carry their own
repository's licences.
