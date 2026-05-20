# Commerce POS API Endpoint Reference

This document lists the current Commerce POS HTTP endpoints, what each endpoint does, the authorization required, example curl commands, and how to use the API from Postman.

Local base URLs:

```text
API root: http://localhost:4100
API v1:   http://localhost:4100/v1
```

## Authorization

All `/v1/*` endpoints pass through API authentication.

In local development, when `NODE_ENV !== "production"`, the API accepts a development actor fallback. That means local curl and Postman requests can work without an `Authorization` header unless you are testing production-like auth.

In production, send a bearer token:

```http
Authorization: Bearer <COMMERCE_API_TOKEN>
```

The environment token configured as `COMMERCE_API_TOKEN` is treated as a `service` actor. Database-backed service tokens are also supported when their SHA-256 token hash exists in `commerce_service_tokens` and the token is active.

Useful local development actor headers:

```http
x-actor-role: service
x-actor-service: postman
x-organization-id: <organization-id>
```

Role permissions currently used by endpoints:

| Role | Permissions |
| --- | --- |
| `platform_admin` | all |
| `organization_owner` | all |
| `organization_admin` | `organizations:write`, `stores:write`, `products:write`, `customers:write`, `wallets:write`, `orders:write`, `reports:read` |
| `store_manager` | `products:write`, `customers:write`, `wallets:write`, `orders:write`, `reports:read` |
| `cashier` | `customers:write`, `wallets:topup`, `orders:write` |
| `accountant` | `wallets:write`, `orders:read`, `reports:read` |
| `parent` | `orders:read` |
| `customer` | `orders:read` |
| `service` | `organizations:write`, `stores:write`, `products:write`, `customers:write`, `wallets:write`, `wallets:topup`, `orders:write`, `reports:read` |

Important notes:

- Success responses use `{ "data": ... }`.
- Error responses use `{ "error": "message" }`.
- Money values are integer cents, for example `550` means `$5.50`.
- Money-moving order endpoints require `Idempotency-Key`.
- Tenant-owned reads and writes require `organizationId` in the query string or JSON body.
- Wallet balances can go negative only up to the configured wallet `creditLimitCents`.
- A negative wallet balance means the customer/student owes money.

## Postman Setup

Create a Postman environment with these variables:

| Variable | Example value |
| --- | --- |
| `baseUrl` | `http://localhost:4100` |
| `apiBaseUrl` | `http://localhost:4100/v1` |
| `commerceApiToken` | `your-local-or-production-token` |
| `organizationId` | set after creating or seeding an organization |
| `storeId` | set after creating or seeding a store |
| `productId` | set after creating or seeding a product |
| `customerId` | set after creating or seeding a customer |
| `walletId` | set after creating or seeding a wallet |
| `orderId` | set after creating an order |

For production-like requests in Postman:

1. Open the collection or request.
2. Go to `Authorization`.
3. Set `Type` to `Bearer Token`.
4. Set `Token` to `{{commerceApiToken}}`.

For JSON requests:

1. Go to `Headers`.
2. Add `Content-Type: application/json`.
3. For money-moving order requests, add `Idempotency-Key: {{$guid}}` or a stable unique value.
4. Go to `Body`.
5. Select `raw`.
6. Select `JSON`.
7. Paste the request body from the examples below.

For local development without bearer auth, you can omit the Authorization tab and optionally add:

```http
x-actor-role: service
x-actor-service: postman
```

## Common Curl Variables

The curl examples below use shell variables. Replace IDs with values returned by earlier requests.

```bash
BASE_URL="http://localhost:4100"
API_BASE_URL="$BASE_URL/v1"
TOKEN="replace-with-commerce-api-token"
ORG_ID="replace-with-organization-id"
STORE_ID="replace-with-store-id"
PRODUCT_ID="replace-with-product-id"
CUSTOMER_ID="replace-with-customer-id"
WALLET_ID="replace-with-wallet-id"
ORDER_ID="replace-with-order-id"
```

Production-style authenticated calls add:

```bash
-H "Authorization: Bearer $TOKEN"
```

