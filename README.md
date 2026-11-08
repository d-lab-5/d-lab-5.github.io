# docs.dlab5.net

The D-LAB-5 organisation's GitHub Pages site: one page that lists the
documentation sites of the D-LAB-5 projects. Plain HTML, no build; GitHub Pages
serves `main` as it is.

## How the domains work

- `docs.dlab5.net` is a CNAME to `d-lab-5.github.io`, and this repository
  claims it in `CNAME`.
- A public repository in the organisation that turns on Pages **without** a
  custom domain is served under a path here: `docs.dlab5.net/<repo>/`.
- A repository with its own custom domain is served only there, and this page
  links to it. The Mediathek does so: `docs.mediathek.digitalhome.cloud`, from
  `d-lab-5/mediathek-digitalhome-shared`.

**Adding a site:** add a card to `index.html`. This repository is public: no
account ids, internal hostnames, names or emails.

## Licence

Text CC BY 4.0, markup and styles MIT.
