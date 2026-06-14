# Inventory — UI/UX Redesign + AI Document Ingestion
**Plan version:** 1.0 · June 2026
**Roles:** Frontend, AI Engineer, Data Engineer

---

## 1. Current State — What's Wrong

### Inventory List (`/inventory`)
- **Adjust Stock is buried.** The only way to change stock is a dropdown form at the top — you have to select a product from a `<select>` list, then scroll back up to save. No inline action.
- **Table-only view.** No at-a-glance visual status indicators other than a status column badge. Low-stock and out-of-stock rows look identical to in-stock rows until you read the column.
- **No inline editing.** To change a reorder threshold you have to go elsewhere.
- **CSV import is the only intake method.** Requires structured data in a specific format. Suppliers send PDFs, photos, WhatsApp images. Staff shouldn't need to manually type a CSV.
- **Import modal is disconnected.** After import, no preview of what changed. No history of past imports.

### Receiving Page (`/inventory/receiving`)
- **UI is a developer test form,** not a workflow a manager would use daily. Supplier form, invoice form, CSV textarea, and AI draft button are four equal-weight forms with no clear hierarchy.
- **AI receipt capture is fake.** The "Create AI review draft" button posts hardcoded demo data — no image is ever processed. The backend endpoints (`/inventory/suppliers`, `/inventory/invoices`, `/inventory/receipt-drafts`, `/inventory/transfers`) don't exist in the API at all.
- **No document scanning UX.** No drag-and-drop, no camera capture, no file type flexibility.
- **No learning loop.** When a manager corrects an AI extraction, that correction disappears. The AI starts from scratch every time.

---

## 2. Goals

1. **Inventory list**: Fast, visual, action-oriented. A manager should be able to scan stock status and adjust quantities without leaving the list.
2. **AI document intake**: Upload a photo, PDF, or image of a supplier invoice/receipt. AI extracts line items. Manager reviews, corrects, approves. Stock updates automatically.
3. **Learning loop**: Every correction the manager makes is stored. The AI uses accumulated corrections to improve extraction accuracy over time — without fine-tuning, using prompt injection of past corrections as examples.
4. **Data integrity**: Nothing changes stock until a human approves. The AI only ever creates draft records.

---

## 3. UI/UX Redesign

### 3A. Inventory List — New Layout

Replace the current flat table + top form with a **two-panel layout**: left is a filterable status-grouped list, right is a product detail/action drawer.

```
┌─────────────────────────────────────────────────────────────────┐
│  Stock Management                    [+ Receive Stock]  [Import] │
├────────────┬────────────┬────────────┬────────────┐             │
│ 42 Total   │ 38 In Stock│ ⚠ 3 Low   │ ✕ 1 Out   │             │
├────────────┴────────────┴────────────┴────────────┘             │
│  [Search SKU, product...]  [All ▾]  [Low stock only ●]          │
├─────────────────────────────────────┬───────────────────────────┤
│ PRODUCT LIST                        │  DETAIL PANEL             │
│                                     │                           │
│ ⚠ LOW STOCK  ───────────────────── │  Water Bottle             │
│                                     │  SKU: DEMO-WATER          │
│ [🟡] Water Bottle      14 / 60 ▓░░ │  ─────────────────────── │
│      DEMO-WATER · Main Store        │  On hand     14 units     │
│      Last received: 3 days ago      │  Reorder at  60 units     │
│                                     │  Last adjust  3 days ago  │
│ ✕ OUT OF STOCK  ────────────────── │                           │
│                                     │  Quick adjust             │
│ [🔴] Lunch Combo        0 / 25 ░░░ │  [  − 10  ] [ __ ] [+ 10]│
│      DEMO-LUNCH · Main Store        │  [ Save adjustment ]      │
│      No recent receives             │                           │
│                                     │  Note: [Received stock  ] │
│ ✓ IN STOCK  ──────────────────────  │                           │
│                                     │  ─────────────────────── │
│ [🟢] Agua Fresca      220 / 50 ████│  Reorder threshold        │
│      AGUA-001 · Main Store          │  [  60  ] [ Save ]        │
│ [🟢] Torta Combo      180 / 40 ███ │                           │
│      TORTA-001 · Main Store         │  ─────────────────────── │
│                                     │  Price         $2.50      │
│                                     │  Cost          $0.42      │
│                                     │  Margin        83.2%      │
│                                     │                           │
│                                     │  [View receive history]   │
└─────────────────────────────────────┴───────────────────────────┘
```

