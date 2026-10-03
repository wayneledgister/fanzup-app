# FanZuP Icon Library

**Total Icons:** 116  
**Source:** Lucide React  
**Available Sizes:** 16px / 20px / 24px

---

## Icon Categories

### Navigation (16 icons)
Icons for app navigation, directional controls, and menu elements.

- Home
- Search
- Bell
- User
- Settings
- Menu
- ChevronLeft
- ChevronRight
- ChevronDown
- ChevronUp
- ArrowLeft
- ArrowRight
- ArrowUp
- ArrowDown
- MoreHorizontal
- MoreVertical

### Actions (20 icons)
Icons for user actions, editing, and common operations.

- Plus
- Minus
- X
- Check
- Edit
- Trash2
- Copy
- Download
- Upload
- Share2
- Send
- Save
- RefreshCw
- RotateCw
- Maximize2
- Minimize2
- ZoomIn
- ZoomOut
- Filter
- SlidersHorizontal

### Status & Alerts (15 icons)
Icons for status indicators, alerts, and security.

- CheckCircle2
- XCircle
- AlertCircle
- AlertTriangle
- Info
- Clock
- Eye
- EyeOff
- Lock
- Unlock
- Shield
- ShieldCheck
- ShieldAlert
- TrendingUp
- TrendingDown

### Media & Content (13 icons)
Icons for media playback, audio/video controls, and content types.

- Image
- Video
- Music
- Mic
- Camera
- Film
- Play
- Pause
- SkipBack
- SkipForward
- Volume2
- VolumeX
- Headphones

### Communication & Social (12 icons)
Icons for messaging, social interactions, and engagement.

- Mail
- MessageSquare
- MessageCircle
- Phone
- PhoneCall
- Users
- UserPlus
- UserMinus
- Heart
- Star
- ThumbsUp
- ThumbsDown

### Files & Documents (8 icons)
Icons for file management and document types.

- File
- FileText
- Folder
- FolderOpen
- Paperclip
- Link
- ExternalLink
- BookOpen

### Commerce & Finance (8 icons)
Icons for financial transactions, shopping, and analytics.

- ShoppingCart
- CreditCard
- DollarSign
- Tag
- Gift
- TrendingUp
- BarChart3
- PieChart

### Date & Time (3 icons)
Icons for dates, calendars, and time.

- Calendar
- CalendarDays
- Clock

### Location & Maps (4 icons)
Icons for location, navigation, and maps.

- MapPin
- Map
- Navigation
- Globe

### Miscellaneous (17 icons)
Icons for various other use cases.

- Award
- Zap
- Target
- Flag
- Bookmark
- Hash
- AtSign
- Percent
- HelpCircle
- Building2
- Briefcase
- Code
- Terminal
- Database
- Server
- Wifi
- WifiOff

---

## Size Guidelines

### 16px (w-4 h-4)
**Use for:**
- Inline with small text (12-14px)
- Compact UI elements
- Badges and tags
- Dense data tables

**Example:**
```tsx
<Home className="w-4 h-4" />
```

### 20px (w-5 h-5) — **Default**
**Use for:**
- Standard buttons
- Navigation items
- List items
- Form inputs
- Body text (16px)

**Example:**
```tsx
<Search className="w-5 h-5" />
```

### 24px (w-6 h-6)
**Use for:**
- Large buttons
- Headers and titles
- Prominent actions
- Hero sections
- Empty states

**Example:**
```tsx
<Settings className="w-6 h-6" />
```

---

## Color Usage

Icons inherit text color by default. Apply color using Tailwind utilities:

```tsx
// Primary action
<Plus className="w-5 h-5 text-purple-600" />

// Subtle/secondary
<Settings className="w-5 h-5 text-gray-500" />

// Success
<CheckCircle2 className="w-5 h-5 text-green-600" />

// Error
<XCircle className="w-5 h-5 text-red-600" />

// Warning
<AlertTriangle className="w-5 h-5 text-yellow-600" />
```

---

## Technical Implementation

### Package
```bash
pnpm add lucide-react
```

### Import
```tsx
import { Home, Search, User } from "lucide-react";
```

### Usage
```tsx
<Home className="w-5 h-5 text-purple-600" />
```

### Props
All Lucide icons accept standard SVG attributes:
- `className` - Tailwind classes for size and color
- `strokeWidth` - Line thickness (default: 2)
- `size` - Shorthand for width/height (use className instead for consistency)
- All standard React/SVG props

---

## Design Principles

1. **Consistent Stroke Width**  
   All icons use a 2px stroke width for visual harmony across the system.

2. **Scalable Vector**  
   Icons are true SVG paths that scale cleanly at any size.

3. **Accessibility**  
   - Icons inherit current text color
   - Use `aria-label` or accompanying text for screen readers
   - Maintain 3:1 contrast ratio minimum

4. **Semantic Usage**  
   Choose icons that clearly communicate their function without requiring explanation.

---

## View Full Library

Navigate to `/icons` to see all icons rendered at 16px, 20px, and 24px with import code.
