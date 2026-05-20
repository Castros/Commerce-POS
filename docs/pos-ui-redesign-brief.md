# POS UI Redesign Brief

This brief captures the current visual redesign direction for Commerce POS.
The goal is to restyle the existing app to match the provided tablet POS
reference without changing how the product works.

## Scope

This is a visual and layout pass only.

Do not change:

- API calls.
- Checkout logic.
- Wallet math.
- Student lookup behavior.
- Credit limit enforcement.
- Inventory decrement behavior.
- Refund behavior.
- Cash drawer behavior.
- Permissions or route access.
- Existing feature availability.

The current system behavior stays intact. The redesign should make the existing
screens feel cleaner, more touch-friendly, and closer to a polished cafeteria POS.

## Stitch Source

Original Stitch project:

```text
Title: Commerce POS Frontend
Project ID: 13326238815075879327
```

Existing Stitch screens:

- Dashboard
- Register
- Inventory
- Orders
- Customers
- Reports
- Staff & Payments
- Settings

Primary screen for the first implementation pass:

```text
Register
Screen ID: 9225f1a5e3f04a0fb33b473ffa2b648d
```

## Visual Direction

Use the provided tablet POS reference as the visual target:

- Light gray app canvas.
- White rounded panels.
- Subtle gray borders.
- Low, soft shadows only where useful.
- Blue for selected, active, and primary action states.
- Green only for positive wallet balance and success states.
- Red only for negative balance, blocked credit, refund, and destructive states.
- Image-led product tiles.
- Compact top navigation.
- Persistent right checkout/details rail.
- Dense but readable operator layout.

Avoid:

- Marketing-style hero sections.
- Decorative backgrounds.
- Heavy gradients.
- Dark shells.
- Adding restaurant-only concepts that do not exist in the product.
- Hiding current product functionality.

## Design Tokens

Recommended baseline tokens:

```css
--bg-app: #f3f6fa;
--bg-panel: #ffffff;
--bg-muted: #f8fafc;
--border-soft: #e2e8f0;
--border-strong: #cbd5e1;

--text-primary: #0f172a;
--text-secondary: #475569;
--text-muted: #64748b;

--blue: #2563eb;
--blue-soft: #dbeafe;
--blue-hover: #1d4ed8;

--green: #16a34a;
--red: #dc2626;
--amber: #d97706;

--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;

--shadow-panel: 0 1px 2px rgb(15 23 42 / 0.06);
--shadow-float: 0 8px 24px rgb(15 23 42 / 0.08);
```

Use Inter or the current app font. Keep body text at 14px or larger for cashier
workflows.

## Register Layout

`/register` remains the primary cashier workspace.

Recommended visual structure:

- Top bar with store/register context, cashier/session status, and route tabs.
- Main left area with category tabs and image-led product grid.
- Compact student lookup area that keeps the current search behavior.
- Selected student summary showing student identity and signed wallet balance.
- Right checkout rail with cart items, payment controls, subtotal, tax, total,
  and complete-sale action.

The selected student panel should remain simple:

- Positive balance: green signed amount.
- Negative balance: red signed amount.
- Credit block warning only when the existing business logic blocks checkout.

Do not reintroduce detailed credit math in the cashier UI.

## Product Tiles

Product tiles should be optimized for quick touch selection:

- Fixed image area with consistent aspect ratio.
- Product name and price below the image.
- Compact stock/low-stock state where relevant.
- Blue border or pale blue background for selected/added state.
- Muted disabled state for out-of-stock items.

Keep the existing product image URL behavior.

## Checkout Rail

The checkout rail should behave like a persistent receipt preview:

- Width around 340px to 400px on desktop/tablet.
- White panel with soft border and 12px radius.
- Current order lines with quantity, item name, and line price.
- Payment method controls for cash, card, and wallet.
- Clear totals section: subtotal, tax, discount if present, total.
- Full-width blue primary checkout button.
- Secondary actions as outline or ghost buttons.

Keep the current sale submission flow and idempotency behavior.

## Other Screens

Apply the same visual system across existing modules:

- `/dashboard`: operational overview with clean metric panels.
- `/orders`: receipt list/detail with a right detail rail where useful.
- `/inventory`: live stock table/list with status chips.
- `/inventory/receiving`: approval workspace for supplier invoices, CSV imports,
  AI receipt drafts, and transfers.
- `/payments`: cash drawer open/close and variance panels.
- `/settings`: structured admin panels for locations, registers, tax, receipt,
  integration, and permissions settings.
- `/staff`: role and credential issuance panels.

Do not change the underlying workflow for any module during the visual pass.

## Component Direction

Extract shared UI as the redesign proceeds:

- `TopNav`
- `ModuleTabs`
- `Surface`
- `MetricCard`
- `ProductTile`
- `CheckoutRail`
- `OrderLine`
- `StudentSearchPanel`
- `SignedBalance`
- `StatusChip`
- `ActionButton`
- `DataTable`

This keeps the style consistent and avoids duplicating one-off page CSS.

## Accessibility

- Maintain WCAG AA contrast.
- Keep visible focus states.
- Do not communicate payment, refund, stock, or wallet state by color alone.
- Preserve keyboard navigation and form labels.
- Keep cashier touch targets at least 44px.

## Implementation Order

1. Update shared design tokens in `web/app/styles.css`.
2. Restyle `AppShell` and route navigation.
3. Restyle `/register` first.
4. Extract reusable register components.
5. Apply the same shell to `/orders`, `/inventory`, `/payments`, and `/settings`.
6. Run `npm run build` and visually verify desktop/tablet layouts.
