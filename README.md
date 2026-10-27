# Lumina Studio 2.0

Photo grading and video editing in the browser. Everything runs on the device's GPU; files never leave the device.

- **Photo**: Lightroom-mobile style editor (bottom tool bar on phones, right-hand panel on desktop).
- **Video**: Premiere/CapCut-style timeline with DaVinci-style colour tools.
- **Copy a look**: match the colour tones of any reference photo or video.

## Run it

```bash
npm install          # Node 20+
npm run dev          # http://localhost:5173  (add -- --host to open it from your phone on the same Wi-Fi)
npm run build        # production build in dist/
npm run preview      # serve the production build
```

`dist/` is static, so you can host it anywhere (Netlify, Vercel, GitHub Pages, S3, an nginx folder). The site needs HTTPS for WebCodecs export and for installing it as an app. On a phone, open the site and choose **Add to Home Screen**: it runs full-screen like a native app and works offline after the first visit.

## Features

### Photo studio
| Area | What you get |
|---|---|
| **Edit** | Auto (smart tone + white balance), Light (exposure, contrast, highlights, shadows, whites, blacks), point Curves (RGB + per channel), Colour (temp, tint, vibrance, saturation, white-balance picker), Mix (8-band HSL), 3-way + global Grading wheels, Effects (texture, clarity, dehaze, vignette, grain, film glow & halation), Detail (sharpening with masking, luminance and colour noise reduction), Optics (chromatic aberration, distortion), LUT |
| **Masking** | AI masks (Subject, Sky, Background, People, Vegetation, Water, Architecture, Ground), Brush (size/feather/flow/erase), Linear, Radial, Colour range, Luminance range. Masks can add, subtract or intersect, and each has 17 local sliders, including negative sharpness for a background blur. Adaptive presets: Enhance sky, Pop subject, Blur background, Brighten people |
| **Remove** | Heal or clone brush. It searches for a matching source automatically, blends seamlessly, and you can drag the source to change it |
| **Crop** | Aspect presets, free crop, straighten (auto-constrained), rotate, flip |
| **Match** | Copy the colour, contrast and split-toning of a reference photo or video. Save the result as a preset |
| **Presets** | 76 built-in looks (Food, Portrait, Cinematic, Hollywood, Cinematic Travel, Clean Aesthetic, Film, Film Stocks, Aesthetic, Moody, Travel, Night, B&W, Landscape) with live thumbnails and an amount slider. Save your own, or **import Lightroom presets** (.xmp, .lrtemplate, DNGs exported from Lightroom), **.cube LUTs**, or a **.zip** of any of these |
| **Workflow** | Before/after (split view, or hold the photo), undo/redo, copy/paste settings, sync to all photos, scopes (histogram, waveform, RGB parade, vectorscope), clipping warning, autosave |
| **Export** | Full resolution JPEG/PNG/WebP, resized versions, batch export, share sheet, export the grade as a `.cube` LUT for Premiere/Resolve |

### Video studio
| Area | What you get |
|---|---|
| **Timeline** | Centred playhead (mobile-editor style), pinch / Ctrl+wheel zoom, trim handles, split (S), duplicate, reorder, delete, filmstrip thumbnails and waveforms |
| **Clips** | Speed 0.25–4×, volume, audio fades, fill/fit framing, zoom and position, Ken Burns on photos |
| **Transitions** | Cross dissolve, dip to black/white, wipe, slide, zoom. Transitions really overlap the clips (the incoming clip starts early, as in Premiere) |
| **Colour** | Every photo grading tool works per clip, plus `.cube` LUT import, Shot Match (match one clip to another, or match every clip to one look), copy/paste grade, scopes |
| **Titles & music** | 5 title styles × 5 animations, draggable on the preview. Music track with fades |
| **Format** | 16:9, 9:16, 1:1, 4:5, 4:3, 21:9 · 24/25/30/60 fps |
| **Export** | Frame-accurate offline render: MP4 (H.264 + AAC/Opus) or WebM, 720p to 4K. It decodes every frame exactly and mixes audio sample-accurately, so the result doesn't depend on window size or the tab staying in focus |

## Architecture

```
src/engine/        GPU + colour science (framework-free)
  gl.ts            WebGL2 helpers (float16 render targets, target pool)
  shaders.ts       develop · blur · detail+masks · geometry/effects · viewer · compositor
  pipeline.ts      orchestrates passes; LUT/mask textures; bake grade → .cube
  color.ts         tone & curve LUTs, colour match (Oklab, tonal zones), auto tone, .cube I/O
  masks.ts         mask components, combine ops, guided-filter edge refinement
  ai.ts            Segformer (ADE20K) via transformers.js + offline fallbacks
  heal.ts          auto source search + push-pull seamless blending
  geometry.ts      crop/rotate maths shared by shader and UI
  scopes.ts        histogram, waveform, parade, vectorscope
src/studios/photo  library, editor, renderer, panels, overlays
src/studios/video  project list, editor, player (A/V sync), compositor, timeline, exporter
src/studios/shared edit panels, presets, LUT library, colour-match references
src/lib/db.ts      IndexedDB persistence (originals, edits, projects, LUTs, AI results)
```

The preview and the export run the same shaders. Spatial effects (clarity, texture, grain) are sized relative to the image, so a full-resolution export looks like the preview. Highlights and Shadows use a blurred base layer (local tone mapping, as Lightroom does), so detail survives strong settings.

## AI selection

Subject, Sky, People and the other AI masks use a SegFormer semantic-segmentation model (a few MB). The model is downloaded from the Hugging Face hub the first time you use AI masking, then cached by the browser. It runs locally on WebGPU when available, otherwise on WebAssembly. Without internet, Subject, Background and Sky fall back to fast on-device estimates, and you can refine any mask with the brush. The model weights' licence (NVIDIA SegFormer) allows research and non-commercial use; swap `MODEL` in `src/engine/ai.ts` if you need a commercial-licensed model.

## Browser support

- **Editing**: any browser with WebGL2 (Chrome, Edge, Safari 15+, Firefox, Android Chrome, iOS Safari).
- **Video export**: needs WebCodecs (Chrome/Edge 94+, Safari 17+, Firefox 130+).
- **Audio codec**: AAC when the browser can encode it, otherwise Opus. Some Linux Chrome builds lack AAC; QuickTime/iOS Photos may not play Opus-in-MP4, so pick WebM or use another browser there.
- **Very large photos** are capped at the GPU's maximum texture size (often 8192 or 16384 px). Export retries at smaller sizes if the device runs out of memory.

## Tests

- `test/engine.html`, `test/looks.html`, `test/masks.html`: engine harness pages (open them via `npm run dev`).
- `test/e2e/*.cjs`: Playwright flows (photo on a phone viewport, photo on desktop, video including MP4 export). Put sample files in `test/media/` (`chelsea.png`, `coffee.png`, `overcast.png`, `astronaut.png`, `rocket.jpg`, `clip1.webm`, `clip2.webm`, `music.mp3`), start `npm run dev`, then run `node test/e2e/e2e_photo.cjs`.
