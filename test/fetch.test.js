import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCompletePdf, readFuel, userAgent } from '../src/fetch.js';
import sk from '../src/i18n/sk.js';
import { getSource } from '../src/sources/registry.js';

const pdf = (size) => Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(Math.max(0, size - 8))]);

test('a short download is rejected (a truncated PDF can still parse)', () => {
  assert.doesNotThrow(() => assertCompletePdf(pdf(1000), 1000, 'x.pdf'));
  assert.throws(() => assertCompletePdf(pdf(900), 1000, 'x.pdf'), /incomplete download.*900 of 1000/);
  assert.doesNotThrow(() => assertCompletePdf(pdf(900), null, 'x.pdf')); // no size promised
});

test('a file that is not a PDF is rejected', () => {
  assert.throws(() => assertCompletePdf(Buffer.from('<html>oops</html>'), null, 'x.pdf'), /not a PDF/);
});

test('the bot identifies itself and links to the project', () => {
  process.env.CONTACT_URL = 'https://example.test/project';
  assert.match(userAgent(), /^packeta-pricelist-bot\/1 \(\+https:\/\/example\.test\/project; checks once a day\)$/);
  delete process.env.CONTACT_URL;
});

test('reads the current fuel surcharge from the pricing page', () => {
  const html = '<p>Palivový príplatok pre cestnú prepravu platný od 1.10.2026 je <b>19,5%.</b></p>';
  assert.deepEqual(readFuel(html, getSource('sk').fuel), {
    validFrom: '2026-10-01',
    month: '2026-10',
    pct: 19.5,
    sourceUrl: 'https://www.packeta.sk/cenniky-a-priplatky',
  });
});

test('a pricing page without the fuel sentence fails loudly', () => {
  assert.throws(() => readFuel('<p>nothing here</p>', getSource('sk').fuel), /fuel surcharge text not found/);
});

test('source profile and registry line up', () => {
  const s = getSource('sk');
  assert.equal(s.profile, sk);
  assert.equal(s.currency, 'EUR');
  assert.match('https://files.packeta.com/web/files/Kompletny_cennik_sluzieb.pdf', s.discovery.link);
});
