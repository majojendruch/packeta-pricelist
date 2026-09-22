// The SK price list valid from 2026-02-16 uses an older layout: fees and surcharges sit inside
// each delivery section instead of their own chapters. Guards the parser against layout drift.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, validatePriceList } from '../src/index.js';

let pl;
before(async () => {
  pl = await parse(readFileSync(new URL('./fixtures/sk/2026-02-16.pdf', import.meta.url)), { source: 'sk' });
});

test('parses and passes the quality gate', () => {
  assert.equal(pl.source.validFrom, '2026-02-16');
  assert.equal(pl.services.length, 146);
  assert.deepEqual(validatePriceList(pl).errors, []);
});

test('spot values (hand-checked against the PDF)', () => {
  const tier = (id, kg) => pl.services.find((s) => s.id === id).tiers.find((t) => t.maxKg === kg);
  assert.deepEqual(tier('home:GR:8847', 1).price, { depot: 5.95, zpoint: 6.35 }); // carrier dropped by September
  assert.deepEqual(tier('home:SK:131', 1).price, { depot: 3.6, zpoint: 4 });
});

test('section-level fees carry the delivery modes they apply to', () => {
  const byCode = Object.fromEntries(pl.fees.map((f) => [f.code, f]));
  assert.deepEqual(byCode.outdated_pickup_point_list.appliesTo, ['PACKETA_PICKUP_POINT', 'PACKETA_BOX']);
  assert.ok(byCode.customs_declaration.appliesTo.includes('HOME'));
  assert.equal(byCode.nonconforming_parcel.amount, 40);
  assert.deepEqual(pl.surcharges.toll, { perStartedKg: 0.04, currency: 'EUR' });
});
