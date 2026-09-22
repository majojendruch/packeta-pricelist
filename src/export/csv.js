// Flat CSV: one row per service × weight tier — the shape a shop needs for a rate table.

const COLUMNS = [
  'service_id', 'mode', 'destination', 'carrier', 'carrier_ids', 'variant', 'max_kg', 'tier_variant',
  'price_depot', 'price_zpoint', 'currency', 'lead_days_min', 'lead_days_max', 'cod_available', 'cod_max',
  'insurance_max', 'max_weight_kg', 'suspended', 'valid_from',
];

/**
 * @param {object} priceList
 * @param {{ delimiter?: string }} [options] use ";" for Excel with a comma-decimal locale (SK, CZ, DE, ...)
 */
export function toCsv(priceList, { delimiter = ',' } = {}) {
  const money = (m) => (m ? `${m.amount} ${m.currency}` : '');
  const rows = [COLUMNS];
  for (const s of priceList.services) {
    for (const t of s.tiers) {
      rows.push([
        s.id, s.mode, s.destination, s.carrierName, s.carrierIds.join(' '), s.variant ?? '', t.maxKg, t.variant ?? '',
        t.price.depot, t.price.zpoint ?? '', s.currency, s.leadTimeDays?.min ?? '', s.leadTimeDays?.max ?? '',
        s.cod.available, money(s.cod.max), money(s.insurance.max), s.limits.maxWeightKg ?? '', s.suspended,
        priceList.source.validFrom,
      ]);
    }
  }
  // With ";" we target comma-decimal Excel locales, so numbers get a decimal comma too.
  const cell = (v) => (delimiter === ';' && typeof v === 'number' ? String(v).replace('.', ',') : v);
  return rows.map((r) => r.map((v) => quote(cell(v), delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}

function quote(value, delimiter) {
  const s = String(value);
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
