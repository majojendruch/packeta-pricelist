// Golden tests on the real SK price list valid from 2026-09-01.
// Spot values are checked by hand against the PDF; the snapshot catches any other change.
// After an intentional parser change: UPDATE_SNAPSHOTS=1 npm test, then review the git diff of the snapshot.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse, validatePriceList } from '../src/index.js';

const FIXTURE = new URL('./fixtures/sk/2026-09-01.pdf', import.meta.url);
const SNAPSHOT = new URL('./fixtures/sk/2026-09-01.expected.json', import.meta.url);

let pl;
const service = (id) => {
  const s = pl.services.find((x) => x.id === id);
  assert.ok(s, `service ${id} exists`);
  return s;
};
const tier = (id, kg, variant = null) => service(id).tiers.find((t) => t.maxKg === kg && t.variant === variant);

before(async () => {
  pl = await parse(readFileSync(FIXTURE), { source: 'sk' });
});

test('document metadata', () => {
  assert.equal(pl.source.validFrom, '2026-09-01');
  assert.equal(pl.source.id, 'sk');
  assert.deepEqual(pl.warnings, []);
});

test('service counts per delivery mode', () => {
  const counts = {};
  for (const s of pl.services) counts[s.mode] = (counts[s.mode] ?? 0) + 1;
  assert.deepEqual(counts, { PACKETA_BOX: 3, PACKETA_PICKUP_POINT: 7, HOME: 77, PARTNER_PICKUP_POINT: 32, PARTNER_BOX: 21 });
});

test('home delivery prices (hand-checked against the PDF)', () => {
  assert.deepEqual(tier('home:SK:131', 1).price, { depot: 3.6, zpoint: 4 });
  assert.deepEqual(tier('home:BE:4832', 0.5).price, { depot: 9.25, zpoint: 9.65 });
  assert.equal(tier('home:DE:13613', 1).price.depot, 6.92);
  assert.equal(tier('home:DE:13613', 15).price.depot, 10.48);
  assert.deepEqual(tier('home:HU:3828', 15).price, { depot: 6.6, zpoint: 7 });
  assert.deepEqual(tier('home:TR:19328', 0.5).price, { depot: 28.92, zpoint: 29.32 }); // label and prices 2.5 pt apart
});

test('COD, insurance, fees and limits of a home delivery service', () => {
  const de = service('home:DE:13613');
  assert.equal(de.cod.tiers[0].fee, 6.2);
  assert.deepEqual(de.insurance.tiers.at(-1), { upTo: { amount: 700, currency: 'EUR' }, fee: 6.5 });
  assert.deepEqual(de.fees.map((f) => [f.code, f.amount]), [['special_handling', 10], ['delivery_hold', 2.5], ['island_delivery', 8.5]]);
  assert.equal(de.limits.maxWeightKg, 15);

  const be = service('home:BE:4832');
  assert.equal(be.cod.available, false);
  assert.equal(be.insurance.tiers.find((t) => t.upTo.amount === 700).fee, 9.5);

  const sk = service('home:SK:131');
  assert.equal(sk.cod.cardPaymentPct, 1.2);
  assert.equal(sk.limits.fromSectionDefaults, true);
  assert.deepEqual(sk.limits.byWeight, [{ maxKg: 5, maxSideCm: 60, maxSumCm: 120 }, { maxKg: 15, maxSideCm: 120, maxSumCm: 150 }]);
});

test('Packeta Z-BOX and Z-POINT', () => {
  assert.deepEqual(tier('packeta_box:SK:packeta-z-box-pp', 5).price, { depot: 2.3, zpoint: 2.7 });
  const box = service('packeta_box:SK:packeta-z-box-pp');
  assert.deepEqual(box.limits.sizeCategories.map((c) => c.code), ['XS', 'S', 'XM', 'M', 'L']);
  assert.equal(service('packeta_pickup_point:SK:packeta-z-point-pp').limits.maxSumCm, 150);
});

test('partner pickup points and boxes', () => {
  assert.deepEqual(tier('partner_pickup_point:HR:10619', 1).price, { depot: 4.19, zpoint: 4.59 }); // table shifted left in the PDF
  assert.deepEqual(tier('partner_box:BG:26067', 1, 'A').price, { depot: 3.45, zpoint: 3.85 });
  assert.equal(service('partner_box:BG:26067').limits.sizeCategories.length, 3);
});

test('FedEx services carry the volumetric divisor and air surcharge', () => {
  const ie = service('home:IE:24810');
  assert.equal(ie.volumetric.divisor, 5000);
  assert.equal(tier('home:IE:24810', 15).price.depot, 34.18);
  const air = service('home:TR:19328').fees.find((f) => f.code === 'air_surcharge');
  assert.deepEqual(air.byWeight.at(-1), { maxKg: 15, amount: 6.8 });
});

test('suspended services are flagged', () => {
  assert.equal(service('home:IL:19329').suspended, true);
  assert.equal(service('home:DE:13613').suspended, false);
});

test('returns, surcharges, fees, penalties', () => {
  assert.equal(pl.returns.prices.find((r) => r.fromCountry === 'DE').price, 5.4);
  assert.equal(pl.returns.prices.length, 20);
  assert.deepEqual(pl.surcharges.toll, { perStartedKg: 0.04, currency: 'EUR' });
  assert.equal(pl.surcharges.fuel.dieselTable.length, 25); // 0–640, then 40 € steps up to 1 600
  assert.deepEqual(pl.surcharges.fuel.dieselTable.at(-1), { fromEurPer1000l: 1560, toEurPer1000l: 1600, pct: 12 });
  assert.deepEqual(pl.surcharges.fuel.above, { fromEurPer1000l: 1600, stepPct: 0.5, perEur: 40 });
  assert.equal(pl.fees.find((f) => f.code === 'zpoint_handin').amount, 0.4);
  assert.equal(pl.fees.find((f) => f.code === 'customs_extra_item').amount, 1.2);
  assert.equal(pl.penalties.find((f) => f.code === 'excluded_goods').amount, 10300);
  assert.equal(new Set(pl.fees.map((f) => f.code)).size, pl.fees.length, 'fee codes are unique');
});

test('passes the publishing quality gate', () => {
  const result = validatePriceList(pl);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('quality gate catches broken data', () => {
  const broken = structuredClone(pl);
  broken.services.find((s) => s.id === 'home:DE:13613').tiers[2].price.depot = 1; // cheaper than lighter tier
  broken.services = broken.services.filter((s) => s.mode !== 'PARTNER_BOX' || s.destination === 'BG');
  const result = validatePriceList(broken, { previous: pl });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('home:DE:13613') && e.includes('price drops')));
  assert.ok(result.errors.some((e) => e.startsWith('PARTNER_BOX')));
});

test('output matches the reviewed snapshot', () => {
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(SNAPSHOT)) {
    writeFileSync(SNAPSHOT, JSON.stringify(pl, null, 2) + '\n');
    return;
  }
  assert.deepEqual(pl, JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
});
