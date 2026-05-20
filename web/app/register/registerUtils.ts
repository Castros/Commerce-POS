import type { Product } from "../lib/demoTypes";
export { productCategory } from "../lib/productUtils";

export function toCents(value: number | string) {
  return typeof value === "string" ? Number(value) : value;
}

export function toQuantity(value: number | string | undefined) {
  return typeof value === "string" ? Number(value) : value ?? null;
}

export function inventoryLabel(product: Product) {
  const quantity = toQuantity(product.quantityOnHand);
  if (product.inventoryStatus === "out") return "Out of stock";
  if (product.inventoryStatus === "low") return quantity === null ? "Low stock" : `Low: ${quantity}`;
  if (quantity !== null) return `Stock: ${quantity}`;
  return product.taxable ? "Taxable" : "Wallet ready";
}

export function productInitials(product: Product) {
  return product.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}
