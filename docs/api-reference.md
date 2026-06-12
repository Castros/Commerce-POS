# API Reference

Base URL: `/v1`

All responses follow the envelope format:
- Success: `{ "data": <payload> }`
- Error: `{ "error": "Message" }`

Money values are always integer cents. UUIDs are RFC 4122.

---

## Authentication

### Staff Auth
```
POST /v1/auth/login          { pin, organizationId }
POST /v1/auth/logout
GET  /v1/auth/me
```

### Guardian Portal Auth
```
GET  /v1/guardian-portal/org/:orgId
POST /v1/guardian-portal/auth/request        { email, organizationId }
POST /v1/guardian-portal/auth/verify         { email, code, organizationId }
POST /v1/guardian-portal/auth/accept-invite  { token }
POST /v1/guardian-portal/auth/logout
GET  /v1/guardian-portal/me
PATCH /v1/guardian-portal/me/notifications   { emailOnPurchase, lowBalanceThresholdCents }
GET  /v1/guardian-portal/students/:id/transactions
```

---

## Organizations

```
GET  /v1/organizations                             (super_admin only)
POST /v1/organizations                             (platform_admin / super_admin only)
PATCH /v1/organizations/:id                        includes contact_email, currency, tax settings
```

---

## Stores

```
GET  /v1/stores?organizationId=
POST /v1/stores
```

---

## Products

```
GET   /v1/products?organizationId=&storeId=&includeInactive=true
POST  /v1/products
PATCH /v1/products/:id
```

## Product Categories

```
GET   /v1/product-categories?organizationId=
POST  /v1/product-categories
PATCH /v1/product-categories/:id
```

---

## Customers & Wallets

```
GET  /v1/customers?organizationId=
POST /v1/customers
GET  /v1/wallets/:id?organizationId=
POST /v1/wallets/:id/top-up
```

---

## Guardians

```
GET    /v1/guardians?organizationId=
POST   /v1/guardians
PATCH  /v1/guardians/:id
POST   /v1/guardians/:id/invite
GET    /v1/guardians/:id/students
POST   /v1/guardians/:id/students
DELETE /v1/guardians/:id/students/:studentId
```

---

## Orders

```
POST /v1/orders/wallet-sale           Idempotency-Key required
POST /v1/orders/paid-sale             Idempotency-Key required
POST /v1/orders/:id/refund
POST /v1/orders/:id/partial-refund
GET  /v1/orders?organizationId=
GET  /v1/orders/:id?organizationId=
```

---

## Fee Assignments

```
GET   /v1/fee-assignments?organizationId=&customerId=&status=
POST  /v1/fee-assignments
PATCH /v1/fee-assignments/:id              cancel
POST  /v1/fee-assignments/:id/pay          collect at register (wallet/cash/card)
```

---

## Cash Drawers

```
GET  /v1/cash-drawers?organizationId=
GET  /v1/cash-drawers/current?organizationId=&storeId=&registerName=
POST /v1/cash-drawers/open
POST /v1/cash-drawers/:id/close            triggers AI closeout summary async
```

---

## Inventory

```
GET  /v1/inventory?organizationId=&storeId=
POST /v1/inventory/:productId/adjustments
```

---

## Staff

```
GET  /v1/staff?organizationId=
POST /v1/staff
PATCH /v1/staff/:id
PUT  /v1/staff/:id/stores
GET  /v1/staff/:id/category-permissions
PUT  /v1/staff/:id/category-permissions
```

---

## Student Credentials

```
GET  /v1/student-credentials?organizationId=
POST /v1/student-credentials/issue
POST /v1/student-credentials/resolve
POST /v1/student-credentials/:credentialId/revoke
```

---

## Student App Integration

```
GET  /v1/integrations/student-app/students/search?q=
POST /v1/integrations/student-app/students
GET  /v1/integrations/student-app/students/:externalStudentId/cafeteria
```

---

## Reports

```
GET /v1/reports/summary?organizationId=&dateFrom=&dateTo=&storeId=
```

Response includes: `totals`, `paymentMethods`, `productSales`, `storeSales`, `wallet`, `cashDrawers`.

