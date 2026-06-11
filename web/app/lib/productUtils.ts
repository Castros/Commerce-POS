import type { Product } from "./demoTypes";

export function productCategory(product: Product): string {
  if (product.categoryName) return product.categoryName;

  const name = product.name.toLowerCase();
  const sku = (product.sku || "").toLowerCase();

  if (
    name.includes("lunch") ||
    name.includes("breakfast") ||
    sku.includes("lunch") ||
    sku.includes("breakfast")
  ) return "Meals";
  if (name.includes("water") || name.includes("milk") || name.includes("juice")) return "Drinks";
  if (name.includes("uniform") || name.includes("polo")) return "Uniforms";
  if (name.includes("book") || name.includes("workbook")) return "Books";
  if (name.includes("ticket") || name.includes("fee") || name.includes("trip")) return "Fees";
  return "Other";
}
