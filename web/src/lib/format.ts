/**
 * INR display formatting. Formatting only — amounts come from the API as
 * exact decimal strings and are never recomputed client-side.
 */
export function formatINR(amount: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return amount;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(n);
}
