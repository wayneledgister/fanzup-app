/** Integer cents → "$1,234.56" (USD only at M1; FR-PLT-003 locale formatting is P1). */
export function formatUsd(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
