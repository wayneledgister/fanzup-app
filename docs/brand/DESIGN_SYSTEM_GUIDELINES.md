# FanZuP Design System Guidelines

Comprehensive documentation for component usage, accessibility standards (WCAG AA), and Figma-to-dev handoff conventions.

---

## Table of Contents

1. [Component Usage Guidelines](#component-usage-guidelines)
2. [Accessibility Standards (WCAG AA)](#accessibility-standards-wcag-aa)
3. [Figma-to-Dev Handoff Conventions](#figma-to-dev-handoff-conventions)
4. [Pre-Handoff Checklist](#pre-handoff-checklist)

---

## Component Usage Guidelines

### Buttons

#### Primary Button
**When to use:** Main action on a page (limit one per screen)  
**Examples:** "Submit", "Continue", "Save", "Create Campaign"  
**Don't use for:** Destructive actions, secondary actions  
**Styling:** Gold `#D4AF37` background, **black** `#0B0B0D` text, rounded-lg (hover → champagne `#F0D98A`; pressed → deep gold `#B8932F`)

#### Secondary Button
**When to use:** Alternative or less important actions  
**Examples:** "Cancel", "Back", "Skip", "Learn More"  
**Don't use for:** Primary call-to-action  
**Styling:** White background, gray-300 border, rounded-lg

#### Destructive Button
**When to use:** Permanent, destructive actions  
**Examples:** "Delete", "Remove", "Disconnect", "Reject"  
**Always:** Require confirmation dialog before action  
**Styling:** Red-600 background, white text, rounded-lg

#### Button Sizes
- **Small (px-3 py-1.5):** Compact UIs, inline actions, tables
- **Medium (px-4 py-2):** Default for most use cases
- **Large (px-6 py-3):** Hero sections, critical CTAs, landing pages

---

### Form Inputs

#### Text Input Requirements
**Always include:**
- Label (visible, associated with input)
- Placeholder text (examples, not instructions)
- Helper text (when additional context needed)

**Required fields:** Mark with asterisk (*) in label

**Validation:**
- Show error state with red border (border-red-500)
- Display specific error message below input
- Show success state with green border (border-green-500) when appropriate

#### Input States
- **Default:** Gray-300 border, white background
- **Hover:** Gray-400 border
- **Focus:** Gold `#D4AF37` border + 2px gold ring (ring-2)
- **Disabled:** Gray-200 background, gray-400 border, gray-500 text
- **Error:** Red-500 border, red-50 background, red-700 error text
- **Success:** Green-500 border, green-700 success text

---

### Cards

**When to use:** Grouping related information, displaying content items

**Specifications:**
- Padding: 24px (p-6) for standard cards
- Border radius: 8px (rounded-lg)
- Border: 2px solid for emphasized cards, 1px for subtle
- Max width: Don't exceed 600px for content readability

**Interactive cards:**
- Add hover state: shadow-lg, scale-102
- Cursor: pointer
- Ensure entire card is clickable

---

### Badges

**When to use:** Status indicators, labels, categories, counts

**Color coding:**
- **Green:** Success, Active, Approved, Verified
- **Yellow:** Warning, Pending, In Review, Draft
- **Red:** Error, Rejected, Failed, Blocked
- **Blue:** Info, Processing, New, Updated
- **Gray:** Neutral, Inactive, Archived

**Guidelines:**
- Keep text to 1-2 words maximum
- Use title case (e.g., "In Review")
- Don't use for long text (use labels or text instead)
- Don't use for interactive elements (use buttons)

---

### Modals

**When to use:**
- Confirmation dialogs (delete, cancel, discard)
- Forms requiring user focus
- Critical information that blocks workflow

**Always include:**
- Close button (X icon in top right)
- Backdrop overlay (semi-transparent black)
- ESC key closes modal
- Focus trap (Tab stays within modal)

**Specifications:**
- Max width: 500px for simple dialogs, 800px for forms
- Padding: 32px (p-8)
- Actions: Cancel on left, primary action on right
- Backdrop: bg-black/50

**Don't use for:**
- Non-critical notifications (use toast instead)
- Long-form content (use separate page)

---

### Toasts

**When to use:** Temporary feedback messages, notifications

**Types:**
- **Success:** Green background, checkmark icon
- **Error:** Red background, X icon
- **Warning:** Yellow background, alert icon
- **Info:** Blue background, info icon

**Specifications:**
- Auto-dismiss after 5 seconds
- Position: Top-right or bottom-right
- Max width: 400px
- Allow manual dismiss (X button)

---

## Accessibility Standards (WCAG AA)

### Color Contrast Ratios

#### Requirements
- **Normal text (16px+):** Minimum 4.5:1 contrast ratio
- **Large text (24px+ or 18px+ bold):** Minimum 3:1 contrast ratio
- **UI components & graphics:** Minimum 3:1 contrast ratio

#### Passing Combinations (dark-first)
✅ Off-white `#F5F5F7` on Black `#0B0B0D`: 18.4:1  
✅ Gold `#D4AF37` on Black `#0B0B0D`: 9.3:1  
✅ Black `#0B0B0D` on Gold `#D4AF37`: 9.3:1  
✅ Cool gray `#8E929B` on Black `#0B0B0D`: 6.3:1

#### Failing Combinations
❌ Off-white `#F5F5F7` on Gold `#D4AF37`: 2.0:1 (never put light text on gold)  
❌ Cool gray `#8E929B` on Charcoal `#17181C`: ~2.7:1 (too low for body)  
❌ Deep gold `#B8932F` on Black: 2.9:1 (use full gold `#D4AF37` for text)

#### Testing Tools
- WebAIM Contrast Checker
- Figma plugins: "Contrast", "Stark"
- Browser DevTools accessibility audit

---

### Keyboard Navigation

#### Tab Order Requirements
- All interactive elements must be keyboard accessible
- Tab order follows logical reading order (top → bottom, left → right)
- Include "Skip to main content" link for long navigation
- No keyboard traps (users can always Tab away)

#### Required Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Tab` | Move to next interactive element |
| `Shift + Tab` | Move to previous element |
| `Enter` or `Space` | Activate button/link |
| `Esc` | Close modal/dropdown |
| `Arrow keys` | Navigate lists/menus |
| `Home` / `End` | Jump to start/end of list |

#### Focus States
**Required:** Visible focus indicator on all interactive elements

**Specifications:**
- 2px outline or 4px ring
- Minimum 3:1 contrast against background
- Use a 2px gold ring (`ring-2` in gold `#D4AF37`)
- Never remove focus styles (`:focus { outline: none }` is forbidden)

---

### Screen Reader Support

#### Alt Text for Images
**Format:** Describe content and function, not file name

✅ **Good:** "Artist profile photo of Taylor Swift performing on stage"  
❌ **Bad:** "image123.jpg" or "photo"

**Rules:**
- Decorative images: Use empty alt (`alt=""`)
- Functional images: Describe the action (e.g., "Search")
- Complex images: Provide detailed description

#### Accessible Labels

**Form inputs:** Always associate `<label>` with `<input>`
```html
<label for="email">Email Address *</label>
<input id="email" type="email" aria-required="true">
```

**Icon-only buttons:** Use `aria-label`
```html
<button aria-label="Close modal">
  <X className="w-5 h-5" />
</button>
```

**Status updates:** Use `aria-live` for dynamic content
```html
<div aria-live="polite">Campaign created successfully</div>
```

**Required fields:** Mark with `aria-required="true"`

**Error messages:** Link to input with `aria-describedby`
```html
<input id="email" aria-describedby="email-error">
<p id="email-error">Please enter a valid email</p>
```

#### Semantic HTML

✅ **Use:**
- `<button>` for buttons (not `<div onClick>`)
- `<nav>` for navigation
- `<main>` for main content
- `<header>` / `<footer>` for page structure
- `<h1>` - `<h6>` for headings (don't skip levels)

❌ **Avoid:**
- `<div onClick>` instead of `<button>`
- Skipping heading levels (h1 → h3)
- Multiple `<h1>` tags per page
- Unlabeled form controls

---

### Touch Target Sizes

#### WCAG AA Requirements
**Minimum size:** 44×44px for all interactive elements

**Exceptions:**
- Inline text links (but add padding where possible)
- Elements with sufficient spacing (8px+)

#### Best Practices
- **Mobile:** Consider 48×48px minimum for better UX
- **Icon buttons:** Add padding to reach minimum even if icon is smaller
- **Spacing:** Maintain at least 8px between touch targets

**Examples:**
- ✅ Button: 44×44px or larger
- ✅ Icon button: 48×48px with 20px icon
- ❌ Small icon button: 32×32px (too small)

---

## Figma-to-Dev Handoff Conventions

### Naming Conventions

#### Layer Naming Pattern
Use descriptive, hierarchical names (not "Rectangle 42" or "Frame 123")

✅ **Good:**
- Button/Primary/Large
- Card/Artist Profile
- Input/Text/Error State
- Icon/Star/24px
- Modal/Confirmation

❌ **Bad:**
- Rectangle 42
- Frame 123
- Group
- Button copy 3
- Untitled

#### Component Naming Pattern
```
Category / Name / Variant / State
```

**Examples:**
- Button / Primary / Large / Hover
- Input / Text / Default / Focus
- Card / Artist / Elevated / Default
- Badge / Status / Active / Default

#### Page Organization
Use emoji prefixes for quick scanning:

- 🎨 Design System
- 🏠 Dashboard
- 👤 User Onboarding
- 💰 Campaign Flows
- 📱 Mobile Views
- 💻 Desktop Views
- 🧩 Components
- 📋 Documentation

#### Frame Naming
```
Device / Section / Page / State
```

**Examples:**
- Desktop / Campaign / Create / Step 1
- Mobile / Profile / View / Default
- Tablet / Dashboard / Home / Loading

---

### Spacing & Measurements

#### 4px Base Grid
**Rule:** All spacing, sizing, and positioning must use multiples of 4px

**Common values:**
- 4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px, 80px

**Never use:**
- 5px, 15px, 18px, 22px, 35px (not multiples of 4)

#### Auto Layout Settings
Always specify in Figma (translates to CSS Flexbox/Grid):

- **Direction:** Horizontal / Vertical
- **Gap:** Between items (4px increments)
- **Padding:** All sides (4px increments)
- **Alignment:** Start, Center, End, Space Between
- **Resizing:** Fixed, Hug Contents, Fill Container

---

### Typography Specifications

#### Create Text Styles for All Typography
Never use local text formatting—always use shared Text Styles

**Required information:**
- Font family (Inter)
- Font size (px)
- Font weight (400, 500, 600, 700)
- Line height (px or %)
- Letter spacing (if any)
- Tailwind class equivalent

**Example:**
```
Heading 1
Font: Inter Bold
Size: 48px
Weight: 700
Line Height: 56px (1.17)
Tailwind: text-5xl font-bold
```

---

### Color Token Usage

#### Use Named Color Styles Only
**Never use:** Raw hex codes, RGB values, or unnamed colors

✅ **Correct:**
- Gold/Primary (`#D4AF37`)
- Neutral/Text-Primary (`#F5F5F7`)
- Neutral/Text-Muted (`#8E929B`)
- Semantic/Success (`#00C853`)
- Semantic/Error (`#E33035`)

❌ **Wrong:**
- #D4AF37 (raw hex with no token name)
- rgb(212, 175, 55)
- "That gold color"
- Unnamed color

#### Color Documentation Format
For each color, provide:
- **Name:** Gold/Primary
- **Hex:** #D4AF37
- **CSS var:** `var(--color-gold)`
- **Usage:** Primary brand color, CTAs (with black text), focus rings, links on dark

---

### Asset Export Settings

#### Icon Export
- **Format:** SVG
- **Naming:** `icon-name-size.svg` (e.g., `star-24.svg`)
- **Sizes:** 16px, 20px, 24px
- **Outline strokes:** Yes (convert to outlines before export)
- **Remove:** Fill attributes for single-color icons
- **Include:** id attribute, viewBox

#### Image Export
- **Format:** PNG for photos, WebP preferred
- **Resolution:** 2x for retina displays (@2x suffix)
- **Naming:** Descriptive (`artist-hero-banner@2x.png`)
- **Optimization:** Run through TinyPNG or ImageOptim
- **Max size:** 500KB per image (compress if needed)

#### Design Tokens Export
Use Figma Tokens plugin to export:
- Color tokens → CSS variables / Tailwind config
- Typography tokens → Font sizes, weights, line heights
- Spacing tokens → Padding, margin, gap values
- Border radius tokens → Rounded corners
- Shadow tokens → Box shadows, elevations

---

### Design Annotations

#### Required Annotations for Dev Handoff

**Always annotate:**
- ✅ Interactive states (hover, focus, active, disabled)
- ✅ Responsive behavior at each breakpoint (mobile, tablet, desktop)
- ✅ Animation timing and easing (e.g., "Fade in 200ms ease-out")
- ✅ Overflow behavior (scroll, truncate, wrap)
- ✅ Loading states and empty states
- ✅ Error states and validation messages
- ✅ Z-index layering for overlays/modals
- ✅ Max-width and min-width constraints

**Nice to have:**
- 📝 User flow diagrams
- 📝 Conditional logic ("Show if user is logged in")
- 📝 Content character limits (e.g., "Max 280 chars")
- 📝 Third-party integration notes (Stripe, Plaid, etc.)
- 📝 Performance considerations
- 📝 Browser compatibility requirements
- 📝 Analytics event tracking

#### Annotation Format Examples

```
📱 Mobile: Stack vertically, full width
💻 Desktop: 2-column grid, 8+4 split
✨ Hover: Scale 1.02, shadow-lg, 200ms ease
⚠️ Error: Red border, show error text below input
🔄 Loading: Show skeleton with pulse animation
📏 Max width: 1440px, center align
```

---

## Pre-Handoff Checklist

### Components
- [ ] All components use correct variants and instances
- [ ] All states documented (default, hover, focus, active, disabled, error)
- [ ] Component names follow naming convention
- [ ] Reusable components are published library items
- [ ] No local styles—all using shared design system

### Accessibility
- [ ] Color contrast ratios verified (4.5:1 for normal text, 3:1 for large)
- [ ] Touch targets minimum 44×44px
- [ ] Focus states visible on all interactive elements (4px ring, 3:1 contrast)
- [ ] Alt text provided for all images
- [ ] Semantic HTML structure planned (headings, landmarks, buttons)

### Handoff
- [ ] All spacing uses 4px grid (no odd values)
- [ ] Colors use named styles (not hex codes)
- [ ] Typography uses shared text styles
- [ ] Responsive behavior annotated for mobile/tablet/desktop
- [ ] Interactive states shown (hover, focus, disabled, error)
- [ ] Loading and empty states designed
- [ ] Assets exported at correct sizes and formats
- [ ] Auto Layout applied to all frames (direction, gap, padding, alignment)
- [ ] Annotations added for complex interactions

### Documentation
- [ ] Component usage guidelines written
- [ ] Design tokens documented
- [ ] Breakpoint specifications clear
- [ ] Export settings defined
- [ ] Handoff meeting scheduled with developers

---

## Resources

### Tools
- **Contrast Checker:** https://webaim.org/resources/contrastchecker/
- **Figma Plugins:** Contrast, Stark, A11y - Color Contrast Checker
- **Color Palette:** https://tailwindcss.com/docs/customizing-colors
- **Typography Scale:** https://type-scale.com/

### Documentation
- **WCAG 2.1 Guidelines:** https://www.w3.org/WAI/WCAG21/quickref/
- **Tailwind CSS:** https://tailwindcss.com/docs
- **React Accessibility:** https://react.dev/learn/accessibility

### Reference
- View interactive documentation: `/design-system-docs`
- Design system tokens: `DESIGN_SYSTEM.md`
- Component library: `/components`
- Icon library: `/icons`
- Layout grid: `/layout-grid`

---

*Last updated: May 30, 2026*
