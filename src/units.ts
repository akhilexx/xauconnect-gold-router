// Exact decimal <-> base-unit conversion without floating point.

export function toBaseUnits(amount: string, decimals: number): string {
  const s = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount: ${amount}`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`amount ${amount} has more than ${decimals} decimals`);
  const raw = (whole + frac.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  return BigInt(raw).toString();
}

export function fromBaseUnits(raw: string, decimals: number): string {
  const v = BigInt(raw).toString().padStart(decimals + 1, "0");
  const whole = v.slice(0, v.length - decimals);
  const frac = v.slice(v.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
