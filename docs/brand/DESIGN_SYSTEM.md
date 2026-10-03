# FanZuP Design System
**Version 2.0 | Last Updated: June 2026**

A comprehensive design token system for the FanZuP platform — the regulated fan-investment platform connecting independent music artists with fan investors.

> **v2.0 rebuild:** Tokens are now built on the approved **black + gold** brand identity (Space Grotesk / Inter / JetBrains Mono). The v1.0 purple/blue/pink + Inter system is **retired**. See `BRAND_GUIDELINES.md` for the full identity, voice, and logo rules — this file is its companion token reference. **FanZuP is dark-first**; light mode is optional and secondary.

---

## Color System

### Primary Colors — Brand Gold
Gold is the single hero color: logo, primary CTAs, focus, and key highlights. Keep it to ~10% of any screen so it stays special. Built dark-first on a near-black canvas.

```
--color-gold-deep:      #B8932F  /* Pressed states, gradient low end, borders */
--color-gold:           #D4AF37  /* PRIMARY brand color — CTAs, logo, focus, highlights */
--color-gold-champagne: #F0D98A  /* Hover sheen, gradient high end, subtle highlights */

/* Signature gradient */
--color-gold-gradient:  linear-gradient(135deg, #B8932F 0%, #D4AF37 50%, #F0D98A 100%);
```

**Aliases (mapped for components that expect a primary scale):**
```
--color-primary-500: #D4AF37;  /* gold */
--color-primary-600: #B8932F;  /* gold-deep (pressed) */
--color-primary-300: #F0D98A;  /* champagne (hover) */
```

> Accessibility: Gold `#D4AF37` on Black `#0B0B0D` = **9.3:1** (AAA). Text/icons on a gold fill **must be black** (`#0B0B0D`) — off-white on gold is ~2.0:1 and fails WCAG.

---

### Surface & Neutral Colors (Foundation)
The dark canvas and its layered surfaces.

```
--bg-black:           #0B0B0D  /* App / page canvas (primary background) */
--surface-charcoal:   #17181C  /* Cards, panels, nav, raised surfaces */
--surface-charcoal-2: #212329  /* Hover / elevated surface, input fields */
--border-subtle:      #2A2C33  /* Hairlines, dividers, card borders */
--text-muted:         #8E929B  /* Secondary text, captions, labels (6.3:1 on black) */
--text-primary:       #F5F5F7  /* Primary text, headings (18.4:1 on black) */
```

---

### Accent & Data-Visualization Colors
For charts, categories, and secondary highlights — **never** as the primary brand color.

```
--color-accent-cyan: #00D4FF  /* Data series, "Streaming", links on dark */
--color-accent-teal: #00888B  /* Data series, secondary category */
--color-accent-mint: #16C784  /* Positive trend, gains */
--color-accent-navy: #102A43  /* Deep panel tint, chart backdrop */
```

---

### Semantic Colors
Standardized colors for UI feedback and states, aligned to the brand board. Each is a single accent tuned for the dark canvas; derive tints/shades as needed.

```
--color-success: #00C853  /* Funded, approved, verified, positive payout */
--color-warning: #FFB300  /* Pending review, caution, draft */
--color-error:   #E33035  /* Rejected, failed, validation error */
--color-info:    #00D4FF  /* Neutral notifications, helper context (= accent-cyan) */
```

> Brand vs. status: **gold = brand/CTA**, **green = positive financial state**. Never use gold to signal "success," and never use green as a brand/CTA color. They are intentionally distinct.

**Status badge usage:** green = Funded/Verified · amber = Pending · red = Rejected · cyan = New · gray (`--text-muted`) = Inactive.

---

### Neutral Colors (Grayscale)
Foundation colors for text, backgrounds, and UI elements.

#### Light Mode
```
--color-neutral-0:   #FFFFFF  /* Pure white */
--color-neutral-50:  #FAFAFA  /* Off-white backgrounds */
--color-neutral-100: #F5F5F5  /* Light backgrounds */
--color-neutral-200: #E5E5E5  /* Borders, dividers */
--color-neutral-300: #D4D4D4  /* Disabled states */
--color-neutral-400: #A3A3A3  /* Placeholder text */
--color-neutral-500: #737373  /* Secondary text */
--color-neutral-600: #525252  /* Body text */
--color-neutral-700: #404040  /* Headings */
--color-neutral-800: #262626  /* Dark headings */
--color-neutral-900: #171717  /* Darkest text */
--color-neutral-950: #0A0A0A  /* Near black */
```

