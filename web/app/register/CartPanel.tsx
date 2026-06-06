"use client";

import Image from "next/image";
import type { DemoStudent, Receipt } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { avatarUrl } from "../lib/imageUrl";
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
      {selectedStudent && (
        <div className="studentCard">
          {selectedStudent.avatarPublicId && (
            <Image
              src={avatarUrl.sm(selectedStudent.avatarPublicId)}
              alt={selectedStudent.name ?? "student"}
              width={48}
              height={48}
              style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
              unoptimized={false}
            />
          )}
          <h3>{selectedStudent.name}</h3>
          <strong className={selectedBalanceCents < 0 ? "negativeBalance" : "positiveBalance"}>
            {selectedBalanceCents > 0 ? "+" : ""}
            {formatMoney(selectedBalanceCents)}
          </strong>
          {walletStatus === "Blocked" && (
            <p className="walletWarning">Over credit limit by {formatMoney(creditExceededCents)}.</p>
          )}
        </div>
      )}

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