Local development calls can omit that header.

## Service Endpoints

### GET /

Description: Returns basic API service status. This endpoint is not under `/v1` and does not require authentication.

Authorization: None.

Postman: Create a `GET` request to `{{baseUrl}}/`. No body is required.

```bash
curl -s "$BASE_URL/"
```

### GET /health

Description: Returns API process health. This does not check database readiness.

Authorization: None.

Postman: Create a `GET` request to `{{baseUrl}}/health`. No body is required.

```bash
curl -s "$BASE_URL/health"
```

### GET /ready

Description: Runs a simple database query and returns readiness status.

Authorization: None.

Postman: Create a `GET` request to `{{baseUrl}}/ready`. No body is required.

```bash
curl -s "$BASE_URL/ready"
```

## Organizations

### GET /v1/organizations

Description: Lists organizations ordered by newest first.

Authorization: Authenticated `/v1` request. No specific permission middleware is applied.

Postman: `GET {{apiBaseUrl}}/organizations`

```bash
curl -s "$API_BASE_URL/organizations" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /v1/organizations

Description: Creates an organization.

Authorization: Requires `organizations:write`.

Body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Organization name |
| `type` | string | no | `school`, `restaurant`, `retail_business`, `nonprofit`, or `other`; defaults to `school` |
| `externalSchoolId` | UUID or null | no | Optional Student Educational app school ID |

Postman: `POST {{apiBaseUrl}}/organizations`, JSON body:

```json
{
  "name": "Pilot School",
  "type": "school"
}
```

```bash
curl -s -X POST "$API_BASE_URL/organizations" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Pilot School","type":"school"}'
```

## Stores

### GET /v1/stores

Description: Lists stores for an organization.

Authorization: Authenticated `/v1` request. No specific permission middleware is applied.

Query parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `organizationId` | yes | Tenant organization UUID |

Postman: `GET {{apiBaseUrl}}/stores?organizationId={{organizationId}}`

```bash
curl -s "$API_BASE_URL/stores?organizationId=$ORG_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /v1/stores

Description: Creates a store inside an organization.

Authorization: Requires `stores:write`.

Body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `organizationId` | UUID | yes | Tenant organization |
| `name` | string | yes | Store name |
| `type` | string | no | `cafeteria`, `uniform_shop`, `bookstore`, `school_supplies`, `restaurant`, `retail`, `event_sales`, or `other`; defaults to `cafeteria` |
| `externalSchoolId` | UUID or null | no | Optional Student Educational app school ID |

Postman: `POST {{apiBaseUrl}}/stores`, JSON body:

```json
{
  "organizationId": "{{organizationId}}",
  "name": "Cafeteria",
  "type": "cafeteria"
}
```

```bash
curl -s -X POST "$API_BASE_URL/stores" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationId\":\"$ORG_ID\",\"name\":\"Cafeteria\",\"type\":\"cafeteria\"}"
```

## Products

### GET /v1/products

Description: Lists active products for an organization. If `storeId` is provided, the response includes products assigned to that store and global products where `storeId` is null.

Authorization: Authenticated `/v1` request. No specific permission middleware is applied.

Query parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `organizationId` | yes | Tenant organization UUID |
| `storeId` | no | Optional store UUID |

Postman: `GET {{apiBaseUrl}}/products?organizationId={{organizationId}}&storeId={{storeId}}`

