import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/index.js';
import { diffPriceLists, diffToMarkdown } from '../src/diff.js';

let current;
before(async () => {
  current = await parse(readFileSync(new URL('./fixtures/sk/2026-09-01.pdf', import.meta.url)), { source: 'sk' });
});

test('identical lists have no changes', () => {
  const d = diffPriceLists(current, structuredClone(current));
  assert.equal(d.hasChanges, false);
  assert.match(diffToMarkdown(d), /No price changes/);
});

test('reports price changes, biggest first, and flags big ones', () => {
  const next = structuredClone(current);
  next.source.validFrom = '2026-10-01';
  const de = next.services.find((s) => s.id === 'home:DE:13613');
  de.tiers[0].price.depot = 8.5; // 6.92 -> 8.50 = +22.8 %
  de.tiers[1].price.depot = 7.1; // 7.02 -> 7.10 = +1.1 %
  next.services = next.services.filter((s) => s.id !== 'home:BE:4832');
  next.fees.find((f) => f.code === 'zpoint_handin').amount = 0.5;

  const d = diffPriceLists(current, next);
  assert.deepEqual(d.priceChanges.map((c) => [c.tier, c.from, c.to, c.pct]), [['≤ 1 kg', 6.92, 8.5, 22.8], ['≤ 2 kg', 7.02, 7.1, 1.1]]);
  assert.deepEqual(d.removedServices.map((s) => s.id), ['home:BE:4832']);
  assert.ok(d.itemChanges.some((c) => c.what === 'fee zpoint_handin: 0.4 → 0.5'));

  const md = diffToMarkdown(d, { sourceName: 'SK' });
  assert.match(md, /valid from \*\*2026-10-01\*\* \(previous: 2026-09-01\)/);
  assert.match(md, /1 by 15 % or more/);
  assert.match(md, /\| home:DE:13613 \| ≤ 1 kg \| depot \| 6\.92 \| 8\.5 \| \+22\.8 % ⚠️ \|/);
});
