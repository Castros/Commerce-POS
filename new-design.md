---
name: Teal-Modular POS
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#3e4947'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#6e7977'
  outline-variant: '#bdc9c6'
  surface-tint: '#006a63'
  primary: '#005c55'
  on-primary: '#ffffff'
  primary-container: '#0f766e'
  on-primary-container: '#a3faef'
  inverse-primary: '#80d5cb'
  secondary: '#555f70'
  on-secondary: '#ffffff'
  secondary-container: '#d6e0f4'
  on-secondary-container: '#596374'
  tertiary: '#7f4025'
  on-tertiary: '#ffffff'
  tertiary-container: '#9c573a'
  on-tertiary-container: '#ffe5db'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#9cf2e8'
  primary-fixed-dim: '#80d5cb'
  on-primary-fixed: '#00201d'
  on-primary-fixed-variant: '#00504a'
  secondary-fixed: '#d9e3f7'
  secondary-fixed-dim: '#bdc7db'
  on-secondary-fixed: '#121c2a'
  on-secondary-fixed-variant: '#3d4757'
  tertiary-fixed: '#ffdbce'
  tertiary-fixed-dim: '#ffb598'
  on-tertiary-fixed: '#370e00'
  on-tertiary-fixed-variant: '#72361b'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  h1:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  h2:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
  tabular-nums:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  container-padding: 16px
  table-cell-padding: 8px 12px
---

## Brand & Style
This design system is engineered for high-throughput retail environments where speed of service and administrative precision are paramount. The aesthetic is strictly **Minimalist/Corporate**, utilizing a flat UI approach that eliminates visual noise like gradients and illustrations to focus the user's attention on transactional data.

The system prioritizes functional efficiency over decorative flair. It targets cashiers who require rapid tactile feedback and administrators who manage complex inventories. The emotional response is one of controlled stability and utilitarian reliability, ensuring that the interface never distracts from the core task of commerce.

## Colors
The palette is rooted in high-contrast utility. The **Deep Teal (#0f766e)** serves as the primary action color, providing a strong visual anchor for critical touchpoints. Backgrounds utilize a tiered system of whites and light grays (#f9fafb) to differentiate between navigation, work areas, and secondary panels.

Text is strictly **Charcoal (#1f2937)** to ensure maximum legibility and WCAG AA compliance against all surface levels. Borders are kept muted (#e5e7eb) to define structure without adding weight. A bright, visible focus state using a 2px offset ring in a lighter teal (#2dd4bf) is mandatory for keyboard and scanner-based navigation.

## Typography
The typography system uses **Inter** exclusively to leverage its exceptional legibility in dense interfaces. A modular scale is applied to maintain clarity in high-information environments. 

**Tabular Numerals** must be enabled for all price points, quantities, and SKU numbers to ensure vertical alignment in tables and receipts. All labels for secondary metadata use the `label-caps` style to provide distinct visual hierarchy without increasing font size. Line heights are kept tight to maximize "above-the-fold" content in the cart and inventory views.

## Layout & Spacing
The system employs a **Fluid Grid** for administrative views and a **Fixed Sidebar/Dynamic Main** layout for the cashier interface. Spacing is governed by a 4px base unit, focusing on a "compact" density setting.

- **SidebarNav:** Fixed at 240px for desktop, collapsible to 64px.
- **CartPanel:** Fixed at 380px on the right side of the POS terminal to provide a consistent touch target for the cashier.
- **Density:** Table rows are capped at 40px height to ensure high data visibility. Component margins are minimized to reduce eye travel time between the product grid and the cart summary.

## Elevation & Depth
This design system uses **Tonal Layers** and **Low-Contrast Outlines** instead of traditional shadows. Depth is communicated through color-blocking and stroke-based containment.

- **Level 0 (Base):** Light gray (#f3f4f6) for the main application background.
- **Level 1 (Surface):** Pure white (#ffffff) for cards, product tiles, and data tables. Each surface is defined by a 1px solid border (#e5e7eb).
- **Level 2 (Overlay):** Drawer panels and Modals use a subtle 4px blur backdrop but rely on a darker 1px border (#d1d5db) to stand out, ensuring no heavy shadows muddy the "flat" aesthetic.

## Shapes
The shape language is **Soft (0.25rem - 0.5rem)**, capped at a maximum of 8px. This creates a professional, organized appearance that feels modern but remains structurally rigid enough for data-heavy layouts.

- **Action Elements:** Buttons and Input fields use a 4px radius to feel precise.
- **Container Elements:** Product tiles and Modals use the 8px radius to subtly soften the layout edges.
- **Status Indicators:** Status badges use a 2px radius or remain square-edged to avoid being mistaken for interactive "pill" buttons.

## Components

### Navigation & Headers
- **SidebarNav:** Solid white background, 1px right border. Active states use a 3px teal vertical bar on the left edge with a subtle teal tint on the background.
- **TopBar:** Compact 56px height. Contains search, system status, and user profile.
- **ActionToolbar:** Sits below the PageHeader; contains primary actions like "Add Product," "Export," and "Filter."

### Data & Lists
- **DataTable:** Flat design. No cell borders; only horizontal row dividers. Header cells use `label-caps` with a light gray background.
- **CartLineItem:** Condensed height (52px). High-contrast price on the right. Swipe-to-delete gestures for touch interfaces.
- **MetricTile:** Simple white boxes with a 1px border. Large tabular-numeral values. No icons, just clear labels.

### Controls & Inputs
- **PaymentMethodButton:** Large touch targets (min 64px height). High-contrast icons (flat) and centered text.
- **QuantityStepper:** Integrated into the CartLineItem. Large '+' and '-' targets with the current value in the center.
- **FilterBar:** Horizontal arrangement of "chips" that toggle state; uses the muted border when inactive and deep teal when active.

### Overlays
- **DrawerPanel:** Slides from the right to reveal the CartSummary or ProductDetails. 
- **ModalDialog:** Centered, maximum 600px width. Primary action button always positioned in the bottom right for consistent user flow.