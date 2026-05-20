"use client";

import type { DemoStudent, Receipt } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import type { CartLine, PaymentMethod } from "./types";
import { ReceiptPreview } from "./ReceiptPreview";
import { toCents } from "./registerUtils";

type CartPanelProps = {
  cart: CartLine[];
  receipt: Receipt | null;
  selectedStudent: DemoStudent | null;
  selectedBalanceCents: number;
  walletStatus: string;
  creditExceededCents: number;
  subtotalCents: number;
  paymentMethod: PaymentMethod;
  selling: boolean;
  completeDisabled: boolean;
  checkoutMessage: string | null;
  completeHelp: string;
  onQuantityChange: (productId: string, delta: number) => void;
  onPaymentMethodChange: (paymentMethod: PaymentMethod) => void;
  onCompleteSale: () => void;
};

export function CartPanel({
  cart,
  receipt,
  selectedStudent,
  selectedBalanceCents,
  walletStatus,
  creditExceededCents,
  subtotalCents,
  paymentMethod,
  selling,
  completeDisabled,
  checkoutMessage,
  completeHelp,
  onQuantityChange,
  onPaymentMethodChange,
  onCompleteSale
}: CartPanelProps) {
  return (
    <>
      <div className="studentCard">
        <span>Selected student</span>
        <h3>{selectedStudent?.name || "No student selected"}</h3>
        {selectedStudent ? (
          <strong className={selectedBalanceCents < 0 ? "negativeBalance" : "positiveBalance"}>
            {selectedBalanceCents > 0 ? "+" : ""}
            {formatMoney(selectedBalanceCents)}
          </strong>
        ) : null}
        {selectedStudent && walletStatus === "Blocked" ? (
          <p className="walletWarning">Blocked: over credit limit by {formatMoney(creditExceededCents)}.</p>
        ) : null}
      </div>

      <div className="cartLines">
        {cart.length === 0 ? <p className="emptyState">Add products to start a sale.</p> : null}
        {cart.map((line) => (
          <div className="cartLine" key={line.product.id}>
            <div>
              <strong>{line.product.name}</strong>
              <span>{formatMoney(line.product.priceCents)} each</span>
            </div>
            <div className="quantityStepper">
              <button type="button" onClick={() => onQuantityChange(line.product.id, -1)}>
                -
              </button>
              <span>{line.quantity}</span>
              <button type="button" onClick={() => onQuantityChange(line.product.id, 1)}>
                +
              </button>
            </div>
            <strong>{formatMoney(toCents(line.product.priceCents) * line.quantity)}</strong>
          </div>
        ))}
      </div>

      <div className="totals">
        <span>Subtotal <strong>{formatMoney(subtotalCents)}</strong></span>
        <span>Tax <strong>{formatMoney(0)}</strong></span>
        <span>Discount <strong>{formatMoney(0)}</strong></span>
        <span className="grandTotal">Total <strong>{formatMoney(subtotalCents)}</strong></span>
      </div>

      <div className="paymentMethods">
        <button
          type="button"
          aria-pressed={paymentMethod === "cash"}
          className={paymentMethod === "cash" ? "active" : ""}
          onClick={() => onPaymentMethodChange("cash")}
        >
          Cash
        </button>
        <button
          type="button"
          aria-pressed={paymentMethod === "card"}
          className={paymentMethod === "card" ? "active" : ""}
          onClick={() => onPaymentMethodChange("card")}
        >
          Credit
        </button>
        <button
          type="button"
          aria-pressed={paymentMethod === "wallet"}
          className={paymentMethod === "wallet" ? "active" : ""}
          onClick={() => onPaymentMethodChange("wallet")}
        >
          Wallet
        </button>
        <button type="button" disabled>Split later</button>
      </div>

      <button
        className="primaryAction"
        type="button"
        disabled={completeDisabled}
        onClick={onCompleteSale}
      >
        {paymentMethod === "wallet" && creditExceededCents > 0
          ? "Credit limit exceeded"
          : selling
            ? "Completing..."
            : `Complete ${paymentMethod} sale`}
      </button>
      {(checkoutMessage || completeHelp) ? (
        <p className={checkoutMessage?.startsWith("Sale completed") ? "buttonHelp success" : "buttonHelp"}>
          {checkoutMessage || completeHelp}
        </p>
      ) : null}

      <ReceiptPreview receipt={receipt} />
    </>
  );
}