```bash
curl -s "$API_BASE_URL/products?organizationId=$ORG_ID&storeId=$STORE_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /v1/products

Description: Creates a product.

Authorization: Requires `products:write`.

Body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `organizationId` | UUID | yes | Tenant organization |
| `storeId` | UUID or null | no | Store-specific product; null means global |
| `categoryId` | UUID or null | no | Optional category |
| `name` | string | yes | Product name |
| `description` | string or null | no | Product description |
| `sku` | string or null | no | Product SKU |
| `priceCents` | integer | yes | Unit price in cents |
| `taxable` | boolean | no | Defaults to false |

Postman: `POST {{apiBaseUrl}}/products`, JSON body:

```json
{
  "organizationId": "{{organizationId}}",
  "storeId": "{{storeId}}",
  "name": "Lunch Combo",
  "sku": "LUNCH-1",
  "priceCents": 550,
  "taxable": false
}
```

```bash
curl -s -X POST "$API_BASE_URL/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationId\":\"$ORG_ID\",\"storeId\":\"$STORE_ID\",\"name\":\"Lunch Combo\",\"sku\":\"LUNCH-1\",\"priceCents\":550,\"taxable\":false}"
```

## Customers

### GET /v1/customers

Description: Lists customers for an organization.

Authorization: Authenticated `/v1` request. No specific permission middleware is applied.

Query parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `organizationId` | yes | Tenant organization UUID |

Postman: `GET {{apiBaseUrl}}/customers?organizationId={{organizationId}}`

```bash
curl -s "$API_BASE_URL/customers?organizationId=$ORG_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /v1/customers

Description: Creates a customer, or updates an existing customer when `externalId` conflicts for the same organization.

Authorization: Requires `customers:write`.

Body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `organizationId` | UUID | yes | Tenant organization |
| `externalStudentId` | UUID or null | no | Student Educational app student UUID |
| `externalParentId` | UUID or null | no | Student Educational app parent UUID |
| `externalId` | string or null | no | External/matricula ID |
| `name` | string | yes | Customer name |
| `email` | email or null | no | Customer or parent email |
| `phone` | string or null | no | Phone number |

Postman: `POST {{apiBaseUrl}}/customers`, JSON body:

```json
{
  "organizationId": "{{organizationId}}",
  "externalId": "A-1042",
  "name": "Test Student",
  "email": "parent@example.test"
}
```

```bash
curl -s -X POST "$API_BASE_URL/customers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationId\":\"$ORG_ID\",\"externalId\":\"A-1042\",\"name\":\"Test Student\",\"email\":\"parent@example.test\"}"
```

## Wallets

### GET /v1/wallets

Description: Lists wallet accounts for an organization. Can be narrowed to one customer.

Authorization: Authenticated `/v1` request. No specific permission middleware is applied.

Query parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `organizationId` | yes | Tenant organization UUID |
| `customerId` | no | Optional customer UUID |

Postman: `GET {{apiBaseUrl}}/wallets?organizationId={{organizationId}}&customerId={{customerId}}`

```bash
curl -s "$API_BASE_URL/wallets?organizationId=$ORG_ID&customerId=$CUSTOMER_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /v1/wallets

Description: Creates or returns a customer wallet account. If a wallet already exists for the same organization, customer, and currency, it is reused and the credit limit can only increase.

Authorization: Requires `wallets:write`.

Body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `organizationId` | UUID | yes | Tenant organization |
| `customerId` | UUID | yes | Customer UUID |
| `creditLimitCents` | integer | no | Defaults to 0 |

Postman: `POST {{apiBaseUrl}}/wallets`, JSON body:

```json
{
  "organizationId": "{{organizationId}}",
  "customerId": "{{customerId}}",
  "creditLimitCents": 2500
}
```

```bash
curl -s -X POST "$API_BASE_URL/wallets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationId\":\"$ORG_ID\",\"customerId\":\"$CUSTOMER_ID\",\"creditLimitCents\":2500}"
```

### GET /v1/wallets/:id/transactions

Description: Lists immutable wallet ledger transactions for a wallet.

Authorization: Authenticated `/v1` request. No specific permission middleware is applied.

Path parameters:

| Parameter | Notes |
| --- | --- |
| `id` | Wallet account UUID |

Query parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `organizationId` | yes | Tenant organization UUID |

Postman: `GET {{apiBaseUrl}}/wallets/{{walletId}}/transactions?organizationId={{organizationId}}`

```bash
curl -s "$API_BASE_URL/wallets/$WALLET_ID/transactions?organizationId=$ORG_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /v1/wallets/:id/topups

Description: Adds value to a wallet and writes an audit event in the same database transaction.

