# BambooHR Design System Reference

Extracted from `/Users/mmorrell/CascadeProjects/bhr-ui-template`. Source of truth for the reskin.

## Fonts

- **Headlines**: `Fields` (Regular 400, SemiBold 600, Bold 700) — OTF files in `public/fonts/`
- **Body/UI**: `Inter` variable font (100-900) — TTF in `public/fonts/`

## Color Tokens

### Official Neutral Scale

| Step | Hex | Semantic Alias |
|------|-----|---------------|
| 900 | `#38312F` | text-xx-strong, icon-xx-strong |
| 800 | `#48413F` | text-x-strong, text-strong, icon-x-strong |
| 700 | `#676260` | text-medium |
| 600 | `#777270` | text-weak, icon-strong |
| 500 | `#868180` | text-muted, icon-medium |
| 400 | `#C6C2BF` | border-medium |
| 300 | `#D4D2D0` | border-weak |
| 200 | `#E4E3E0` | border-x-weak |
| — | `#E9E8E6` | border-xx-weak (interpolated, not in official scale) |
| 100 | `#F5F4F1` | surface-x-weak |
| 50 | `#F6F6F4` | surface-xx-weak |
| 0 | `#FFFFFF` | surface-white |

### Light Mode (default)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary-strong` | `#2e7918` | Brand green, CTAs, active states |
| `--color-primary-medium` | `#3d9a21` | Hover states |
| `--color-primary-weak` | `#f0f9ed` | Selected backgrounds |
| `--color-link` | `#2563eb` | Links |
| `--surface-selected-weak` | `#f0f9ed` | Selected item backgrounds |

### Dark Mode (`.dark` on `<html>`)

| Token | Value |
|-------|-------|
| `--color-primary-strong` | `#46a318` |
| `--color-primary-medium` | `#5ab01c` |
| `--color-primary-weak` | `#1a3d1a` |
| `--text-neutral-xx-strong` | `#f5f3f1` |
| `--text-neutral-x-strong` | `#e5e2e0` |
| `--text-neutral-strong` | `#d5d0cd` |
| `--text-neutral-medium` | `#a8a3a0` |
| `--text-neutral-weak` | `#8a8582` |
| `--icon-neutral-xx-strong` | `#f5f3f1` |
| `--icon-neutral-x-strong` | `#e5e2e0` |
| `--icon-neutral-strong` | `#a8a3a0` |
| `--surface-neutral-white` | `#1a1a1a` |
| `--surface-neutral-xx-weak` | `#242422` |
| `--surface-neutral-x-weak` | `#2d2d2a` |
| `--border-neutral-xx-weak` | `#3a3935` |
| `--border-neutral-x-weak` | `#424039` |
| `--border-neutral-weak` | `#4a4744` |
| `--border-neutral-medium` | `#5a5754` |
| `--shadow-100` | `0 1px 3px rgba(0, 0, 0, 0.3)` |
| `--shadow-300` | `0 2px 6px rgba(0, 0, 0, 0.4)` |
| `--color-link` | `#60a5fa` |
| `--surface-selected-weak` | `#1a3d1a` |

## Spacing Scale

| Token | Value |
|-------|-------|
| `--space-xxs` | 4px |
| `--space-xs` | 8px |
| `--space-s` | 12px |
| `--space-m` | 16px |
| `--space-l` | 20px |
| `--space-xl` | 24px |
| `--space-xxl` | 32px |
| `--space-xxxl` | 40px |

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-xx-small` | 8px | Inputs, small elements |
| `--radius-x-small` | 12px | Medium elements |
| `--radius-small` | 16px | Nav items, sections |
| `--radius-medium` | 20px | Cards |
| `--radius-large` | 24px | Large cards |
| `--radius-full` | 1000px | Buttons, pills, badges |

## Shadows

| Token | Light | Dark |
|-------|-------|------|
| `--shadow-100` | `1px 1px 0px 1px rgba(56,49,47,0.04)` | `0 1px 3px rgba(0,0,0,0.3)` |
| `--shadow-300` | `1px 1px 0px 2px rgba(56,49,47,0.03)` | `0 2px 6px rgba(0,0,0,0.4)` |

## Typography Scale

### Headlines (Fields)
| Size | Font Size | Line Height |
|------|-----------|-------------|
| X-Large (H1) | 52px | 62px |
| Large | 40px | 48px |
| Medium | 32px | 40px |
| Small | 24px | 32px |
| X-Small | 20px | 28px |

### Body (Inter)
| Size | Font Size | Line Height | Weight |
|------|-----------|-------------|--------|
| Large Regular | 16px | 24px | 400 |
| Large Medium | 16px | 24px | 500 |
| Large Bold | 16px | 24px | 700 |
| Small Regular | 14px | 20px | 400 |
| Small Medium | 14px | 20px | 500 |
| X-Small Semibold | 13px | 19px | 600 |

## Button Variants

| Variant | Background | Border | Text |
|---------|-----------|--------|------|
| Standard | white surface | medium border | strong text |
| Primary | primary-strong | transparent | white |
| Ghost | transparent | transparent | strong text |
| Outlined | white surface | primary-strong | primary-strong |
| Text | transparent | transparent | link blue |

All buttons: `border-radius: 1000px`, sizes 32px (small) or 40px (medium).

## AI Gradient

- **Light**: `linear-gradient(122.835deg, rgb(233,243,252) 0%, rgb(245,238,248) 100%)`
- **Dark**: `linear-gradient(122.835deg, rgba(30,58,95,0.8) 0%, rgba(55,35,70,0.8) 100%)`
- **AI fill button border**: `linear-gradient(135deg, #AFD6A3 0%, #A6D0F3 34%, #D5BAE3 67%, #F6C499 96%)`

## Status Colors

| Status | Strong (solid) | Weak (muted bg) | Text (on muted) |
|--------|---------------|-----------------|-----------------|
| Brand | `#2e7918` | `#ebf5e8` | `#2e7918` |
| Success | `#016d00` | `#ebf5e8` | `#016d00` |
| Error | `#ae0718` | `#fdeaec` | `#ae0718` |
| Warning | `#a14300` | `#fff1e5` | `#a14300` |
| Information | `#00618b` | `#e9f3fc` | `#00618b` |
| Discovery | `#683180` | `#f9edff` | `#683180` |
| Neutral | `#777270` | `#f5f4f1` | `#48413f` |

### Pill Component (from Figma)
- Font: Inter Medium (500), 13px/19px
- Padding: 4px
- Border radius: 4px (NOT full pill)
- Solid variant: white text on strong surface
- Muted variant: strong text on weak surface

## Key Principles

1. **Green is the only brand color** — everything else is warm neutrals
2. **Subtle shadows** — barely visible in light mode, slightly more in dark
3. **Warm grays** — brownish undertone (`#38312f`) not cool blue-gray
4. **Very rounded buttons** — 1000px radius (full pill)
5. **Cards are 20px radius** with minimal shadow
6. **Inter for UI, Fields for headlines** — clear typographic hierarchy