**Key changes:**
- Status-grouped rows (Out → Low → In Stock) so critical items are always at the top
- Visual stock bar (mini progress bar showing qty vs. threshold)
- Click any row → right panel opens with inline quick-adjust (+/- buttons + freeform input)
- Reorder threshold editable inline in the panel
- Cost + margin shown if cost data exists (COGS)
- No modal needed for a simple adjustment

### 3B. Status Row Visual Design

```
 [🔴] Lunch Combo                    0  /  25  ░░░░░░░░░░  Out of stock
 [🟡] Water Bottle                  14  /  60  ▓░░░░░░░░░  Low stock
 [🟢] Agua Fresca                  220  /  50  ██████████  In stock
```

The mini bar fills proportionally to qty/threshold. At 0% it's all-empty, at 100%+ it's full.

### 3C. Receive Stock — Redesigned as a Workflow

Replace the four-panel form grid with a **step-based intake wizard**:

```
┌─────────────────────────────────────────────────────────────────┐
│  Receive Stock                                          ✕ Close  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  How are you adding stock?                                      │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │  📷              │  │  📄              │  │  ✏️          │  │
│  │  Upload invoice  │  │  Upload PDF /    │  │  Enter      │  │
│  │  or receipt photo│  │  CSV file        │  │  manually   │  │
│  │                  │  │                  │  │             │  │
│  │  AI extracts     │  │  AI reads or     │  │  Line by    │  │
│  │  line items for  │  │  parses columns  │  │  line form  │  │
│  │  your review     │  │  for your review │  │             │  │
│  └──────────────────┘  └──────────────────┘  └─────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

After AI extraction, the **review screen** is where the learning loop lives:

```
┌─────────────────────────────────────────────────────────────────┐
│  AI extracted 6 items from "Fresh-Foods-Invoice-042.jpg"        │
│  Confidence: 91% · Supplier: Fresh Foods Co (matched ✓)         │
│  Invoice #: INV-10042 · Date: June 12, 2026                     │
├──────────────────┬───────┬──────────┬──────────┬───────────────┤
│ AI read          │ Match │ Qty      │ Unit cost│ Action        │
├──────────────────┼───────┼──────────┼──────────┼───────────────┤
│ "Botella Agua    │ ✓     │ 144      │ $0.42    │ [Accept]      │
│  500ml"          │Water  │          │          │               │
│                  │Bottle │          │          │               │
├──────────────────┼───────┼──────────┼──────────┼───────────────┤
│ "Combo almuerzo" │ ✓     │ 48       │ $2.10    │ [Accept]      │
│                  │Lunch  │          │          │               │
│                  │Combo  │          │          │               │
├──────────────────┼───────┼──────────┼──────────┼───────────────┤
│ "Jugo manzana"   │ ?     │ 24       │ $0.85    │ [Match ▾]     │
│                  │Needs  │          │          │ [Skip]        │
│                  │match  │          │          │               │
├──────────────────┼───────┼──────────┼──────────┼───────────────┤
│ "Pan integral"   │ ✓     │ [  36  ] │ [$1.20 ] │ [Accept]      │
│                  │Wheat  │ ← editable fields   │               │
│                  │Bread  │          │          │               │
└──────────────────┴───────┴──────────┴──────────┴───────────────┘

 [← Back]                         [Approve & receive stock →]
```

Every cell where the manager changes a value is a **correction signal** captured and stored.

---

## 4. AI Architecture — Document Ingestion

### 4A. Extraction Flow

```
Manager uploads file
        │
        ▼
  File type detection
  ┌─────┴─────┐
  │           │
 Image      PDF
  │           │
  ▼           ▼
 Send to   Convert to
 Claude    image pages
 Vision   (pdf-to-image)
  │           │
  └─────┬─────┘
        │
        ▼
  Claude extracts structured data:
  - Supplier name, invoice number, date
  - Line items: description, quantity, unit cost
  - Per-line confidence score

        │
        ▼
  Product matching:
  - Fuzzy match extracted names against commerce_products
    (pg_trgm similarity OR embedding cosine similarity)
  - Low confidence → flagged for manual match

        │
        ▼
  Draft saved to commerce_inventory_receipt_drafts
  Status: "pending_review"
  No stock changed yet.

        │
        ▼
  Manager reviews in UI
  Accepts / corrects / skips each line

        │
        ▼
  Corrections saved to commerce_ai_inventory_corrections
  (extracted text → correct product ID + quantities)

        │
        ▼
  Manager approves
        │
        ▼
  commerce_inventory_movements rows written
  Stock updated atomically
  Draft status → "approved"
