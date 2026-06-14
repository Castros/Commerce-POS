"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getPendingSaleCount,
  getPendingSales,
  markSaleFailed,
  markSaleSynced,
  retryFailedSales,
} from "../lib/offlineDb";
import { useOnlineStatus } from "../lib/useOnlineStatus";

export function OfflineQueue() {
  const isOnline = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      setPendingCount(await getPendingSaleCount());
    } catch {
      // IndexedDB may not be available in all contexts
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    // Poll for new queued sales while offline
    const interval = setInterval(refreshCount, 5000);
    return () => clearInterval(interval);
  }, [refreshCount]);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);

    let synced = 0;
    let failed = 0;

    try {
      await retryFailedSales();
      const sales = await getPendingSales();

      for (const sale of sales) {
        try {
          const res = await fetch("/api/v1/orders/paid-sale", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": sale.idempotencyKey,
            },
            credentials: "include",
            body: JSON.stringify({
              organizationId: sale.organizationId,
              storeId: sale.storeId,
              customerId: sale.customerId,
              paymentMethod: sale.paymentMethod,
              registerName: sale.registerName,
              items: sale.items,
            }),
          });

          if (res.ok || res.status === 409) {
            // 409 = idempotent replay — already processed
            await markSaleSynced(sale.id);
            synced++;
          } else {
            const body = await res.json().catch(() => ({}));
            await markSaleFailed(sale.id, body.error ?? `HTTP ${res.status}`);
            failed++;
          }
        } catch {
          await markSaleFailed(sale.id, "Network error during sync");
          failed++;
        }
      }

      setSyncResult({ synced, failed });
      await refreshCount();
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshCount]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      void syncNow();
    }
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isOnline && pendingCount === 0 && !syncResult) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      {!isOnline && (
        <div
          style={{
            background: "#1e293b",
            color: "#fff",
            padding: "8px 18px",
            borderRadius: 999,
            fontSize: "0.82rem",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            pointerEvents: "auto",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#f59e0b",
              display: "inline-block",
            }}
          />
          Offline
          {pendingCount > 0 && (
            <span style={{ background: "#f59e0b", color: "#1e293b", borderRadius: 999, padding: "1px 7px", fontSize: "0.75rem" }}>
              {pendingCount} pending
            </span>
          )}
        </div>
      )}

      {isOnline && pendingCount > 0 && (
        <div
          style={{
            background: "#2563eb",
            color: "#fff",
            padding: "8px 18px",
            borderRadius: 999,
            fontSize: "0.82rem",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            pointerEvents: "auto",
          }}
        >
          {syncing ? (
            <>Syncing {pendingCount} sale{pendingCount !== 1 ? "s" : ""}…</>
          ) : (
            <>
              {pendingCount} unsync{pendingCount !== 1 ? "ed" : "ed"} sale{pendingCount !== 1 ? "s" : ""}
              <button
                type="button"
                onClick={syncNow}
                style={{
                  background: "rgba(255,255,255,0.2)",
                  border: "none",
                  borderRadius: 999,
                  color: "#fff",
                  cursor: "pointer",
                  padding: "2px 10px",
                  fontSize: "0.78rem",
                }}
              >
                Sync now
              </button>
            </>
          )}
        </div>
      )}

      {syncResult && (
        <div
          style={{
            background: syncResult.failed > 0 ? "#dc2626" : "#16a34a",
            color: "#fff",
            padding: "8px 18px",
            borderRadius: 999,
            fontSize: "0.82rem",
            fontWeight: 600,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            pointerEvents: "auto",
            cursor: "pointer",
          }}
          onClick={() => setSyncResult(null)}
        >
          {syncResult.synced > 0 && `✓ ${syncResult.synced} sale${syncResult.synced !== 1 ? "s" : ""} synced`}
          {syncResult.failed > 0 && ` · ${syncResult.failed} failed`}
        </div>
      )}
    </div>
  );
}
