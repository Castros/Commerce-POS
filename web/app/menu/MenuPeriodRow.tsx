"use client";

import type { Product, PeriodEntry } from "./menuTypes";
import { fmt } from "./menuTypes";

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={onChange}
      className={`mpaToggle${on ? " mpaToggle--on" : ""}`}
      title={on ? "Publicado" : "Borrador"}
    >
      <span className="mpaToggleKnob" />
    </button>
  );
}

type Props = {
  period: PeriodEntry;
  canRemove: boolean;
  isAdding: boolean;
  productSearch: string;
  filteredProducts: Product[];
  onRemovePeriod: () => void;
  onRemoveItem: (productId: string) => void;
  onStartAdding: () => void;
  onStopAdding: () => void;
  onSearchChange: (q: string) => void;
  onAddItem: (product: Product) => void;
  onTogglePublish: () => void;
};

export default function MenuPeriodRow({
  period, canRemove, isAdding, productSearch, filteredProducts,
  onRemovePeriod, onRemoveItem, onStartAdding, onStopAdding,
  onSearchChange, onAddItem, onTogglePublish,
}: Props) {
  return (
    <div className="mpaPeriodRow">
      <span className="mpaPeriodLabel">
        {period.mealPeriod}
        {canRemove && (
          <button className="mpaPeriodRemove" title={`Eliminar turno ${period.mealPeriod}`} onClick={onRemovePeriod}>
            <span className="material-symbols-outlined">close</span>
          </button>
        )}
      </span>

      <div className="mpaPeriodChips">
        {period.items.length === 0 && !isAdding && (
          <span className="mpaChipsEmpty">Sin platillos…</span>
        )}
        {period.items.map((item) => (
          <span key={item.productId} className="mpaChip">
            {item.name}
            <span className="mpaChipPrice">{fmt(item.priceCents)}</span>
            <button className="mpaChipRemove" onClick={() => onRemoveItem(item.productId)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </span>
        ))}

        {isAdding ? (
          <div className="mpaAddItemWrap">
            <input
              autoFocus
              className="mpaAddItemInput"
              placeholder="Buscar platillo…"
              value={productSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && onStopAdding()}
              onBlur={(e) => {
                const wrap = e.currentTarget.closest(".mpaAddItemWrap");
                setTimeout(() => {
                  if (!wrap?.contains(document.activeElement)) onStopAdding();
                }, 150);
              }}
            />
            {filteredProducts.length > 0 && (
              <div className="mpaProductDrop">
                {filteredProducts.map((p) => (
                  <button key={p.id} className="mpaProductOpt" onMouseDown={() => onAddItem(p)}>
                    <span>{p.name}</span>
                    <span className="mpaProductOptPrice">{fmt(p.priceCents)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button className="mpaAddItemBtn" onClick={onStartAdding}>
            <span className="material-symbols-outlined">add</span>
            Agregar
          </button>
        )}
      </div>

      <div className="mpaPeriodRight">
        <span className={`mpaPublishLabel${period.published ? " mpaPublishLabel--on" : ""}`}>
          {period.published ? "PUBLICADO" : "BORRADOR"}
        </span>
        <Toggle on={period.published} onChange={onTogglePublish} />
      </div>
    </div>
  );
}
