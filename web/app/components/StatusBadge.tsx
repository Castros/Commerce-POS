export function StatusBadge({ value }: { value: string }) {
  const tone =
    value.toLowerCase().includes("low") ||
    value.toLowerCase().includes("limited") ||
    value.toLowerCase().includes("pending")
      ? "warning"
      : value.toLowerCase().includes("refund") ||
          value.toLowerCase().includes("void") ||
          value.toLowerCase().includes("error")
        ? "danger"
        : "success";

  return <span className={`badge ${tone}`}>{value}</span>;
}
