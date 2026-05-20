import type { Product } from "../lib/demoTypes";

export type CartLine = {
  product: Product;
  quantity: number;
};

export type PaymentMethod = "wallet" | "cash" | "card";