#### Dark Mode
```
--color-neutral-0:   #0A0A0A  /* Pure black backgrounds */
--color-neutral-50:  #171717  /* Off-black backgrounds */
--color-neutral-100: #262626  /* Dark backgrounds */
--color-neutral-200: #404040  /* Borders, dividers */
--color-neutral-300: #525252  /* Disabled states */
--color-neutral-400: #737373  /* Placeholder text */
--color-neutral-500: #A3A3A3  /* Secondary text */
--color-neutral-600: #D4D4D4  /* Body text */
--color-neutral-700: #E5E5E5  /* Headings */
--color-neutral-800: #F5F5F5  /* Light headings */
--color-neutral-900: #FAFAFA  /* Lightest text */
--color-neutral-950: #FFFFFF  /* Pure white */
```

---

## Typography Scale

### Font Families
```
--font-family-display: 'Space Grotesk', 'SF Pro Display', -apple-system, system-ui, sans-serif;  /* Headings, hero, stats, wordmark */
--font-family-body:    'Inter', 'SF Pro Text', -apple-system, system-ui, sans-serif;             /* Body, UI, labels */
--font-family-mono:    'JetBrains Mono', 'SF Mono', ui-monospace, monospace;                      /* Money, metrics, unit counts, IDs (tabular figures) */
```

> Display = **Space Grotesk Bold/Medium**. Body = **Inter**. All currency, percentages, unit counts, and transaction IDs use **JetBrains Mono** with `font-variant-numeric: tabular-nums`.

### Font Sizes
Geometric scale based on 1.25 ratio (major third).

```
--font-size-xs:   0.75rem;   /* 12px */
--font-size-sm:   0.875rem;  /* 14px */
--font-size-base: 1rem;      /* 16px - body text */
--font-size-lg:   1.125rem;  /* 18px */
--font-size-xl:   1.25rem;   /* 20px */
--font-size-2xl:  1.5rem;    /* 24px */
--font-size-3xl:  1.875rem;  /* 30px */
--font-size-4xl:  2.25rem;   /* 36px */
--font-size-5xl:  3rem;      /* 48px */
--font-size-6xl:  3.75rem;   /* 60px */
--font-size-7xl:  4.5rem;    /* 72px */
```

### Font Weights
```
--font-weight-light:    300;
--font-weight-normal:   400;
--font-weight-medium:   500;
--font-weight-semibold: 600;
--font-weight-bold:     700;
--font-weight-black:    900;
```

### Line Heights
```
--line-height-none:   1;
--line-height-tight:  1.25;
--line-height-snug:   1.375;
--line-height-normal: 1.5;
--line-height-relaxed: 1.625;
--line-height-loose:  2;
```

### Letter Spacing
```
--letter-spacing-tighter: -0.05em;
--letter-spacing-tight:   -0.025em;
--letter-spacing-normal:  0;
--letter-spacing-wide:    0.025em;
--letter-spacing-wider:   0.05em;
--letter-spacing-widest:  0.1em;
```

---

## Spacing Scale

### Base Spacing Unit
Base unit: **4px** (0.25rem)

### Spacing Tokens
Geometric scale for consistent spacing throughout the application.

```
--space-0:   0;           /* 0px */
--space-px:  1px;         /* 1px - hairline */
--space-0.5: 0.125rem;    /* 2px */
--space-1:   0.25rem;     /* 4px */
--space-1.5: 0.375rem;    /* 6px */
--space-2:   0.5rem;      /* 8px */
--space-2.5: 0.625rem;    /* 10px */
--space-3:   0.75rem;     /* 12px */
--space-3.5: 0.875rem;    /* 14px */
--space-4:   1rem;        /* 16px */
--space-5:   1.25rem;     /* 20px */
--space-6:   1.5rem;      /* 24px */
--space-7:   1.75rem;     /* 28px */
--space-8:   2rem;        /* 32px */
--space-9:   2.25rem;     /* 36px */
--space-10:  2.5rem;      /* 40px */
--space-11:  2.75rem;     /* 44px */
--space-12:  3rem;        /* 48px */
--space-14:  3.5rem;      /* 56px */
--space-16:  4rem;        /* 64px */
--space-20:  5rem;        /* 80px */
--space-24:  6rem;        /* 96px */
--space-28:  7rem;        /* 112px */
--space-32:  8rem;        /* 128px */
--space-36:  9rem;        /* 144px */
--space-40:  10rem;       /* 160px */
--space-44:  11rem;       /* 176px */
--space-48:  12rem;       /* 192px */
--space-52:  13rem;       /* 208px */
--space-56:  14rem;       /* 224px */
--space-60:  15rem;       /* 240px */
--space-64:  16rem;       /* 256px */
--space-72:  18rem;       /* 288px */
--space-80:  20rem;       /* 320px */
--space-96:  24rem;       /* 384px */
```

