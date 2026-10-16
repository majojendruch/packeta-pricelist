import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCompletePdf, isOlderThanKnown, readFuel, userAgent } from '../src/fetch.js';
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

test('the SK link pattern finds the old and the new file names', () => {
  const html = `
    <a href="https://files.packeta.com/web/files/Kompletny_cennik_sluzieb_sk.pdf">old</a>
    <a href="https://files.packeta.com/web/files/SK_Cennik_dorucovania_Packeta_Slovakia_od_12_10_2026.pdf">new</a>
    <a href="https://files.packeta.com/web/files/SK_Zasady_ochrany_osobnych_udajov.pdf">privacy</a>`;
  assert.deepEqual(html.match(getSource('sk').discovery.link), [
    'https://files.packeta.com/web/files/Kompletny_cennik_sluzieb_sk.pdf',
    'https://files.packeta.com/web/files/SK_Cennik_dorucovania_Packeta_Slovakia_od_12_10_2026.pdf',
  ]);
});

test('a linked file older than the one we hold is "nothing new"', () => {
  const known = { lastModified: 'Wed, 07 Oct 2026 10:57:09 GMT' };
  assert.equal(isOlderThanKnown({ lastModified: 'Thu, 12 Feb 2026 11:49:35 GMT' }, known), true);
  assert.equal(isOlderThanKnown({ lastModified: 'Thu, 08 Oct 2026 08:00:00 GMT' }, known), false);
  assert.equal(isOlderThanKnown({ lastModified: null }, known), false); // unknown date: check as usual
  assert.equal(isOlderThanKnown({ lastModified: 'Thu, 12 Feb 2026 11:49:35 GMT' }, undefined), false); // first run
});
