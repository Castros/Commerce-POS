import type { Receipt } from "../lib/demoTypes";
import { formatMoney, shortId } from "../lib/format";

export function ReceiptPreview({ receipt }: { receipt: Receipt | null }) {
  if (!receipt) return null;

  return (
    <div className="receiptBox" role="status">
      <span>Receipt {shortId(receipt.order.id)}</span>
      <strong>{formatMoney(receipt.order.totalCents)}</strong>
      <small>
        Paid by {receipt.payment.method}.
        {receipt.wallet
          ? ` New balance ${formatMoney(receipt.wallet.balanceCents)}. Student app sync updated.`
          : " Inventory sale recorded."}
      </small>
    </div>
  );
}