### Semantic Spacing
Common spacing patterns with semantic names.

```
--space-component-padding-sm:  var(--space-3);   /* 12px */
--space-component-padding-md:  var(--space-4);   /* 16px */
--space-component-padding-lg:  var(--space-6);   /* 24px */
--space-component-padding-xl:  var(--space-8);   /* 32px */

--space-section-gap-sm:  var(--space-8);   /* 32px */
--space-section-gap-md:  var(--space-12);  /* 48px */
--space-section-gap-lg:  var(--space-16);  /* 64px */
--space-section-gap-xl:  var(--space-24);  /* 96px */

--space-stack-sm:  var(--space-2);   /* 8px */
--space-stack-md:  var(--space-4);   /* 16px */
--space-stack-lg:  var(--space-6);   /* 24px */
--space-stack-xl:  var(--space-8);   /* 32px */

--space-inline-sm:  var(--space-2);   /* 8px */
--space-inline-md:  var(--space-3);   /* 12px */
--space-inline-lg:  var(--space-4);   /* 16px */
--space-inline-xl:  var(--space-6);   /* 24px */
```

---

## Border Radius

### Radius Scale
```
--radius-none: 0;
--radius-sm:   0.125rem;  /* 2px */
--radius-base: 0.25rem;   /* 4px */
--radius-md:   0.375rem;  /* 6px */
--radius-lg:   0.5rem;    /* 8px */
--radius-xl:   0.75rem;   /* 12px */
--radius-2xl:  1rem;      /* 16px */
--radius-3xl:  1.5rem;    /* 24px */
--radius-full: 9999px;    /* Pill shape */
```

---

## Shadows

### Shadow Scale
**Light Mode:**
```
--shadow-sm:  0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-base: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
--shadow-md:  0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
--shadow-lg:  0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
--shadow-xl:  0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
--shadow-2xl: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
--shadow-inner: inset 0 2px 4px 0 rgba(0, 0, 0, 0.06);
```

**Dark Mode:**
```
--shadow-sm:  0 1px 2px 0 rgba(0, 0, 0, 0.3);
--shadow-base: 0 1px 3px 0 rgba(0, 0, 0, 0.4), 0 1px 2px 0 rgba(0, 0, 0, 0.3);
--shadow-md:  0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.3);
--shadow-lg:  0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.3);
--shadow-xl:  0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4);
--shadow-2xl: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
--shadow-inner: inset 0 2px 4px 0 rgba(0, 0, 0, 0.4);
```

---

## Z-Index Scale

```
--z-index-0:       0;
--z-index-10:      10;
--z-index-20:      20;
--z-index-30:      30;
--z-index-40:      40;
--z-index-50:      50;
--z-index-dropdown: 1000;
--z-index-sticky:   1020;
--z-index-fixed:    1030;
--z-index-modal-backdrop: 1040;
--z-index-modal:    1050;
--z-index-popover:  1060;
--z-index-tooltip:  1070;
```

---

## Opacity Scale

```
--opacity-0:   0;
--opacity-5:   0.05;
--opacity-10:  0.1;
--opacity-20:  0.2;
--opacity-25:  0.25;
--opacity-30:  0.3;
--opacity-40:  0.4;
--opacity-50:  0.5;
--opacity-60:  0.6;
--opacity-70:  0.7;
--opacity-75:  0.75;
--opacity-80:  0.8;
--opacity-90:  0.9;
--opacity-95:  0.95;
--opacity-100: 1;
```

---

## Usage Guidelines

### Color Usage

#### Primary (Gold `#D4AF37`)
- Primary CTAs and buttons (gold fill, **black** text)
- Active states, focus rings
- Key brand moments, logo, highlights
- Links on dark surfaces

