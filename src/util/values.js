// Small, strict parsers for the value formats that appear in the price lists.
// Each returns null when the text is not that kind of value, so callers can probe.

const CURRENCY_SYMBOLS = { '€': 'EUR', 'Kč': 'CZK', 'Kc': 'CZK', 'zł': 'PLN', 'Ft': 'HUF', 'lei': 'RON' };
const CODE = '(?:EUR|CZK|HUF|PLN|RON|BGN|DKK|SEK|GBP|USD|CHF|UAH|RUB|AED|ILS|TRY)';
const SYMBOL = '(?:€|Kč|Kc)';
const NUMBER = '\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})*(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?';

const moneyRe = new RegExp(
  `^(?:(?<pre>${CODE}|${SYMBOL})\\s*)?(?<num>${NUMBER})\\s*(?<post>${CODE}|${SYMBOL})?$`,
);

/** "4,20 €" | "1 400 BGN" | "CZK 89.00" | "89,00 Kč" -> { amount, currency } */
export function parseMoney(text) {
  const m = moneyRe.exec(String(text ?? '').trim());
  if (!m || (!m.groups.pre && !m.groups.post)) return null;
  const unit = m.groups.pre ?? m.groups.post;
  return { amount: toNumber(m.groups.num), currency: CURRENCY_SYMBOLS[unit] ?? unit };
}

/** "1,20 %" -> 1.2 */
export function parsePct(text) {
  const m = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(String(text ?? '').trim());
  return m ? toNumber(m[1]) : null;
}

/** "15 kg" | "do 15 kg" -> 15 */
export function parseKg(text) {
  const m = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*kg\b/i.exec(String(text ?? ''));
  return m ? toNumber(m[1]) : null;
}

/** "120 cm" -> 120 (only a single length, not dimensions) */
export function parseCm(text) {
  const m = /^(?:do\s+)?(\d+(?:[.,]\d+)?)\s*cm\b/i.exec(String(text ?? '').trim());
  return m ? toNumber(m[1]) : null;
}

/** "10 × 7 × 1 cm" | "61 x 44 x 8 cm" -> [10, 7, 1] */
export function parseDims(text) {
  const m = /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*cm/i.exec(String(text ?? ''));
  return m ? [toNumber(m[1]), toNumber(m[2]), toNumber(m[3])] : null;
}

/** "1 400" | "4,20" | "89.00" -> number */
export function toNumber(s) {
  const clean = String(s).replace(/[\s  ]/g, '').replace(',', '.');
  const n = Number(clean);
  if (!Number.isFinite(n)) throw new Error(`Not a number: "${s}"`);
  return n;
}

/** Rounds money to cents without floating-point noise. */
export const cents = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