```

### 4B. Learning Loop (Prompt-Based, No Fine-Tuning)

Each time Claude extracts items, we inject the **last N corrections for this org** as few-shot examples into the system prompt:

```
System prompt (simplified):

You are an inventory extraction assistant for a school cafeteria POS.
Extract supplier invoice line items as structured JSON.

PAST CORRECTIONS FOR THIS ORGANIZATION:
- "Botella agua 500ml" → product: "Water Bottle" (SKU: DEMO-WATER)
- "Combo de almuerzo" → product: "Lunch Combo" (SKU: DEMO-LUNCH-COMBO)
- "Pan Bimbo" → product: "Wheat Bread" (SKU: BREAD-001)
- "jugo de manzana natural" → product: "Apple Juice" (SKU: JUICE-AJ)

Use these corrections to improve your product name matching.
```

This means accuracy improves organically as managers correct the AI — no model retraining, no fine-tuning, no external service. The corrections table is the "memory."

### 4C. Confidence Scoring

Each extracted line gets a confidence score (0.0–1.0):
- `>= 0.90` → auto-matched, shown as accepted (manager can still override)
- `0.70–0.89` → matched but highlighted for review
- `< 0.70` → flagged as "Needs match" — product dropdown shown, no auto-accept

### 4D. Product Matching Strategy

1. **Exact SKU match** — if invoice has a barcode/SKU that matches `commerce_products.sku` → confidence 1.0
2. **Correction table lookup** — if extracted text matches a stored correction for this org → confidence 0.95
3. **PostgreSQL trigram similarity** (`pg_trgm`) — fuzzy match on product name → confidence proportional to score
4. **Claude's own match from extraction** — when Claude identifies the product in its output → confidence from Claude

---

## 5. Database Schema Additions

### New tables

```sql
-- Supplier directory per org
CREATE TABLE commerce_inventory_suppliers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES commerce_organizations(id),
  name             TEXT NOT NULL,
  vendor_number    TEXT,
  email            TEXT,
  phone            TEXT,
  address_line1    TEXT,
  city             TEXT,
  region           TEXT,
  postal_code      TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Receiving invoices (created from any source: AI, CSV, manual)
CREATE TABLE commerce_inventory_invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES commerce_organizations(id),
  store_id         UUID REFERENCES commerce_stores(id),
  supplier_id      UUID REFERENCES commerce_inventory_suppliers(id),
  invoice_number   TEXT,
  invoice_date     DATE,
  received_date    DATE,
  source           TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'ai_image', 'ai_pdf', 'csv'
  status           TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  total_cents      BIGINT NOT NULL DEFAULT 0,
  tax_cents        BIGINT NOT NULL DEFAULT 0,
  notes            TEXT,
  raw_file_url     TEXT,   -- Cloudinary URL of uploaded image/PDF
  approved_by      UUID REFERENCES commerce_users(id),
  approved_at      TIMESTAMPTZ,
  created_by       UUID REFERENCES commerce_users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Invoice line items
CREATE TABLE commerce_inventory_invoice_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES commerce_organizations(id),
  invoice_id       UUID NOT NULL REFERENCES commerce_inventory_invoices(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES commerce_products(id),
  ai_extracted_text TEXT,        -- raw text Claude read from the document
  product_name     TEXT NOT NULL, -- final name (after correction)
  sku              TEXT,
  quantity         INTEGER NOT NULL,
  unit_cost_cents  BIGINT NOT NULL DEFAULT 0,
  match_status     TEXT NOT NULL DEFAULT 'matched', -- 'matched', 'manual', 'skipped', 'unmatched'
  confidence       NUMERIC(4,3),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI corrections — the learning memory
CREATE TABLE commerce_ai_inventory_corrections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES commerce_organizations(id),
  extracted_text   TEXT NOT NULL,   -- what AI read from the invoice
  product_id       UUID NOT NULL REFERENCES commerce_products(id),
  product_name     TEXT NOT NULL,   -- correct product name
  sku              TEXT,
  usage_count      INTEGER NOT NULL DEFAULT 1,  -- how many times this mapping was confirmed
  last_used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, extracted_text, product_id)
);