Authorization: Requires `wallets:topup`.

Path parameters:

| Parameter | Notes |
| --- | --- |
| `id` | Wallet account UUID |

Body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `organizationId` | UUID | yes | Tenant organization |
| `amountCents` | positive integer | yes | Top-up amount in cents |
| `note` | string or null | no | Ledger note |

Postman: `POST {{apiBaseUrl}}/wallets/{{walletId}}/topups`, JSON body:

```json
{
  "organizationId": "{{organizationId}}",
  "amountCents": 1000,
  "note": "Initial test balance"
}
```

```bash
curl -s -X POST "$API_BASE_URL/wallets/$WALLET_ID/topups" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationId\":\"$ORG_ID\",\"amountCents\":1000,\"note\":\"Initial test balance\"}"
```

## Orders

### GET /v1/orders

Description: Lists recent orders for an organization. Can be filtered by store or customer.

Authorization: Authenticated `/v1` request. No specific permission middleware is applied.

Query parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `organizationId` | yes | Tenant organization UUID |
| `storeId` | no | Optional store UUID |
| `customerId` | no | Optional customer UUID |
| `limit` | no | 1 to 100; defaults to 25 |

Postman: `GET {{apiBaseUrl}}/orders?organizationId={{organizationId}}&limit=25`

```bash
curl -s "$API_BASE_URL/orders?organizationId=$ORG_ID&limit=25" \
  -H "Authorization: Bearer $TOKEN"
```

### GET /v1/orders/:id

Description: Returns an order detail with line items.

Authorization: Authenticated `/v1` request. No specific permission middleware is applied.

Path parameters:

| Parameter | Notes |
| --- | --- |
| `id` | Order UUID |

Query parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `organizationId` | yes | Tenant organization UUID |

Postman: `GET {{apiBaseUrl}}/orders/{{orderId}}?organizationId={{organizationId}}`

