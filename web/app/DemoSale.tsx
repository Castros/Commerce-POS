"use client";

import { useState } from "react";

type DemoResult = {
  orderId: string;
  totalCents: number;
  balanceCents: number;
};

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload.data as T;
}

export function DemoSale() {
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runDemoSale() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const org = await post<{ id: string }>("/organizations", {
        name: `Demo School ${Date.now()}`,
        type: "school"
      });
      const store = await post<{ id: string }>("/stores", {
        organizationId: org.id,
        name: "Cafeteria",
        type: "cafeteria"
      });
      const product = await post<{ id: string }>("/products", {
        organizationId: org.id,
        storeId: store.id,
        name: "Lunch Combo",
        sku: `LUNCH-${Date.now()}`,
        priceCents: 550
      });
      const customer = await post<{ id: string }>("/customers", {
        organizationId: org.id,
        name: "Demo Student"
      });
      const wallet = await post<{ id: string }>("/wallets", {
        organizationId: org.id,
        customerId: customer.id
      });

      await post(`/wallets/${wallet.id}/topups`, {
        organizationId: org.id,
        amountCents: 1000,
        note: "Demo balance"
      });

      const sale = await post<{
        order: { id: string; totalCents: number };
        wallet: { balanceCents: number };
      }>(
        "/orders/wallet-sale",
        {
          organizationId: org.id,
          storeId: store.id,
          customerId: customer.id,
          walletAccountId: wallet.id,
          items: [{ productId: product.id, quantity: 1 }]
        },
        { "Idempotency-Key": crypto.randomUUID() }
      );

      setResult({
        orderId: sale.order.id,
        totalCents: sale.order.totalCents,
        balanceCents: sale.wallet.balanceCents
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="demoPanel">
      <div>
        <h2>Wallet Sale Demo</h2>
        <p>
          Creates a demo school, cafeteria, product, customer, wallet, top-up,
          and paid order through the live API.
        </p>
      </div>
      <button type="button" onClick={runDemoSale} disabled={loading}>
        {loading ? "Running..." : "Run Demo Sale"}
      </button>
      {result ? (
        <div className="demoResult" role="status">
          <span>Order {result.orderId.slice(0, 8)}</span>
          <span>Total ${(result.totalCents / 100).toFixed(2)}</span>
          <span>Wallet ${(result.balanceCents / 100).toFixed(2)}</span>
        </div>
      ) : null}
      {error ? (
        <p className="demoError" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

