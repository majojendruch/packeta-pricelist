// Known price list sources. Adding a source = one entry here + a language profile + test fixtures.

import sk from '../i18n/sk.js';

export const sources = [
  {
    id: 'sk',
    senderCountry: 'SK',
    publisher: 'Packeta Slovakia s.r.o.',
    currency: 'EUR',
    profile: sk,
    // The pricing page links an old and a current SK list; the newest file is the current one.
    discovery: {
      type: 'newest-linked',
      page: 'https://www.packeta.sk/cenniky-a-priplatky',
      link: /https:\/\/files\.packeta\.com\/web\/files\/Kompletny_cennik_sluzieb(?:_sk)?\.pdf/g,
    },
    // "Palivový príplatok pre cestnú prepravu platný od 1.9.2026 je 18,5%."
    fuel: {
      url: 'https://www.packeta.sk/cenniky-a-priplatky',
      pattern: /Palivový príplatok pre cestnú prepravu platný od (\d{1,2})\.(\d{1,2})\.(\d{4}) je (\d+(?:,\d+)?)\s*%/i,
    },
  },
];

export function getSource(id) {
  const s = sources.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown source "${id}". Known: ${sources.map((x) => x.id).join(', ')}`);
  return s;
}
