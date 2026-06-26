# Open Pages — Promotional Video (v2)

A 60-second Remotion film for **Open Pages · Calvary Scribblings**.

- **Composition ID:** `OpenPagesVideo`
- **Spec:** 1920×1080 · 30fps · 1800 frames (60s)
- **Type:** silent-first; designed to take sound later
- **Fonts:** Cormorant Garamond (serif) + Cinzel (display) via `@remotion/google-fonts`

## Scenes

| # | Frames | Time | Beat |
|---|--------|------|------|
| S1 | 0–239 | 0:00–0:08 | The blank page — cursor + typewriter |
| S2 | 240–509 | 0:08–0:17 | The invitation — gold rule + wordmark |
| S3 | 510–809 | 0:17–0:27 | The community — catalogue cascade |
| S4 | 810–1049 | 0:27–0:35 | The gate — moderation passes, live |
| S5 | 1050–1289 | 0:35–0:43 | The reader — card expands to full read |
| S6 | 1290–1529 | 0:43–0:51 | The earn — Pocket thresholds → badge |
| S7 | 1530–1799 | 0:51–1:00 | The manifesto — cursor returns |

## Structure

- `src/brand.ts` — colors, fonts, fps, scene boundaries (single source of truth)
- `src/OpenPagesVideo.tsx` — composition; `<Sequence>` per scene
- `src/components/Cursor.tsx` — the blinking cursor, shared identically by S1 and S7
- `src/scenes/*` — one file per scene, each receiving a local frame

## Commands

```bash
npm install
npm run studio          # preview at http://localhost:3001 (use --port to set)
npm run render          # render to out/open-pages-video.mp4
```
