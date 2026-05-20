"use client";

import { StatusBadge } from "../components/StatusBadge";
import type { Product } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { inventoryLabel, productCategory, productInitials } from "./registerUtils";

type ProductCatalogProps = {
  products: Product[];
  productSearch: string;
  selectedCategory: string;
  categories: string[];
  onSearchChange: (value: string) => void;
  onCategoryChange: (category: string) => void;
  onProductSelect: (product: Product) => void;
};

export function ProductCatalog({
  products,
  productSearch,
  selectedCategory,
  categories,
  onSearchChange,
  onCategoryChange,
  onProductSelect
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
        {products.map((product) => (
          <button
            className="productTile"
            type="button"
            key={product.id}
            onClick={() => onProductSelect(product)}
            disabled={product.inventoryStatus === "out"}
          >
            <span className="productImageFrame" aria-hidden="true">
              <span className="productImageFallback">{productInitials(product)}</span>
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : null}
            </span>
            <span className="productTileText">
              <strong>{product.name}</strong>
              <small>{productCategory(product)}</small>
            </span>
            <span className="productTileMeta">
              <strong>{formatMoney(product.priceCents)}</strong>
              <StatusBadge value={inventoryLabel(product)} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

