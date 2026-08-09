# WORD QUEST RUN maintenance guide

This repository is the production source for WORD QUEST RUN.

## Production path

- Repository: `kenkaba/word-quest-run`
- Production branch: `ver2.0`
- Hosting: Netlify, published from the repository root
- Live URL: `https://gregarious-gumdrop-b3877e.netlify.app`
- The game is dependency-free static HTML/CSS/JavaScript.

## Before changing the game

1. Read `README.md` and the latest entries in `CHANGELOG.md`.
2. Preserve mobile portrait play, especially 390 px wide iPhones and safe-area insets.
3. Keep the main interaction understandable without instructions: see a word, choose one of three roads.
4. Do not add a build framework or runtime dependency unless the requested feature truly needs it.

## Required verification

Run:

```bash
npm test
```

For visual or interaction changes, also serve the repository locally and test the title, one full run, game over, retry, sound, and the three hint buttons.

```bash
npm run serve
```

The browser self-test is available at `/?selftest=1`.

## Release rules

- For every production change, update the `wqr-build` meta value in `index.html`.
- For any user-facing asset change, bump the cache name in `sw.js` so installed copies update.
- Add a concise entry to `CHANGELOG.md` for meaningful gameplay or visual changes.
- Push only after `npm test` passes.
- After push, verify the live URL returns the new `wqr-build` value.