-- AI extraction drafts (before review)
CREATE TABLE commerce_inventory_ai_drafts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES commerce_organizations(id),
  store_id         UUID REFERENCES commerce_stores(id),
  supplier_id      UUID REFERENCES commerce_inventory_suppliers(id),
  status           TEXT NOT NULL DEFAULT 'pending_review', -- 'pending_review', 'approved', 'rejected'
  raw_file_url     TEXT NOT NULL,
  file_type        TEXT NOT NULL, -- 'image', 'pdf', 'csv'
  overall_confidence NUMERIC(4,3),
  extracted_payload JSONB NOT NULL DEFAULT '{}',
  ai_model         TEXT,
  ai_tokens_used   INTEGER,
  invoice_id       UUID REFERENCES commerce_inventory_invoices(id),
  created_by       UUID REFERENCES commerce_users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. API Endpoints

### New backend routes (`/v1/inventory/...`)

```
# Suppliers
GET    /v1/inventory/suppliers?organizationId=
POST   /v1/inventory/suppliers
PATCH  /v1/inventory/suppliers/:id

# Invoices (manual + approved AI)
GET    /v1/inventory/invoices?organizationId=&status=
POST   /v1/inventory/invoices               ← manual entry
POST   /v1/inventory/invoices/:id/approve   ← writes movements + updates stock

# AI document ingestion
POST   /v1/inventory/ai/extract             ← upload image/PDF → returns draft
GET    /v1/inventory/ai/drafts?organizationId=
GET    /v1/inventory/ai/drafts/:id
POST   /v1/inventory/ai/drafts/:id/approve  ← creates invoice from reviewed draft
POST   /v1/inventory/ai/drafts/:id/reject

# Corrections / learning
GET    /v1/inventory/ai/corrections?organizationId=
POST   /v1/inventory/ai/corrections         ← save a correction after review
DELETE /v1/inventory/ai/corrections/:id

# Transfers
GET    /v1/inventory/transfers?organizationId=
POST   /v1/inventory/transfers
```

### Extract endpoint behavior

```
POST /v1/inventory/ai/extract
Content-Type: multipart/form-data

Fields:
  file            — image (jpg/png/webp) or PDF
  organizationId  — required
  storeId         — optional
  supplierId      — optional (pre-selected supplier)

Response:
{
  "data": {
    "draftId": "uuid",
    "status": "pending_review",
    "supplier": { "name": "Fresh Foods Co", "confidence": 0.92 },
    "invoiceNumber": "INV-10042",
    "invoiceDate": "2026-06-12",
    "overallConfidence": 0.88,
    "lines": [
      {
        "aiExtractedText": "Botella agua 500ml",
        "productId": "uuid",
        "productName": "Water Bottle",
        "sku": "DEMO-WATER",
        "quantity": 144,
        "unitCostCents": 42,
        "matchStatus": "matched",
        "confidence": 0.94
      },
      {
        "aiExtractedText": "jugo manzana 355ml",
        "productId": null,
        "productName": null,
        "quantity": 24,
        "unitCostCents": 85,
        "matchStatus": "unmatched",
        "confidence": 0.61
      }
    ]
  }
}
```

---

## 7. Implementation Phases

### Phase 1 — Inventory List UX Redesign (Frontend)
**Estimated effort:** 3–4 days

Deliverables:
- Replace flat DataTable with status-grouped list + right detail panel
- Inline quick-adjust controls (+10 / freeform / -10) in the panel
- Inline reorder threshold edit
- Visual stock bar per row
- Low-stock items sorted to top automatically
- Remove the awkward top-mounted adjustment form
- Retain CSV import (keep working, move button to header)

Files touched:
- `web/app/inventory/InventoryClient.tsx` — full rewrite
- No backend changes needed for Phase 1

### Phase 2 — Backend: Suppliers, Invoices, Transfers (Data Engineer)
**Estimated effort:** 3–4 days

Deliverables:
- Migration: 4 new tables (suppliers, invoices, invoice_lines, transfers)
- `POST /v1/inventory/suppliers`, `PATCH`, `GET`
- `POST /v1/inventory/invoices` (manual), `GET`, `POST /:id/approve`
  - Approve writes `commerce_inventory_movements` and upserts `commerce_inventory_items`
- `POST /v1/inventory/transfers`, `GET`
- All routes use existing auth pattern (`requirePermission("inventory:write")`)

