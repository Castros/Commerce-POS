# API Modules

Business logic should stay grouped by module:

- `organizations`
- `stores`
- `products`
- `inventory`
- `customers`
- `wallets`
- `orders`
- `payments`
- `receipts`
- `reports`
- `integrations`

Money-moving modules must use explicit database transactions and idempotency keys.

