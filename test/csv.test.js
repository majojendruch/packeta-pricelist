import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../src/export/csv.js';

const pl = {
  source: { validFrom: '2026-09-01' },
  services: [{
    id: 'home:DE:13613', mode: 'HOME', destination: 'DE', carrierName: 'Doručenie, na adresu', carrierIds: [13613], variant: null,
    currency: 'EUR', leadTimeDays: { min: 2, max: 2 }, suspended: false, limits: { maxWeightKg: 15 },
    cod: { available: true, max: { amount: 700, currency: 'EUR' } }, insurance: { max: null },
    tiers: [{ maxKg: 1, variant: null, price: { depot: 6.92, zpoint: 7.32 } }],
  }],
};

test('one row per tier, comma CSV quotes cells containing commas', () => {
  const lines = toCsv(pl).trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^home:DE:13613,HOME,DE,"Doručenie, na adresu",13613,,1,,6.92,7.32,EUR/);
});

test('Excel flavour uses ";" and decimal commas', () => {
  const row = toCsv(pl, { delimiter: ';' }).trim().split('\r\n')[1];
  assert.match(row, /;6,92;7,32;EUR;/);
});