Files touched:
- New migration `030_inventory_receiving.sql`
- `api/src/modules/inventory/inventory.routes.js` — add new route handlers

### Phase 3 — AI Extraction Engine (AI Engineer)
**Estimated effort:** 4–5 days

Deliverables:
- `POST /v1/inventory/ai/extract` — accepts multipart upload
  - Images: send base64 to Claude claude-haiku-4-5 vision with structured extraction prompt
  - PDFs: use `pdf-parse` to extract text, send as text to Claude
  - Returns structured JSON with line items and confidence scores
- Correction table read on every extraction (inject as few-shot examples)
- Product matching: exact SKU → correction table → pg_trgm similarity
- Draft saved to `commerce_inventory_ai_drafts`
- `POST /v1/inventory/ai/corrections` — called when manager accepts/corrects a line
- Cost tracking: token usage stored in draft row (same pattern as AI module)

New dependencies:
- `pdf-parse` — already available or add to api/package.json
- `pg_trgm` PostgreSQL extension — enable in migration

Files touched:
- New `api/src/modules/inventory/inventoryAI.routes.js`
- New migration `031_inventory_ai.sql` (ai_drafts + corrections tables)
- `api/src/routes.js` — mount new router

### Phase 4 — Receive Stock UI (Frontend + AI Engineer)
**Estimated effort:** 4–5 days

Deliverables:
- New "Receive Stock" slide-over/modal replacing the ReceivingClient page
- Step 1: Choose intake method (photo upload / PDF or CSV / manual)
- Step 2 (AI path): Upload drop zone with progress indicator while AI processes
- Step 3: Review table — editable qty/cost cells, product match dropdown for unmatched items, per-line accept/skip
- Save corrections automatically on Accept (call `/ai/corrections`)
- Step 4: Approve → invoice created → stock updated
- Manual path: form with supplier, invoice #, line item rows (add/remove)

### Phase 5 — Corrections Dashboard + Learning Visibility (Frontend)
**Estimated effort:** 2 days

Deliverables:
- Tab in Reports or Settings: "AI Inventory Corrections"
- Table: extracted text | matched to | times confirmed | last used
- Delete button to remove wrong mappings
- Shows accuracy improvement over time

---

## 8. Claude Extraction Prompt

```
System:
You are an inventory receiving assistant for a cafeteria POS system.
Extract all product line items from the attached supplier invoice or receipt.

Return a JSON object with this exact shape:
{
  "supplier": { "name": string | null, "confidence": number },
  "invoiceNumber": string | null,
  "invoiceDate": "YYYY-MM-DD" | null,
  "lines": [
    {
      "extractedText": string,   // exactly what the document says
      "quantity": number,
      "unitCost": number,        // in decimal (e.g. 2.10 for $2.10)
      "sku": string | null,      // if visible on the document
      "confidence": number       // 0.0 to 1.0
    }
  ]
}

PAST CORRECTIONS FOR THIS ORGANIZATION (use these to improve matching):
{corrections_block}

Rules:
- Never invent quantities or costs. If unreadable, set to null.
- confidence reflects how clearly the value was readable from the document.
- Do not merge line items. One object per invoice line.
- If a field is missing from the document, return null for that field.
```

---

## 9. AI Auto-Approval Feature Flag

### 9A. Decision

Auto-approval is **off by default for every org**. Only platform admins can enable it per org. Platform admins can kill it instantly at any time. The org cannot turn it on themselves — it must be granted.

### 9B. How It Fits the Existing System

The `features` JSONB column on `commerce_organizations` already powers this pattern (guardians, fee_assignments, student_integration, payroll). We add one new key:

```json
{
  "ai_auto_approve_receiving": false
}
```

Toggled via the existing `PATCH /v1/organizations/:id/features` endpoint — the same one used for all other feature flags. Only `platform_admin` / `super_admin` can call it.

### 9C. What Auto-Approval Actually Does

When `ai_auto_approve_receiving` is `true` for an org, the extract endpoint applies stricter rules and, if all pass, skips the review step and commits stock directly:

```
Upload received
      │
      ▼
AI extracts line items
      │
      ▼
   ┌──────────────────────────────────────┐
   │  Auto-approval gate (ALL must pass)  │
   │                                      │
   │  ✓ Overall confidence >= 0.94        │
   │  ✓ Every line is product-matched     │
   │  ✓ No line has a cost variance >15%  │
   │  ✓ Invoice total <= daily spend cap  │
   │  ✓ Supplier is in the org's list     │
   └──────────────────────────────────────┘
         │               │
       PASS            FAIL (any single rule)
         │               │
         ▼               ▼
   Stock updated    Falls back to
   automatically    normal review
   (invoice status  screen — manager
   = 'auto_approved') must confirm
```

