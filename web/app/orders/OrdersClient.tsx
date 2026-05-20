"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, apiPost } from "../lib/api";
import type { DemoSchoolData, OrderDetail, OrderSummary, RefundReceipt } from "../lib/demoTypes";
import { formatMoney, shortId } from "../lib/format";

export function OrdersClient() {
  const [demo, setDemo] = useState<DemoSchoolData | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadOrders() {
    try {
      setError(null);
      const data = demo || (await apiPost<DemoSchoolData>("/demo/school", {}));
      setDemo(data);
      const orderData = await apiGet<OrderSummary[]>(
        `/orders?organizationId=${data.organization.id}&limit=25`
      );
      setOrders(orderData);
      if (!selectedOrderId && orderData[0]) {
        setSelectedOrderId(orderData[0].id);
        void loadOrderDetail(orderData[0].id, data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load orders");
    }
  }

  async function loadOrderDetail(orderId: string, existingDemo = demo) {
    const schoolData = existingDemo || (await apiPost<DemoSchoolData>("/demo/school", {}));
    if (!existingDemo) setDemo(schoolData);
    setLoadingDetail(true);
    setError(null);
    try {
      const detail = await apiGet<OrderDetail>(
        `/orders/${orderId}?organizationId=${schoolData.organization.id}`
      );
      setSelectedOrderId(orderId);
      setSelectedOrder(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load receipt");
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    void loadOrders();
  }, []);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return orders;
    return orders.filter((order) =>
      [
        order.id,
        order.customerName || "Guest",
        order.storeName,
        order.paymentMethod || "",
        order.paymentStatus
      ].some((value) => value.toLowerCase().includes(query))
    );
  }, [orders, search]);

  const activeRowIndex = filteredOrders.findIndex((order) => order.id === selectedOrderId);

  function createIdempotencyKey() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `refund-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function refundSelectedOrder() {
    if (!demo || !selectedOrder) return;
    setRefunding(true);
    setError(null);
    setMessage(null);
    try {
      const refund = await apiPost<RefundReceipt>(
        `/orders/${selectedOrder.order.id}/refund`,
        {
          organizationId: demo.organization.id,
          reason: "Cashier demo refund"
        },
        { "Idempotency-Key": createIdempotencyKey() }
      );
      setMessage(`Refunded ${formatMoney(refund.payment.amountCents)} by ${refund.payment.method}.`);
      await loadOrders();
      await loadOrderDetail(selectedOrder.order.id, demo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refund order");
    } finally {
      setRefunding(false);
    }
  }

  return (
    <section className="module">
      <PageHeader eyebrow="Receipts" title="Sales / Orders">
        <button type="button" onClick={loadOrders}>Refresh</button>
      </PageHeader>
      {error ? <p className="demoError">{error}</p> : null}
      {message ? <p className="buttonHelp success">{message}</p> : null}
      <div className="toolbar">
        <input
          placeholder="Search receipt, student, payment"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button">Today</button>
        <button type="button">Paid</button>
        <button type="button">Refunds later</button>
      </div>
      <div className="splitPanel">
        <div>
          <DataTable
            headers={["Receipt", "Student", "Store", "Amount", "Payment", "Status", "Created"]}
            rows={filteredOrders.map((order) => [
              shortId(order.id),
              order.customerName || "Guest",
              order.storeName,
              formatMoney(order.totalCents),
              order.paymentMethod || "unknown",
              order.paymentStatus,
              new Date(order.createdAt).toLocaleString()
            ])}
            statusIndex={5}
            onRowClick={(index) => {
              const order = filteredOrders[index];
              if (order) void loadOrderDetail(order.id);
            }}
            activeRowIndex={activeRowIndex >= 0 ? activeRowIndex : undefined}
          />
        </div>
        <aside className="detailPanel receiptDetail">
          <span>Receipt detail</span>
          <h3>{selectedOrder ? shortId(selectedOrder.order.id) : "Select an order"}</h3>
          {loadingDetail ? <p>Loading receipt...</p> : null}
          {selectedOrder ? (
            <>
              <div className="receiptHeader">
                <div>
                  <small>Customer</small>
                  <strong>{selectedOrder.order.customerName || "Guest"}</strong>
                </div>
                <StatusBadge value={selectedOrder.order.paymentStatus} />
              </div>
              <dl>
                <div><dt>Store</dt><dd>{selectedOrder.order.storeName}</dd></div>
                <div><dt>Payment</dt><dd>{selectedOrder.order.paymentMethod || "unknown"}</dd></div>
                <div><dt>Created</dt><dd>{new Date(selectedOrder.order.createdAt).toLocaleString()}</dd></div>
              </dl>

              <div className="receiptLines">
                {selectedOrder.items.map((item) => (
                  <div key={item.id}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.quantity} x {formatMoney(item.unitPriceCents)}</small>
                    </span>
                    <strong>{formatMoney(item.lineTotalCents)}</strong>
                  </div>
                ))}
              </div>

              <div className="totals receiptTotals">
                <span>Subtotal <strong>{formatMoney(selectedOrder.order.subtotalCents)}</strong></span>
                <span>Tax <strong>{formatMoney(selectedOrder.order.taxCents)}</strong></span>
                <span>Discount <strong>{formatMoney(selectedOrder.order.discountCents)}</strong></span>
                <span className="grandTotal">Total <strong>{formatMoney(selectedOrder.order.totalCents)}</strong></span>
              </div>

              {selectedOrder.wallet ? (
                <div className="receiptImpact">
                  <span>Wallet impact</span>
                  <strong>{formatMoney(selectedOrder.wallet.amountCents)}</strong>
                  <small>Balance after sale: {formatMoney(selectedOrder.wallet.balanceAfterCents)}</small>
                </div>
              ) : null}

              {selectedOrder.inventory.length > 0 ? (
                <div className="receiptImpact">
                  <span>Inventory impact</span>
                  {selectedOrder.inventory.map((movement) => (
                    <small key={`${movement.productId}-${movement.createdAt}`}>
                      {movement.productName}: {movement.quantityDelta} sold, {movement.quantityAfter} left
                    </small>
                  ))}
                </div>
              ) : null}

              <div className="receiptActions">
                <button type="button" className="primaryAction" onClick={() => window.print()}>
                  View / reprint receipt
                </button>
                <button
                  type="button"
                  disabled={refunding || selectedOrder.order.status !== "paid"}
                  onClick={refundSelectedOrder}
                >
                  {refunding ? "Refunding..." : "Refund order"}
                </button>
              </div>
            </>
          ) : (
            <p>Select an order from the table to view line items, payment, wallet, and inventory impact.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