---

## AI Features

All AI endpoints require `orders:write` permission unless noted.
AI records are scoped by `organization_id` and never modify financial tables.
Cost and token data is only available via `/v1/ai/usage` (platform admin only).

### AI Record Lifecycle
`pending → draft → reviewed` or `dismissed`

### Closeout Summaries
Auto-generated after drawer close. Can also be triggered manually.

```
GET  /v1/ai/summaries?organizationId=&storeId=&status=&limit=
GET  /v1/ai/summaries/:id?organizationId=
POST /v1/ai/summaries
     Body: { organizationId, storeId, sourceRecordId }
PATCH /v1/ai/summaries/:id
     Body: { organizationId, status: "reviewed" | "dismissed" }
```

Output shape (`outputJson`):
```json
{
  "summaryText": "string",
  "keyMetrics": { "grossSalesDollars": "string", ... },
  "topProducts": [{ "name": "string", "unitsSold": number }],
  "flags": [{ "type": "string", "message": "string" }],
  "severity": "low" | "medium" | "high"
}
```

### Anomaly Alerts
On-demand scan against the selected date range. Checks refund patterns, drawer variance, wallet top-up outliers, and inventory shrinkage.

```
GET  /v1/ai/alerts?organizationId=&status=&limit=
GET  /v1/ai/alerts/:id?organizationId=
POST /v1/ai/alerts/scan
     Body: { organizationId, dateFrom?, dateTo? }
     Defaults: last 7 days
PATCH /v1/ai/alerts/:id
     Body: { organizationId, status: "reviewed" | "dismissed" }
```

Output shape (`outputJson`) — array:
```json
[{
  "alertType": "string",
  "headline": "string",
  "body": "string",
  "severity": "low" | "medium" | "high"
}]
```

### Sales Forecast
Analyzes daily sales history for a date range and projects the next 7 days.

```
GET  /v1/ai/forecast?organizationId=&storeId=&status=&limit=
POST /v1/ai/forecast
     Body: { organizationId, storeId?, dateFrom?, dateTo? }
     Defaults: last 30 days
```

Output shape (`outputJson`):
```json
{
  "forecastText": "string",
  "nextWeekEstimateCents": number,
  "trend": "up" | "down" | "stable",
  "confidence": "low" | "medium" | "high",
  "insights": ["string"]
}
```

### Inventory Reorder Recommendations
Analyzes products below reorder threshold or with fewer than 7 days of stock remaining based on 30-day sales velocity.

```
GET  /v1/ai/reorder?organizationId=&storeId=&status=&limit=
POST /v1/ai/reorder
     Body: { organizationId, storeId? }
```

Output shape (`outputJson`):
```json
{
  "summaryText": "string",
  "recommendations": [{
    "productName": "string",
    "storeName": "string",
    "currentStock": number,
    "avgDailySales": number,
    "daysOfStockRemaining": number | null,
    "suggestedOrderQty": number,
    "urgency": "critical" | "high" | "medium"
  }]
}
```

### Guardian Spending Digest
Generates AI-written weekly spending summary emails and sends them to all guardians with `email_on_purchase: true`. Requires `organizations:write` (admin+).

```
POST /v1/ai/guardian-digest
     Body: { organizationId, dateFrom?, dateTo? }
     Defaults: current Mon–now
```

Response:
```json
{ "data": { "sent": number, "skipped": number } }
```

### AI Usage Summary *(platform admin only)*
Returns per-org, per-model token and cost breakdown. Token/cost data is never exposed in other AI endpoints.

```
GET /v1/ai/usage?organizationId=&dateFrom=&dateTo=
```

Response row:
```json
{
  "organizationId": "uuid",
  "organizationName": "string",
  "modelName": "string",
  "sourceType": "string",
  "callCount": number,
  "promptTokens": number,
  "completionTokens": number,
  "costMicrodollars": number,
  "firstCallAt": "iso8601",
  "lastCallAt": "iso8601"
}
```

`costMicrodollars` / 1,000,000 = USD cost.

---

## Demo (local / development only)

```
POST /v1/demo/school
GET  /v1/demo/school
```