If any single rule fails, it falls back to the normal review flow. Auto-approval is never "full trust" — it has a hard gate.

### 9D. Safety Guardrails

| Guardrail | Default | Configurable? |
|---|---|---|
| Minimum confidence threshold | 0.94 | No — hardcoded floor |
| All lines must be matched | Required | No override |
| Cost variance flag blocks auto-approve | >15% above 90d avg | Yes, per org |
| Daily auto-approval spend cap | $500 USD | Yes, per org (stored in features JSON) |
| Unrecognized supplier blocks | Yes | Yes, per org |
| Max line items per invoice | 50 | No — larger invoices always manual |

The daily spend cap means: if this org has already auto-approved $480 in invoices today, a new $100 invoice will fall to manual review even if all other rules pass.

### 9E. Feature Flag Schema in `features` JSONB

```json
{
  "ai_auto_approve_receiving": true,
  "ai_auto_approve_confidence_floor": 0.94,
  "ai_auto_approve_daily_cap_cents": 50000,
  "ai_auto_approve_cost_variance_pct": 15
}
```

All keys except the boolean default to the system hardcoded values if absent. The boolean is the master switch.

### 9F. Audit Trail — Auto-Approvals Are Fully Logged

Even when auto-approved, the system writes:
- An `commerce_inventory_invoices` row with `status = 'auto_approved'` and `approved_by = NULL` (system)
- An `commerce_inventory_movements` row for each line with `source = 'ai_auto_approve'`
- An entry in `commerce_audit_events` with `action = 'inventory.ai_auto_approved'`, listing every line item, quantities, costs, and the confidence score that triggered it

The manager gets a notification (email or in-app) summarizing what was auto-approved — they are never in the dark.

### 9G. Platform Admin Kill Switch

To disable auto-approval for a single org immediately:
```
PATCH /v1/organizations/:id/features
{ "ai_auto_approve_receiving": false }
```

To kill it platform-wide (emergency), one SQL command:
```sql
UPDATE commerce_organizations
SET features = features - 'ai_auto_approve_receiving'
WHERE features->>'ai_auto_approve_receiving' = 'true';
```

This is the "haywire" button. One query, all orgs revert to manual review.

### 9H. UI — Where Managers See the Toggle

In the org's **Settings** page (admin+), a read-only indicator shows whether auto-approval is active:

```
┌─────────────────────────────────────────────────┐
│  AI Receiving                                    │
│                                                  │
│  Auto-approval     ● ENABLED (platform granted)  │
│                    Contact support to disable    │
│                                                  │
│  Confidence floor  94% (system minimum)          │
│  Daily spend cap   $500.00                       │
│  Cost variance     15% threshold                 │
└─────────────────────────────────────────────────┘
```

The toggle itself is not in Settings — only platform admins can change it. The org just sees whether it is active. This prevents orgs from enabling it without your knowledge.

---

## 10. Key Design Principles

| Principle | Implementation |
|---|---|
| **AI never changes stock by default** | All extractions go to manager review unless `ai_auto_approve_receiving` is explicitly granted by platform admin. |
| **Auto-approval has a hard gate** | Every guardrail must pass. One failed check → falls back to manual review, no exception. |
| **Platform admin controls the switch** | Orgs cannot self-enable auto-approval. Platform admin grants it, platform admin revokes it. |
| **Kill switch is instant** | One `PATCH /features` call or one SQL statement disables auto-approval for one or all orgs. |
| **Auto-approvals are fully audited** | Same audit trail as manual approvals — invoice row, movement rows, audit event. Manager notified every time. |
| **Corrections are permanent memory** | Every manager correction is stored and re-injected on next extraction for this org. |
| **Confidence is visible** | Manager always sees the confidence score. High confidence is pre-accepted; low confidence forces review. |
| **Incremental intake** | Unmatched lines can be skipped — partial receives are supported. |
| **Graceful degradation** | If AI fails or `ANTHROPIC_API_KEY` is not set, the manual entry path still works. |
| **Cost tracking** | Every AI call logs token + cost to the existing `commerce_ai_records` or draft row. |

---

## 10. Open Questions Before Build

