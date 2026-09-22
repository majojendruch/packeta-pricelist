// The data folder that lives in git: every published price list, its source PDF, and the fuel history.
//
// data/<source>/state.json               last seen file stamp (etag, sha256, ...) and fuel %
// data/<source>/pricelists/<date>.json   parsed price lists by valid-from date
// data/<source>/archive/<date>.pdf       the PDF each price list was parsed from
// data/<source>/fuel.json                monthly fuel surcharge history

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(root = 'data') {
    this.root = root;
  }

  dir(source, ...parts) {
    return join(this.root, source, ...parts);
  }

  #read(path, fallback) {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
  }

  #write(path, value) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  }

  state(source) {
    return this.#read(this.dir(source, 'state.json'), {});
  }

  saveState(source, state) {
    this.#write(this.dir(source, 'state.json'), state);
  }

  /** Valid-from dates of all stored price lists, oldest first. */
  versions(source) {
    const dir = this.dir(source, 'pricelists');
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
  }

  priceList(source, validFrom) {
    return this.#read(this.dir(source, 'pricelists', `${validFrom}.json`), null);
  }

  /** Newest stored price list (regardless of date), or null. */
  newest(source) {
    const v = this.versions(source).at(-1);
    return v ? this.priceList(source, v) : null;
  }

  savePriceList(source, priceList, pdfBytes) {
    const date = priceList.source.validFrom;
    this.#write(this.dir(source, 'pricelists', `${date}.json`), priceList);
    if (pdfBytes) {
      mkdirSync(this.dir(source, 'archive'), { recursive: true });
      writeFileSync(this.dir(source, 'archive', `${date}.pdf`), pdfBytes);
    }
  }

  fuel(source) {
    return this.#read(this.dir(source, 'fuel.json'), []);
  }

  saveFuel(source, history) {
    this.#write(this.dir(source, 'fuel.json'), history);
  }
}
