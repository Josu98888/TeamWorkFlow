/**
 * Display formatting of a decimal string amount in ARS ("121000.00" -> "$ 121.000,00").
 * String based on purpose: money is never converted to a float (billing AGENTS.md, money rules).
 */
export function formatMoney(amount: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) return amount;
  const [, sign, integer, fraction = ''] = match;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$ ${grouped},${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/** True when `value` is a decimal amount the backend accepts ("1500", "1500.5", "1500.50"). */
export const isDecimalAmount = (value: string) => /^\d+(\.\d{1,2})?$/.test(value.trim());
