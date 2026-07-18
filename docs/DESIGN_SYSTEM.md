# HEYRAH — Design System (v1 foundation)

**Status:** token foundation — exact production values are locked during implementation against `public/brand/heyrah-logo-reference.jpg` (per AGENTS.md, the logo is the visual anchor).
**Applies to:** storefront + admin UI, including the demo payment page.
**Stack context:** React + Vite design tokens as CSS variables (`--color-*`, `--space-*`, `--type-*`) — no raw hex scattered in components.

---

## 1. Palette — roles (hex values provisional until logo sampling)

| Role | Token | Direction |
|---|---|---|
| Brand surface (premium sections, headers, demo payment page frame) | `--color-teal-900` | deep teal blue, dark enough for white/gold text at AA |
| Primary interactive (buttons, links, active states) | `--color-teal-600` | mid teal, readable on light backgrounds |
| Accent (logo treatment, premium highlights, selected details, key CTA moments) | `--color-gold-500` | warm metallic gold — **accent only, never a page** |
| Backgrounds (shopping areas) | `--color-neutral-50/100` | light, clean |
| Text | `--color-ink-900/600` | dark, readable |
| Borders/surfaces | `--color-neutral-200` | soft neutrals |
| Semantic | `--color-success / --color-danger / --color-warning / --color-info` | used sparingly, with text labels (never color alone) |

**Laws:** no all-gold pages, no all-teal pages; gold is ≤ accent; gradients/shadows minimal (ARCHITECTURE-grade restraint).

## 2. Typography

- Two voices: one **display/title** face, one **workhorse body** face (selection + licensing during implementation; premium, not noisy).
- Scale (px): 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48 — defined as `--type-*` tokens; line-heights paired (1.2 display, 1.5–1.6 body).
- Prices use tabular figures so cart totals align.

## 3. Spacing & shape

- 4/8px system: `--space-1..8` = 4, 8, 12, 16, 24, 32, 48, 64. Section rhythm from `--space-6..8`; card padding `--space-4/5`.
- Radius: `--radius-sm 4` inputs, `--radius-md 8` cards/buttons, `--radius-lg 12` modals, pill for badges.
- Elevation: two shadow levels max (card, overlay); borders preferred over shadows for structure.

## 4. Motion

- 150–300ms, ease-out; transforms/opacity only; nothing bouncy, looping, or decorative.
- Every animation honors `prefers-reduced-motion` — reduced-motion users get state changes without movement (demo payment processing sequence included).

## 5. Core components (storefront)

- **Buttons:** primary (teal-600, white text), secondary (outline), text button; gold reserved for the premium CTA moments (e.g. demo payment "Pay ₹X (Demo)").
- **Product card:** image-first, name, INR price (+strikethrough when discounted), availability state; hover lift ≤ subtle.
- **Badges:** in stock / low stock (admin only) / out of stock — always textual + color.
- **Forms:** labeled inputs, inline validation messages, 44px+ touch targets, visible gold/teal focus ring (contrast-checked per surface).
- **Empty/error/loading states:** defined per REQUIREMENTS §13 — skeletons for grids, spinner-in-button for actions, honest empty states with next actions.
- **Demo payment page:** full teal-900 premium frame, order summary card, mock method selector (Demo Card / Demo UPI / Demo QR), persistent "DEMO / TEST MODE" indicator, restrained three-step processing sequence — this page is the design system's showcase moment. *As built:* blush "DEMO / TEST MODE" band under the header; ivory summary card; the payment sheet is a white dialog with a teal-900 header band (wordmark, gold test badge, serif amount) over a teal-tinted backdrop, docking to the bottom edge under 520px; progress is a teal ring that closes into a green check; motion 180–420ms, transform/opacity only, none under reduced motion.

## 6. Admin UI

- Clean, dense, professional; brand applied subtly (teal sidebar/accents, light content area); tables over cards for lists; no decorative motion; keyboard-first operation.
- *As built (Phase 10, `web/src/admin/admin.css`, `adm-` prefix):* teal-900 sidebar with the gold wordmark and a gold left rule on the active item; white panels on a cool neutral (#f5f6f4). Gold appears only in the wordmark, the active nav marker, the "Paid"/"Primary" badges, and the one money action (Confirm payment received). The serif display face is used only for page titles and dashboard figures. Badges always carry text. Tables collapse to labelled stacked rows under 720px (no sideways scrolling); touch targets 44px (36px for in-row secondary buttons); destructive actions use a native `<dialog>` with focus on the safe choice.

## 7. Accessibility baseline

WCAG 2.1 AA intent: contrast checked especially for gold-on-teal and gold-on-white pairings; visible focus everywhere; dialogs manage focus + Escape; state never by color alone; all controls have accessible names.
