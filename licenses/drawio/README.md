# drawio license (for redistribution)

`LICENSE` is the Apache License 2.0 text as shipped by
[jgraph/drawio](https://github.com/jgraph/drawio) at the pinned tag this
plugin bundles (see `DRAWIO_VERSION` in `src/constants.ts`).

It exists in this repo because the release workflow's **offline install
bundle** (`drawio-editor-<ver>-offline.zip`) redistributes the extracted
drawio webapp, and Apache 2.0 requires the license text to accompany a
redistribution. The workflow copies this file into the bundle's `webapp/`
directory. The in-app one-click installer is *not* a redistribution (users
download directly from jgraph's own release), so it is unaffected.

If a drawio version bump ever changes the upstream license, refresh this
copy from `https://raw.githubusercontent.com/jgraph/drawio/<tag>/LICENSE`
and re-check that redistribution is still permitted.
