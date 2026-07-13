# Areté — "Marble & Ink" Design System (Phase A)

**Status:** in progress · branch `feat/marble-ink-foundation` · 2026-07-12
**Decision source:** design-direction pitch (artifact `fa81a00e-61db-4ac3-91f6-24ce2f71e452`);
user chose **Direction I · Marble & Ink** and "fresh worktree, Phase A first".

## Goal

Replace Areté's dark-glass look with a **light, austere, ink-on-warm-paper**
brand system (the Tsenta/Ekpa lineage), grounded in the meaning of *areté*
(excellence = function fulfilled). Light is the primary world; a warm-graphite
dark variant is supported. This spec covers the token foundation and the
primitive re-skin; the landing rebuild and per-page work are tracked in
`arete-product-build-roadmap` (memory).

## Design principles (from *areté*)

- **ergon** — every element earns its function; cut decoration that carries no information.
- **alḗtheia** — the UI tells the truth (no fabricated data/states); already Areté's product law.
- **sōphrosýnē** — mastery worn lightly: generous space, one accent, calm type.
- **akríbeia** — felt precision: strict type scale, consistent spacing rhythm, aligned hairlines.
- **kalón** — beauty earned from clarity; one signature moment (live review) kept quiet around.

## Tokens (implemented in `src/app/globals.css`)

Token **names are unchanged** from the old system so components keep resolving;
only values changed. Light default + dark override via `prefers-color-scheme`
and `:root[data-theme=…]`.

| Token | Light | Dark |
|---|---|---|
| `surface-0` (ground) | `#ECECE6` | `#161613` |
| `surface-1` (card) | `#F7F7F3` | `#1E1E1A` |
| `surface-2` (raised) | `#FFFFFF` | `#26261F` |
| `border-subtle/default/strong` | `#E2E2DA` / `#D4D4CA` / `#BEBEB2` | `#2A2A24` / `#35352D` / `#4A4A40` |
| `content-primary/secondary/muted` | `#1A1B18` / `#3C3E38` / `#6C6E66` | `#F2F1EA` / `#C9C8BE` / `#99988D` |
| `accent-primary` (cobalt, brand) | `#2F55D4` | `#7C97FF` |
| `accent-secondary` (bronze, signature) | `#8A6D3B` | `#C9A25A` |
| `accent-success/warning/danger` (semantic) | `#2F7D53` / `#9A6B15` / `#B23A34` | `#6FB98A` / `#D6A84A` / `#E08A85` |

**Type:** `--font-serif` (Newsreader → Palatino/Iowan/Georgia fallback) for
display/headings and the wordmark; `--font-sans` (Inter) for body/UI; `--font-mono`
(JetBrains Mono) for data, repo names, labels. Type scale to standardize on:
xs .8125 / sm .9375 / base 1.0625 / lg 1.1875 / xl 1.375 / 2xl 1.75 / 3xl 2.25 /
4xl 3 / 5xl 4 (rem).

**Surfaces:** `.glass*` class names kept for compatibility but now render opaque
paper cards (token-driven, no backdrop-filter, 12px radius, soft shadow),
adapting across both themes.

## Component principles

- One brand accent (cobalt); bronze only for the wordmark/rare emphasis;
  semantic colors are separate and never used as the accent.
- Buttons: solid cobalt primary; quiet bordered secondary; generous hit area (≥40px).
- Cards: paper surface + subtle border + soft shadow; lift only when interactive.
- State encoded in form (pill/stripe/sparkline), not color alone.

## Phase A task list

1. **Token foundation** — `globals.css` remap to Marble & Ink (light + dark). ✅ this commit.
2. **Font wiring** — load a real serif (Newsreader) via `next/font` in `layout.tsx`;
   expose `--font-newsreader`. Set default `data-theme`/color-scheme strategy.
3. **Primitive re-skin** — `components/ui/*` (Button, Card, Badge, Tooltip, Input,
   Tabs…) to the light system; migrate components with hard-coded dark
   assumptions (`text-white`, `bg-white/[0.0x]`, dark gradients).
4. **Landing rebuild** — apply the system; real Overview embedded live in the hero
   (coordinate with the other agent's interactive Overview); anti-hype copy.
5. **Verify** — `tsc --noEmit`, eslint, `next build`, `vitest run` green before merge.

## Verification note

This foundation commit is CSS + spec only; a full `next build` verification runs
with the primitive re-skin (step 3), once deps are installed in this worktree.
