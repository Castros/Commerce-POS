export function StatusBadge({ value }: { value: string }) {
  const lower = value.toLowerCase();

  const tone =
    lower === "out" ||
    lower.includes("out of stock") ||
    lower.includes("refund") ||
    lower.includes("void") ||
    lower.includes("error")
      ? "danger"
      : lower.includes("low") ||
          lower.includes("limited") ||
          lower.includes("pending")
        ? "warning"
        : lower.includes("not tracked") ||
            lower.includes("untracked") ||
            lower.includes("inactive")
          ? "muted"
          : "success";

  return <span className={`badge ${tone}`}>{value}</span>;
}
