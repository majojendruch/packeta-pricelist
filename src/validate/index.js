// Quality gate: a price list is only published when every error-level check passes.
// Errors = the data is wrong or parsing broke. Warnings = worth a human look, but publishable.

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../../schema/${name}`, import.meta.url), 'utf8'));
const schema = read('pricelist.schema.json');
const sliceSchema = read('slice.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(schema);
const validateSchema = ajv.compile(schema);
const validateSliceSchema = ajv.compile(sliceSchema);

/** Checks a per-country slice (sk/home/DE.json) against the slice format. */
export function validateSlice(slice) {
  const errors = validateSliceSchema(slice) ? [] : validateSliceSchema.errors.map((e) => `schema: ${e.instancePath || '/'} ${e.message}`);
  return { valid: errors.length === 0, errors, warnings: [] };
}

// Losing more than 10 % AND more than 2 services in one mode usually means the parser broke.
// Smaller losses are real (Packeta dropped the HU Z-BOX between 2/2026 and 9/2026) and show in the change report.
const MAX_SERVICE_DROP = 0.1;
const MAX_SERVICES_LOST = 2;

/**
 * @param {object} priceList
 * @param {{ previous?: object }} [options] previous published version, to catch parsing regressions
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePriceList(priceList, { previous } = {}) {
  const errors = [];
  const warnings = [...(priceList.warnings ?? [])];

  if (!validateSchema(priceList)) {
    for (const e of validateSchema.errors.slice(0, 50)) errors.push(`schema: ${e.instancePath || '/'} ${e.message}`);
  }
  if (!priceList.source?.validFrom) errors.push('valid-from date not found');

  const ids = new Set();
  for (const s of priceList.services ?? []) {
    if (ids.has(s.id)) errors.push(`duplicate service id ${s.id}`);
    ids.add(s.id);
    checkTiers(s, errors);
    if (!s.leadTimeDays) warnings.push(`${s.id}: no delivery time`);
    if (!s.limits?.maxWeightKg) warnings.push(`${s.id}: no max weight`);
    const topKg = Math.max(...s.tiers.map((t) => t.maxKg));
    if (s.limits?.maxWeightKg && topKg > s.limits.maxWeightKg) warnings.push(`${s.id}: price tier ${topKg} kg above max weight ${s.limits.maxWeightKg} kg`);
  }

  const counts = countByMode(priceList);
  for (const mode of ['PACKETA_PICKUP_POINT', 'HOME', 'PARTNER_PICKUP_POINT']) {
    if (!counts[mode]) errors.push(`no services found for ${mode}`);
  }
  if (!priceList.returns?.prices?.length) errors.push('no return prices found');
  if (!priceList.surcharges?.toll) errors.push('toll surcharge not found');
  if (!priceList.surcharges?.fuel?.dieselTable?.length) errors.push('fuel surcharge table not found');
  if (!priceList.fees?.length) errors.push('no general fees found');

  if (previous) {
    const before = countByMode(previous);
    for (const [mode, n] of Object.entries(before)) {
      const now = counts[mode] ?? 0;
      if (now < n * (1 - MAX_SERVICE_DROP) && n - now > MAX_SERVICES_LOST) errors.push(`${mode}: ${now} services, previous version had ${n} (possible parsing failure)`);
    }
    if (previous.source?.validFrom && priceList.source?.validFrom < previous.source.validFrom) {
      errors.push(`valid-from ${priceList.source.validFrom} is older than the published ${previous.source.validFrom}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function checkTiers(s, errors) {
  const byVariant = Map.groupBy(s.tiers, (t) => t.variant ?? '');
  for (const [variant, tiers] of byVariant) {
    const where = `${s.id}${variant ? ` [${variant}]` : ''}`;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const prev = tiers[i - 1];
      if (t.price.zpoint !== undefined && t.price.zpoint < t.price.depot) errors.push(`${where}: Z-POINT price below depot price at ${t.maxKg} kg`);
      if (!prev) continue;
      if (t.maxKg <= prev.maxKg) errors.push(`${where}: weight tiers out of order (${prev.maxKg} → ${t.maxKg} kg)`);
      if (t.price.depot < prev.price.depot) errors.push(`${where}: price drops from ${prev.price.depot} to ${t.price.depot} at ${t.maxKg} kg`);
    }
  }
}

function countByMode(pl) {
  const counts = {};
  for (const s of pl.services ?? []) counts[s.mode] = (counts[s.mode] ?? 0) + 1;
  return counts;
}