```bash
curl -s "$API_BASE_URL/orders/$ORDER_ID?organizationId=$ORG_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /v1/orders/paid-sale

Description: Creates a paid order for cash or card. The API creates the order, line items, payment, idempotency record, and audit event in one database transaction. This is currently a recorded paid sale; do not use it as a real card-processing flow without a payment provider integration and signature verification.

Note: The working model refers to this as a cash or credit sale. The current API request value for a credit/card sale is `card`; the route schema does not currently accept `credit`.

Authorization: Requires `orders:write`.

Required headers:

```http
Content-Type: application/json
Idempotency-Key: <unique-key-for-this-sale>
```

Body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `organizationId` | UUID | yes | Tenant organization |
| `storeId` | UUID | yes | Store UUID |
| `customerId` | UUID or null | no | Optional customer UUID |
| `paymentMethod` | string | yes | `cash` or `card` |
| `items` | array | yes | One or more line items |
| `items[].productId` | UUID | yes | Product UUID |
| `items[].quantity` | positive integer | yes | Quantity |

Postman: `POST {{apiBaseUrl}}/orders/paid-sale`, add `Idempotency-Key: {{$guid}}`, JSON body:

```json
{
  "organizationId": "{{organizationId}}",
  "storeId": "{{storeId}}",
  "customerId": "{{customerId}}",
  "paymentMethod": "cash",
  "items": [
    {
      "productId": "{{productId}}",
      "quantity": 1
    }
  ]
}
```

```bash
curl -s -X POST "$API_BASE_URL/orders/paid-sale" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: paid-sale-001" \
  -d "{\"organizationId\":\"$ORG_ID\",\"storeId\":\"$STORE_ID\",\"customerId\":\"$CUSTOMER_ID\",\"paymentMethod\":\"cash\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}]}"
```

### POST /v1/orders/wallet-sale

Description: Creates an atomic wallet sale. The API verifies the wallet, store, and products; calculates totals server-side; charges the wallet; writes the immutable wallet ledger transaction; creates the payment and order records; stores the idempotent response; and writes an audit event in one database transaction. Wallet balances may go negative only within the wallet credit limit.

Authorization: Requires `orders:write`.

Required headers:

```http
Content-Type: application/json
Idempotency-Key: <unique-key-for-this-sale>
```

Body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `organizationId` | UUID | yes | Tenant organization |
| `storeId` | UUID | yes | Store UUID |
| `customerId` | UUID | yes | Customer UUID |
| `walletAccountId` | UUID | yes | Wallet account UUID for the customer |
| `items` | array | yes | One or more line items |
| `items[].productId` | UUID | yes | Product UUID |
| `items[].quantity` | positive integer | yes | Quantity |

Postman: `POST {{apiBaseUrl}}/orders/wallet-sale`, add `Idempotency-Key: {{$guid}}`, JSON body:

```json
{
  "organizationId": "{{organizationId}}",
  "storeId": "{{storeId}}",
  "customerId": "{{customerId}}",
  "walletAccountId": "{{walletId}}",
  "items": [
    {
      "productId": "{{productId}}",
      "quantity": 1
    }
  ]
}
```

```bash
curl -s -X POST "$API_BASE_URL/orders/wallet-sale" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: wallet-sale-001" \
  -d "{\"organizationId\":\"$ORG_ID\",\"storeId\":\"$STORE_ID\",\"customerId\":\"$CUSTOMER_ID\",\"walletAccountId\":\"$WALLET_ID\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}]}"
```

Idempotency behavior:

- Reusing the same `Idempotency-Key` with the same body returns the stored response without double charging.
- Reusing the same `Idempotency-Key` with a different body returns `409 Conflict`.
- Insufficient wallet funds or credit-limit violations return `402`.
- `balanceCents` may be negative after a sale. A negative balance means the customer/student owes that amount.

## Demo

### GET /v1/demo/school

Description: Loads the demo school data. It creates missing demo organization, cafeteria store, products, students, wallets, and starting balances as needed.

Authorization: Authenticated `/v1` request. No specific permission middleware is applied.

Postman: `GET {{apiBaseUrl}}/demo/school`

```bash
curl -s "$API_BASE_URL/demo/school" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /v1/demo/school

Description: Creates or refreshes the demo school data and returns the organization, store, products, and students.

Authorization: Requires `organizations:write`.

Postman: `POST {{apiBaseUrl}}/demo/school`. No body is required.

```bash
curl -s -X POST "$API_BASE_URL/demo/school" \
  -H "Authorization: Bearer $TOKEN"
```

Demo external school ID:

```text
11111111-1111-4111-8111-111111111111
```

## Student Educational App Integration

These endpoints live under `/v1/integrations/student-app`.

Commerce POS calls the Student Educational app server-side for search and reconciliation. Configure these Commerce POS environment variables when using those features:

```text
SPELLING_APP_API_URL=http://host.docker.internal:4000
SPELLING_APP_SERVICE_TOKEN=<same-secret-as-student-app-INGESTION_SECRET>
```

### GET /v1/integrations/student-app/students/search

Description: Searches Student Educational app students from Commerce POS. The browser or API caller does not receive the Student app service token.

Authorization: Requires `customers:write` in Commerce POS. Also requires `SPELLING_APP_SERVICE_TOKEN` to be configured for the server-side call to the Student Educational app.

Query parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `q` | yes | Search term, student ID, name, or external ID |
| `externalSchoolId` | no | Optional school UUID |
| `schoolId` | no | Optional Student app school UUID; used if present |

Postman: `GET {{apiBaseUrl}}/integrations/student-app/students/search?q=A-1042`

```bash
curl -s "$API_BASE_URL/integrations/student-app/students/search?q=A-1042" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /v1/integrations/student-app/students

Description: Links or creates a Commerce POS customer and wallet for a Student Educational app student. It can also create the connected school organization and cafeteria store if they do not exist.

Authorization: Requires `customers:write`.

Body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `externalSchoolId` | UUID | no | Defaults to demo school ID |
| `externalStudentId` | UUID | yes | Student Educational app student UUID |
| `externalParentId` | UUID or null | no | Student Educational app parent UUID |
| `externalId` | string or null | no | Matricula/external student number |
| `name` | string | no | Defaults to `Linked Student` |
| `email` | email or null | no | Customer or parent email |
| `phone` | string or null | no | Phone number |
| `startingBalanceCents` | integer | no | Starting balance, applied only when the wallet balance is 0 |
| `creditLimitCents` | integer | no | Defaults to 2500 and can increase the wallet credit limit |

Postman: `POST {{apiBaseUrl}}/integrations/student-app/students`, JSON body:

```json
{
  "externalSchoolId": "11111111-1111-4111-8111-111111111111",
  "externalStudentId": "22222222-2222-4222-8222-222222222221",
  "externalParentId": "33333333-3333-4333-8333-333333333331",
  "externalId": "A-1042",
  "name": "Maya Johnson",
  "email": "parent.maya@example.test",
  "startingBalanceCents": 1500,
  "creditLimitCents": 2500
}
```

```bash
curl -s -X POST "$API_BASE_URL/integrations/student-app/students" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"externalSchoolId":"11111111-1111-4111-8111-111111111111","externalStudentId":"22222222-2222-4222-8222-222222222221","externalParentId":"33333333-3333-4333-8333-333333333331","externalId":"A-1042","name":"Maya Johnson","email":"parent.maya@example.test","startingBalanceCents":1500,"creditLimitCents":2500}'
```

### POST /v1/integrations/student-app/reconcile

Description: Bulk-links standalone Commerce POS customers to Student Educational app students by matching `external_id`/matricula. Use this after a school connects the Student Educational app to an existing POS setup.

Authorization: Requires `customers:write` in Commerce POS. Also requires `SPELLING_APP_SERVICE_TOKEN` to be configured for server-side Student app searches.

Body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `externalSchoolId` | UUID | no | Defaults to demo school ID |

Postman: `POST {{apiBaseUrl}}/integrations/student-app/reconcile`, JSON body:

```json
{
  "externalSchoolId": "11111111-1111-4111-8111-111111111111"
}
```

```bash
curl -s -X POST "$API_BASE_URL/integrations/student-app/reconcile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"externalSchoolId":"11111111-1111-4111-8111-111111111111"}'
```

### GET /v1/integrations/student-app/students/:externalStudentId/cafeteria

Description: Returns the cafeteria wallet shape used by the Student Educational app: signed balance, credit limit, amount owed, and recent cafeteria transactions. If the student is not linked, the API returns a zero balance and empty transaction list.

Balance behavior: A positive `balance` means money is available. A negative `balance` means the student owes money. The response also includes `credit_limit` and `amount_owed`.

Authorization: Authenticated `/v1` request. No specific permission middleware is applied.

Path parameters:

| Parameter | Notes |
| --- | --- |
| `externalStudentId` | Student Educational app student UUID |

Query parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `externalSchoolId` | no | Defaults to demo school ID |

Postman: `GET {{apiBaseUrl}}/integrations/student-app/students/{{externalStudentId}}/cafeteria?externalSchoolId=11111111-1111-4111-8111-111111111111`

```bash
EXTERNAL_STUDENT_ID="22222222-2222-4222-8222-222222222221"

curl -s "$API_BASE_URL/integrations/student-app/students/$EXTERNAL_STUDENT_ID/cafeteria?externalSchoolId=11111111-1111-4111-8111-111111111111" \
  -H "Authorization: Bearer $TOKEN"
```

## Suggested First Test Flow

Use this sequence when testing in Postman or curl:

1. `POST /v1/demo/school`
2. Save returned `organization.id` as `organizationId`.
3. Save returned `store.id` as `storeId`.
4. Save one returned `products[0].id` as `productId`.
5. Save one returned `students[0].id` as `customerId`.
6. Save that student's `wallet.id` as `walletId`.
7. Call `POST /v1/orders/wallet-sale` with a new `Idempotency-Key`.
8. Call `GET /v1/orders?organizationId={{organizationId}}`.
9. Call `GET /v1/wallets/{{walletId}}/transactions?organizationId={{organizationId}}`.
