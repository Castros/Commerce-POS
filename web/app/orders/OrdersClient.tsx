"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, apiPost } from "../lib/api";
import type { OrderDetail, OrderSummary, Organization, RefundReceipt } from "../lib/demoTypes";
import { formatMoney, shortId } from "../lib/format";
import { loadCurrentOrganization } from "../lib/organizationContext";

export function OrdersClient() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [partialRefunding, setPartialRefunding] = useState(false);
  const [selectedItemQtys, setSelectedItemQtys] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadOrders() {
    try {
      setError(null);
      const currentOrganization = organization || (await loadCurrentOrganization());
      if (!organization) setOrganization(currentOrganization);
      const orderData = await apiGet<OrderSummary[]>(
        `/orders?organizationId=${currentOrganization.id}&limit=25`
      );
      setOrders(orderData);
      if (!selectedOrderId && orderData[0]) {
        setSelectedOrderId(orderData[0].id);
        void loadOrderDetail(orderData[0].id, currentOrganization);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load orders");
    }
  }

  async function loadOrderDetail(orderId: string, existingOrganization = organization) {
    const currentOrganization = existingOrganization || (await loadCurrentOrganization());
    if (!existingOrganization) setOrganization(currentOrganization);
    setLoadingDetail(true);
    setError(null);
    setSelectedItemQtys({});
    try {
      const detail = await apiGet<OrderDetail>(
        `/orders/${orderId}?organizationId=${currentOrganization.id}`
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
    if (!organization || !selectedOrder) return;
    setRefunding(true);
    setError(null);
    setMessage(null);
    try {
      const refund = await apiPost<RefundReceipt>(
        `/orders/${selectedOrder.order.id}/refund`,
        { organizationId: organization.id, reason: "Cashier refund" },
        { "Idempotency-Key": createIdempotencyKey() }
      );
      setMessage(`Refunded ${formatMoney(refund.payment.amountCents)} by ${refund.payment.method}.`);
      await loadOrders();
      await loadOrderDetail(selectedOrder.order.id, organization);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refund order");
    } finally {
      setRefunding(false);
    }
  }

  function setItemRefundQty(itemId: string, qty: number) {
    setSelectedItemQtys((prev) => ({ ...prev, [itemId]: qty }));
  }

  function partialRefundTotal(): number {
    if (!selectedOrder) return 0;
    return selectedOrder.items.reduce((sum, item) => {
      const qty = selectedItemQtys[item.id] ?? 0;
      return sum + qty * Number(item.unitPriceCents);
    }, 0);
  }

  async function submitPartialRefund() {
    if (!organization || !selectedOrder) return;
    const items = selectedOrder.items
      .filter((item) => (selectedItemQtys[item.id] ?? 0) > 0)
      .map((item) => ({ itemId: item.id, quantity: selectedItemQtys[item.id] }));
    if (items.length === 0) return;
    setPartialRefunding(true);
    setError(null);
    setMessage(null);
    try {
      await apiPost(
        `/orders/${selectedOrder.order.id}/partial-refund`,
        { organizationId: organization.id, items, reason: "Partial refund" },
        { "Idempotency-Key": createIdempotencyKey() }
      );
      setMessage(`Partial refund processed for ${formatMoney(partialRefundTotal())}.`);
      setSelectedItemQtys({});
      await loadOrders();
      await loadOrderDetail(selectedOrder.order.id, organization);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process partial refund");
    } finally {
      setPartialRefunding(false);
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
                {selectedOrder.items.map((item) => {
                  const available = item.quantity - (item.refundedQuantity ?? 0);
                  const refundQty = selectedItemQtys[item.id] ?? 0;
                  const canRefund = ["paid", "partially_refunded"].includes(selectedOrder.order.status) && available > 0;
                  return (
                    <div key={item.id}>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.quantity} x {formatMoney(item.unitPriceCents)}
                          {(item.refundedQuantity ?? 0) > 0
                            ? ` · ${item.refundedQuantity} refunded`
                            : null}
                        </small>
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {canRefund ? (
                          <input
                            type="number"
                            min={0}
                            max={available}
                            value={refundQty || ""}
                            placeholder="0"
                            style={{ width: 52, textAlign: "center" }}
                            onChange={(e) =>
                              setItemRefundQty(item.id, Math.min(available, Math.max(0, parseInt(e.target.value) || 0)))
                            }
                          />
                        ) : null}
                        <strong>{formatMoney(item.lineTotalCents)}</strong>
                      </div>
                    </div>
                  );
                })}
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

              {partialRefundTotal() > 0 ? (
                <div className="receiptImpact">
                  <span>Partial refund</span>
                  <strong>{formatMoney(partialRefundTotal())}</strong>
                  <small>Enter quantities above then confirm</small>
                </div>
              ) : null}

              <div className="receiptActions">
                <button type="button" className="primaryAction" onClick={() => window.print()}>
                  Print receipt
                </button>
                {["paid", "partially_refunded"].includes(selectedOrder.order.status) && partialRefundTotal() > 0 ? (
                  <button
                    type="button"
                    disabled={partialRefunding}
                    onClick={submitPartialRefund}
                  >
                    {partialRefunding ? "Refunding..." : `Refund ${formatMoney(partialRefundTotal())}`}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={refunding || selectedOrder.order.status !== "paid"}
                  onClick={refundSelectedOrder}
                >
                  {refunding ? "Refunding..." : "Refund full order"}
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