1. **File storage**: Do we upload to Cloudinary (already configured) or store in the DB? Cloudinary preferred — keeps binary out of Postgres. cloudinary sounds better, lets make sure each org has its own folder for this
2. **PDF support scope**: Some supplier PDFs are scanned images inside a PDF. Do we handle this in Phase 3 or defer? Recommendation: Phase 3 handles text PDFs; image-PDF (scanned) in a later sprint. Keep in Phase 3 as you recommend
3. **Correction visibility**: Should corrections be per-org only, or can platform admins seed a global dictionary that all orgs inherit? Recommendation: per-org only for now, global seeds later.
Per Org of for now. 
4. **Supplier matching**: When the AI reads a supplier name, should we match it against the suppliers table, or always make the manager confirm? Recommendation: auto-match at ≥ 0.90 similarity, manual confirm below that.
Your recommendation is fine
5. **Batch size**: A typical invoice has 5–30 line items. Claude Haiku can handle this in a single call. No batching needed. Good. 

Note: This should always be confirmed from the manager. All approvals require a manager action — no auto-approval regardless of confidence score.

## 11. Purchase Cost Tracking — Decision: YES

Every approved invoice line stores `unit_cost_cents` + `quantity` + `invoice_date`. This unlocks:

### 11A. Purchasing Reports (new tab in /reports)
- **Spend by period**: daily / weekly / bi-weekly / monthly / custom range
- **Spend by supplier**: which supplier accounts for what % of COGS
- **Spend by product/category**: where the food budget actually goes
- **Period-over-period comparison**: this week vs. last week, this month vs. last month

Query shape (already possible with planned schema):
```sql
SELECT
  DATE_TRUNC('week', i.invoice_date)    AS period,
  s.name                                 AS supplier,
  il.product_name,
  SUM(il.quantity * il.unit_cost_cents)  AS total_cost_cents,
  SUM(il.quantity)                       AS units_received
FROM commerce_inventory_invoice_lines il
JOIN commerce_inventory_invoices i ON i.id = il.invoice_id
LEFT JOIN commerce_inventory_suppliers s ON s.id = i.supplier_id
WHERE il.organization_id = $1
  AND i.status = 'approved'
  AND i.invoice_date BETWEEN $2 AND $3
GROUP BY 1, 2, 3
ORDER BY 1 DESC, total_cost_cents DESC
```

### 11B. Price History on Inventory Detail Panel
Right panel (when a product row is selected) shows last 5 receiving events:

```
Price history — Water Bottle
─────────────────────────────────────
Jun 12  144 units  $0.42/unit  Fresh Foods
May 28  120 units  $0.42/unit  Fresh Foods
May 10   96 units  $0.40/unit  Fresh Foods
Apr 22  144 units  $0.40/unit  Fresh Foods
────────────────────────────────────
Avg cost (90d): $0.41   ↑ 2.4% vs prior 90d
```

This is a simple query on `commerce_inventory_invoice_lines` filtered by `product_id`.

### 11C. Cost Variance Flag in AI Review Step
During the AI review table, if the extracted `unit_cost_cents` for a product is more than **15% above or below** the 90-day average for that product, highlight the cell:

```
│ "Botella Agua 500ml" │ Water Bottle │ 144 │ ⚠ $0.52  │ [Accept] │
│                      │              │     │ +23% vs avg $0.42    │
```

This catches supplier price increases before the manager approves them — before they silently erode margins.

Threshold is configurable per org (default 15%). Flag is informational — manager can still accept.

### 11D. Gross Margin Closure
The receiving side (`unit_cost_cents` on invoice lines) feeds into the same COGS column already on `commerce_products`. When a receiving invoice is approved, optionally update `commerce_products.cost_cents` to the latest received unit cost. This keeps the margin column on the inventory list accurate without manual entry.

Implementation: on invoice approval, for each line where `product_id` is matched and the new cost differs from current `cost_cents`, update it and write an audit log entry noting the previous and new cost.

### 11E. What This Requires
- `commerce_inventory_invoice_lines` already has `unit_cost_cents` ✓ (in planned schema)
- New API endpoint: `GET /v1/reports/purchasing?organizationId=&dateFrom=&dateTo=&groupBy=`
- New tab "Purchasing" in `/reports` — period selector + spend table + supplier breakdown
- Price history query wired into the inventory detail panel (Phase 1 backend add)
- Cost variance calculation on draft approval endpoint (Phase 3)
