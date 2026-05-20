export function formatMoney(cents: number | string | null | undefined) {
  const value = typeof cents === "string" ? Number(cents) : cents || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value / 100);
}

export function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}
