// Public API of the package.

import { readLines } from './pdf/layout.js';
import { parsePriceList } from './parse/pricelist.js';
import { getSource } from './sources/registry.js';

export { validatePriceList } from './validate/index.js';
export { sources, getSource } from './sources/registry.js';

/**
 * Parses a price list PDF into a PriceList object (see schema/pricelist.schema.json).
 * @param {Uint8Array | Buffer | ArrayBuffer} pdf
 * @param {{ source?: string, meta?: object }} [options] source id from the registry (default "sk");
 *   meta is merged into `source` (e.g. url, sha256, etag, fetchedAt)
 */
export async function parse(pdf, { source = 'sk', meta = {} } = {}) {
  const def = getSource(source);
  const lines = await readLines(pdf);
  return parsePriceList(lines, {
    profile: def.profile,
    source: { id: def.id, senderCountry: def.senderCountry, publisher: def.publisher, currency: def.currency, ...meta },
  });
}
