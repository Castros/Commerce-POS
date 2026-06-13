"use client";

import { StatusBadge } from "../components/StatusBadge";
import type { Product } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { inventoryLabel, productInitials } from "./registerUtils";

const TILE_COLORS = [
  { bg: "#dbeafe", fg: "#1d4ed8" },
  { bg: "#dcfce7", fg: "#166534" },
  { bg: "#ede9fe", fg: "#5b21b6" },
  { bg: "#ffedd5", fg: "#c2410c" },
  { bg: "#cffafe", fg: "#0e7490" },
  { bg: "#fce7f3", fg: "#9d174d" },
  { bg: "#fef9c3", fg: "#a16207" },
  { bg: "#d1fae5", fg: "#065f46" },
];

function tileColorIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h % TILE_COLORS.length;
}

type ProductCatalogProps = {
  products: Product[];
  productSearch: string;
  selectedCategory: string;
  categories: string[];
  cartQuantities: Record<string, number>;
  onSearchChange: (value: string) => void;
  onCategoryChange: (category: string) => void;
  onProductSelect: (product: Product) => void;
  onQuantityChange: (productId: string, delta: number) => void;
};

export function ProductCatalog({
  products,
  productSearch,
  selectedCategory,
  categories,
  cartQuantities,
  onSearchChange,
  onCategoryChange,
  onProductSelect,
  onQuantityChange
}: ProductCatalogProps) {
  return (
    <div className="productPane">
      <div className="toolbar">
        <input
          placeholder="Scan barcode or search products"
          value={productSearch}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <button type="button">Scan</button>
        <button type="button" disabled title="Cashier cannot edit inventory">
          Edit inventory locked
        </button>
      </div>
      <div className="categoryTabs" aria-label="Product categories">
        {categories.map((category) => (
          <button
            type="button"
            key={category}
            className={category === selectedCategory ? "active" : ""}
            onClick={() => onCategoryChange(category)}
          >
            {category}
          </button>
        ))}
      </div>
      <div className="productGrid">
        {products.length === 0 ? <p className="emptyState">No products match this search.</p> : null}
        {products.map((product) => {
          const qty = cartQuantities[product.id] ?? 0;
          const palette = TILE_COLORS[tileColorIndex(product.id)];
          return (
            <div
              key={product.id}
              className={`productTileWrap${qty > 0 ? " productTileWrap--inCart" : ""}`}
            >
              <button
                className="productTile"
                type="button"
                onClick={() => onProductSelect(product)}
                disabled={product.inventoryStatus === "out"}
              >
                <span
                  className="productImageFrame"
                  aria-hidden="true"
                  style={{ background: palette.bg }}
                >
                  <span className="productImageFallback" style={{ color: palette.fg }}>
                    {productInitials(product)}
                  </span>
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt=""
                      loading="lazy"
                      onError={(event) => { event.currentTarget.style.display = "none"; }}
                    />
                  ) : null}
                </span>
                <span className="productTileInfo">
                  <strong>{product.name}</strong>
                  <span className="productTilePrice">{formatMoney(product.priceCents)}</span>
                  <StatusBadge value={inventoryLabel(product)} />
                </span>
              </button>
              {qty > 0 && (
                <div className="productTileQtyBar">
                  <button
                    type="button"
                    className="productQtyBtn"
                    aria-label={`Remove one ${product.name}`}
                    onClick={() => onQuantityChange(product.id, -1)}
                  >−</button>
                  <span>{qty}</span>
                  <button
                    type="button"
                    className="productQtyBtn productQtyBtn--add"
                    aria-label={`Add one more ${product.name}`}
                    onClick={() => onQuantityChange(product.id, 1)}
                  >+</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