#### Accents (Cyan / Teal / Mint / Navy)
- Data-visualization series (revenue charts, waterfall, donut)
- Category coding and secondary highlights
- Mint for positive trends/gains
- Never used as the primary brand color

#### Surfaces (Black / Charcoal)
- Black `#0B0B0D` = app canvas; Charcoal `#17181C` = cards/nav
- Layer elevation with `#212329` + `--border-subtle` hairlines, not heavy outlines

#### Semantic Colors
- **Success**: Confirmations, approvals, completed states
- **Error**: Validation errors, rejections, warnings
- **Warning**: Cautionary messages, pending reviews
- **Info**: Helper text, neutral notifications

#### Neutral
- **900-700**: Primary text, headings
- **600-500**: Secondary text, labels
- **400-300**: Disabled states, placeholders
- **200-100**: Borders, dividers
- **50-0**: Backgrounds, surfaces

### Typography Usage

#### Display (Headings)
- **7xl-6xl**: Hero headlines, landing pages
- **5xl-4xl**: Page titles, major sections
- **3xl-2xl**: Section headings, card titles
- **xl-lg**: Subsections, list headers

#### Body
- **base**: Primary body text (16px)
- **sm**: Secondary text, captions
- **xs**: Labels, fine print

#### Mono
- Transaction IDs, code snippets, campaign URLs

### Spacing Usage

#### Component Padding
- **sm (12px)**: Compact buttons, small cards
- **md (16px)**: Standard buttons, inputs
- **lg (24px)**: Large cards, modals
- **xl (32px)**: Page sections, containers

#### Vertical Rhythm (Stack)
- **sm (8px)**: Tight groupings, form fields
- **md (16px)**: Related content, list items
- **lg (24px)**: Unrelated content, sections
- **xl (32px)**: Major section breaks

#### Horizontal Spacing (Inline)
- **sm (8px)**: Icon + text, button groups
- **md (12px)**: Navigation items
- **lg (16px)**: Card grid gaps
- **xl (24px)**: Wide layouts, dashboards

---

## Implementation Notes

### CSS Custom Properties
All tokens should be implemented as CSS custom properties for easy theming:

```css
:root {
  /* Dark-first (default) */
  --bg-black:        #0B0B0D;
  --surface-charcoal:#17181C;
  --color-gold:      #D4AF37;  /* primary */
  --text-primary:    #F5F5F7;
  /* ... all tokens */
}

[data-theme="light"] {
  /* Optional light mode overrides (secondary) */
  --bg-black:        #FFFFFF;
  --surface-charcoal:#F5F5F7;
  --color-gold:      #B8932F;  /* deepen gold for contrast on light */
  --text-primary:    #0B0B0D;
  /* ... all tokens */
}
```

### Tailwind Integration
Tokens map directly to Tailwind v4 theme configuration:

```css
@import "tailwindcss";

@theme {
  --color-primary-50: #F5F3FF;
  --font-size-base: 1rem;
  --spacing-4: 1rem;
  /* ... etc */
}
```

### Figma Styles
1. Create **Color Styles** for each token with naming convention:
   - `Primary/500`
   - `Neutral/900`
   - `Semantic/Success/500`

2. Create **Text Styles** for each combination:
   - `Display/7XL/Bold`
   - `Body/Base/Normal`

3. Create **Effect Styles** for shadows:
   - `Shadow/MD`
   - `Shadow/XL`

---

## Accessibility

### Color Contrast Ratios
All text must meet WCAG AA standards:
- **Large text (18px+)**: 3:1 minimum
- **Normal text**: 4.5:1 minimum
- **UI components**: 3:1 minimum

### Recommended Pairings (Dark Mode — default)
- **Headings**: off-white `#F5F5F7` on black `#0B0B0D` (✓ 18.4:1, AAA)
- **Body**: off-white `#F5F5F7` on charcoal `#17181C` (✓ ~15:1)
- **Secondary text**: cool gray `#8E929B` on black `#0B0B0D` (✓ 6.3:1, AA)
- **Gold heading/icon**: gold `#D4AF37` on black `#0B0B0D` (✓ 9.3:1, AAA)
- **Primary button**: black `#0B0B0D` on gold `#D4AF37` (✓ 9.3:1, AAA)

### Forbidden Pairing
- ❌ **Off-white on gold** (`#F5F5F7` on `#D4AF37`) = ~2.0:1 — fails. Use **black** text on gold fills.

---

**End of Design System Documentation**
