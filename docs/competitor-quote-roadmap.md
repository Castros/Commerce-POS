# Competitor Quote Roadmap

Source reviewed:

```text
PC - Oxfordian School.pdf
```

The quote is a PayMon proposal for school cafeteria digitization. It positions a
monthly software license, optional payment terminal, transaction fee, full school-cycle
contract, and operational support.

## Quote Baseline

- Monthly software license: `$6,700 + IVA`.
- Optional POS terminal: `$2,800 + IVA` one-time.
- Transaction cost: `2.9%` on card/transfer sales.
- Contract: complete school cycle.
- Included capabilities:
  - POS terminal/app for in-person sales.
  - iOS, Android, and Web app access.
  - Menu/product management.
  - Real-time sales reporting.
  - Inventory tracking.
  - Users, locations, cashiers, and POS points.
  - Daily cash drawer closeout.
  - Cash, card, transfer, and credit sales.
  - Training, materials, and account support.

## Demo Differentiator

Commerce POS should not pitch as a generic cafeteria POS only. The stronger pitch is:

```text
School cafeteria POS + Student Educational App integration
```

The demo should show a student purchase updating the student/parent education app
immediately, with the school keeping one connected operational flow.

## Build Priority

1. Product/catalog admin:
   - Add/edit products.
   - Price, SKU, description, image URL, taxable, active/inactive.
   - Feed the register product tiles from the same catalog.
2. Cashier role and login:
   - Cashier can sell and search students.
   - Manager/admin controls products, inventory, reports, settings, and staff.
3. Reports:
   - Daily sales.
   - Sales by product.
   - Payment method totals.
   - Cash drawer variance.
   - Cashier/store activity.
4. Parent/student wallet funding:
   - Parent top-up flow.
   - Payment provider integration later.
5. Receipt printing:
   - Browser print receipt first.
   - Hardware printer later.
6. Deployment and support docs:
   - Local/production runbook.
   - Backup/restore.
   - School onboarding checklist.

## Current Status

The product/catalog admin slice is now started. `/products` loads live demo catalog
data through the API and supports creating/updating products with image URL, price,
SKU, description, taxable, and active status.

