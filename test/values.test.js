import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parsePct, parseKg, parseCm, parseDims } from '../src/util/values.js';
import { slug } from '../src/util/text.js';

test('parseMoney reads all currency formats used in the price lists', () => {
  assert.deepEqual(parseMoney('4,20 €'), { amount: 4.2, currency: 'EUR' });
  assert.deepEqual(parseMoney('1 400 BGN'), { amount: 1400, currency: 'BGN' });
  assert.deepEqual(parseMoney('220 000 HUF'), { amount: 220000, currency: 'HUF' });
  assert.deepEqual(parseMoney('CZK 89.00'), { amount: 89, currency: 'CZK' });
  assert.deepEqual(parseMoney('89,00 Kč'), { amount: 89, currency: 'CZK' });
  assert.deepEqual(parseMoney('10 300 €'), { amount: 10300, currency: 'EUR' });
});

test('parseMoney rejects text that is not a single amount', () => {
  assert.equal(parseMoney('Cena bez DPH'), null);
  assert.equal(parseMoney('15'), null); // no currency
  assert.equal(parseMoney('v cene doručenia'), null);
});

test('percent, weight, length and dimension parsers', () => {
  assert.equal(parsePct('1,20 %'), 1.2);
  assert.equal(parsePct('1,20 €'), null);
  assert.equal(parseKg('do 15 kg'), 15);
  assert.equal(parseKg('Zásielky do hmotnosti 0,5 kg'), 0.5);
  assert.equal(parseCm('120 cm'), 120);
  assert.deepEqual(parseDims('10 × 7 × 1 cm'), [10, 7, 1]);
  assert.deepEqual(parseDims('61 x 44 x 8 cm'), [61, 44, 8]);
});

test('slug is ascii, lowercase and cut at a word boundary', () => {
  assert.equal(slug('Poplatok za doručovanie na ostrovy'), 'poplatok-za-dorucovanie-na-ostrovy');
  assert.ok(slug('a'.repeat(30) + ' ' + 'b'.repeat(30)).length <= 48);
});
