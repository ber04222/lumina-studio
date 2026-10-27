# Lumina Studio — project notes for Claude Code

A browser photo + video editor (Lightroom-mobile style UI, Premiere/DaVinci-style video), installed on the owner's Android phone as a PWA.
Live site: https://ber04222.github.io/lumina-studio/ (GitHub Pages, served from the `gh-pages` branch).
Everything runs on-device (WebGL2 + IndexedDB); no backend, no accounts.

## Commands
- `npm install --ignore-scripts` — `@huggingface/transformers` pulls `onnxruntime-node`, whose postinstall downloads big binaries; it is only used for types, the runtime loads transformers.js from the jsDelivr CDN.
- `npm run dev` (http://localhost:5173, add `-- --host` to test from a phone on the same Wi-Fi) · `npm run build` (tsc + vite → `dist/`) · `npm run preview` (port 4173) · `npx eslint src --quiet`
- Before committing: `npx tsc -b && npx eslint src --quiet && npm run build` must all pass.

## Deploy
- Pushing to `main` runs `.github/workflows/deploy.yml`, which builds and publishes `dist/` to `gh-pages`.
- Manual fallback: build, then copy `dist/` (plus an empty `.nojekyll`) onto a checkout of the `gh-pages` branch and push.
- `public/sw.js` caches assets (`CACHE` constant). Navigations are network-first, so the phone gets new builds on next open. Bump `CACHE` only when changing caching behaviour.
- Commits must use the GitHub noreply email (`121864364+ber04222@users.noreply.github.com`, name `ber04222`) — the repo is public; never commit a work email.

## Architecture (see README for the feature list)
- `src/engine/` — framework-free GPU + colour science
  - `pipeline.ts`: develop → finish (detail + up to 8 local masks) → glow/halation → present (geometry, vignette, grain). The preview and export run the same passes. Spatial effects are sized relative to the image.
  - `shaders.ts`: GLSL. Textures use the "v=0 = image top row" convention; float16 targets.
  - `color.ts`: tone/curve LUTs (1D LUT texture R32F 1024×7: tone, r, g, b, master, matchL, localTone), auto tone, `.cube` I/O, and **colour match**.
    - Colour match: `computeStats` keeps 3000 Oklab samples (`pts`). `buildMatchLut` runs an iterative distribution transfer (Pitié) in Oklab and bakes it into a 33³ 3D LUT, smoothed in colour space so noise isn't amplified. Stats without `pts` (old saves) fall back to the zone mean/std transfer.
  - `masks.ts`, `ai.ts` (SegFormer-b0 ADE20K via transformers.js from CDN; webgpu → wasm, with offline estimates), `heal.ts`, `scopes.ts`, `geometry.ts`.
- `src/studios/photo/` — library, editor, renderer, panels. `src/studios/video/` — projects, timeline, player (wall-clock playback), compositor, exporter (mediabunny, WebCodecs). `src/studios/shared/` — edit panels, presets (`presets.ts`, 76 built-ins), LUT library, Lightroom/LUT importers, colour-match references.
- `src/lib/db.ts` — IndexedDB stores: blobs, photos, projects, presets, luts, aimaps, meta.
  - Save originals with `storeBlob()`, which copies, writes and reads back. Never call `db.put('blobs', …)` directly.
  - `src/lib/backup.ts` handles zip backup/restore.
- `src/types/edits.ts` — `EditSettings`. When adding a field, also add it to `defaultEdits()` **and** `normalizeEdits()` so older saved photos and projects still load.

## Testing
- Harness pages (with `npm run dev`): `test/presets.html` (renders preset groups), `test/match.html` (reference · source · old vs new match), `test/engine.html`, `test/looks.html`, `test/masks.html`.
- Playwright flows: `test/e2e/*.cjs`. Headless Chromium needs `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, and Google Fonts must be route-aborted, or screenshots hang.
- Software GL is slow: playback follows the real clock, so don't take a screenshot between Play and Pause.
- Always look at rendered output for visual changes (presets, match, effects); type-checks don't catch looks that are too weak or too strong.

## Owner preferences
- Prefers a Lightroom-mobile-like UI; wants premium, clean, cinematic looks (travel creators, Hollywood grades).
- Free LUT/preset packs are usually personal-use only: don't bundle third-party packs in this public repo. Users import them via Presets → Import.
- Keep usage lean; stop at clean checkpoints.

## Ideas queued
- Lightness-vs-saturation control.
- Skin-tone line on the vectorscope.
- Multi-track video.
- Optional higher-quality AI masks (SegFormer-b2, 29–56 MB).
- One-tap Google Drive backup.
