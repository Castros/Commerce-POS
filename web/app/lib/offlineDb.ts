const DB_NAME = "commerce-pos-offline";
const DB_VERSION = 1;
const SALES_STORE = "pending_sales";

export type OfflineSaleItem = { productId: string; quantity: number };

export type OfflineSale = {
  id: string;
  idempotencyKey: string;
  timestamp: number;
  organizationId: string;
  storeId: string;
  customerId: string | null;
  paymentMethod: "cash" | "card";
  registerName: string;
  items: OfflineSaleItem[];
  totalCents: number;
  status: "pending" | "failed";
  attempts: number;
  errorMessage?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SALES_STORE)) {
        db.createObjectStore(SALES_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueOfflineSale(sale: Omit<OfflineSale, "status" | "attempts">): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SALES_STORE, "readwrite");
    tx.objectStore(SALES_STORE).put({ ...sale, status: "pending", attempts: 0 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingSales(): Promise<OfflineSale[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SALES_STORE, "readonly");
    const req = tx.objectStore(SALES_STORE).getAll();
    req.onsuccess = () => resolve((req.result as OfflineSale[]).filter((s) => s.status === "pending"));
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingSaleCount(): Promise<number> {
  const sales = await getPendingSales();
  return sales.length;
}

export async function markSaleSynced(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SALES_STORE, "readwrite");
    const store = tx.objectStore(SALES_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      store.delete(id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markSaleFailed(id: string, errorMessage: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SALES_STORE, "readwrite");
    const store = tx.objectStore(SALES_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const sale = req.result as OfflineSale;
      if (sale) store.put({ ...sale, status: "failed", attempts: sale.attempts + 1, errorMessage });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function retryFailedSales(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SALES_STORE, "readwrite");
    const store = tx.objectStore(SALES_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      (req.result as OfflineSale[])
        .filter((s) => s.status === "failed")
        .forEach((s) => store.put({ ...s, status: "pending" }));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
