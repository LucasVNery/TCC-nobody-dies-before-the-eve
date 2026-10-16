// pt-BR number formatting without Intl. Absent values render as '—'. Pure.

export const DASH = '—';

/** Decimal comma, no thousands separator; null/NaN/±Infinity -> '—'. */
export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const s = n.toFixed(digits);
  return (s === `-${(0).toFixed(digits)}` ? s.slice(1) : s).replace('.', ',');
}

export function fmtMs(n: number | null | undefined): string {
  const s = fmtNum(n, 0);
  return s === DASH ? s : `${s} ms`;
}

/** fraction 0.5 -> '50%'. */
export function fmtPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return DASH;
  return `${fmtNum(fraction * 100, 0)}%`;
}

export function fmtSample(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return `n=${fmtNum(n, 0)}`;
}
