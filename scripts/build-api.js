#!/usr/bin/env node
// Builds the static JSON API (served by GitHub Pages) from the data folder.
//
//   node scripts/build-api.js [--data data] [--out dist] [--today 2026-09-22]
//
// dist/v1/index.json                          sources, versions, current fuel
// dist/v1/<source>/latest.json                price list valid today, with the current fuel % filled in
// dist/v1/<source>/upcoming.json              published but not yet valid (only while one exists)
// dist/v1/<source>/<validFrom>.json           every version, unchanged
// dist/v1/<source>/latest.csv, latest-excel.csv
// dist/v1/<source>/<mode>/<ISO>.json          small slice: one delivery mode, one destination country
// dist/v1/schema/pricelist.schema.json

import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Store } from '../src/store.js';
import { sources } from '../src/index.js';
import { toCsv } from '../src/export/csv.js';

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: 'data' },
    out: { type: 'string', default: 'dist' },
    today: { type: 'string', default: new Date().toISOString().slice(0, 10) },
  },
});

export const MODE_PATHS = {
  HOME: 'home',
  PACKETA_PICKUP_POINT: 'packeta-pickup-point',
  PACKETA_BOX: 'packeta-box',
  PARTNER_PICKUP_POINT: 'partner-pickup-point',
  PARTNER_BOX: 'partner-box',
};

const store = new Store(values.data);
const today = values.today;
const v1 = join(values.out, 'v1');
rmSync(values.out, { recursive: true, force: true });

const write = (path, value) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
};

const index = { schemaVersion: 1, generatedAt: new Date().toISOString(), today, schema: 'schema/pricelist.schema.json', sources: [] };

for (const def of sources) {
  const versions = store.versions(def.id);
  if (!versions.length) continue;
  const currentDate = versions.filter((v) => v <= today).at(-1) ?? versions[0];
  const upcomingDate = versions.find((v) => v > today) ?? null;
  const fuel = store.fuel(def.id).filter((f) => f.validFrom <= today).at(-1) ?? null;

  const withFuel = (pl) => {
    const f = store.fuel(def.id).filter((x) => x.validFrom <= (pl.source.validFrom > today ? pl.source.validFrom : today)).at(-1);
    if (f) pl.surcharges.fuel = { ...pl.surcharges.fuel, currentPct: f.pct, month: f.month, sourceUrl: f.sourceUrl };
    delete pl.warnings;
    return pl;
  };

  // Archived versions stay exactly as parsed (the fuel % of their time is not known reliably).
  for (const v of versions) {
    const { warnings, ...pl } = store.priceList(def.id, v);
    write(join(v1, def.id, `${v}.json`), pl);
  }

  const latest = withFuel(store.priceList(def.id, currentDate));
  write(join(v1, def.id, 'latest.json'), latest);
  write(join(v1, def.id, 'latest.csv'), toCsv(latest));
  write(join(v1, def.id, 'latest-excel.csv'), '﻿' + toCsv(latest, { delimiter: ';' }));
  if (upcomingDate) write(join(v1, def.id, 'upcoming.json'), withFuel(store.priceList(def.id, upcomingDate)));

  // Small per-country slices, self-contained for a quote (surcharges included).
  const slices = {};
  for (const s of latest.services) {
    const key = `${MODE_PATHS[s.mode]}/${s.destination}`;
    (slices[key] ??= []).push(s);
  }
  for (const [key, services] of Object.entries(slices)) {
    write(join(v1, def.id, `${key}.json`), { schemaVersion: 1, source: latest.source, surcharges: latest.surcharges, services });
  }

  index.sources.push({
    id: def.id,
    senderCountry: def.senderCountry,
    publisher: def.publisher,
    currency: def.currency,
    latest: { validFrom: currentDate, url: `${def.id}/latest.json`, sha256: latest.source.sha256 ?? null, pdf: latest.source.url ?? null },
    upcoming: upcomingDate ? { validFrom: upcomingDate, url: `${def.id}/upcoming.json` } : null,
    versions: versions.map((v) => ({ validFrom: v, url: `${def.id}/${v}.json` })),
    fuel: fuel && { pct: fuel.pct, validFrom: fuel.validFrom },
    slices: Object.keys(slices).sort().map((k) => `${def.id}/${k}.json`),
  });
}

index.sliceSchema = 'schema/slice.schema.json';
write(join(v1, 'index.json'), index);
mkdirSync(join(v1, 'schema'), { recursive: true });
for (const name of ['pricelist.schema.json', 'slice.schema.json']) {
  copyFileSync(new URL(`../schema/${name}`, import.meta.url), join(v1, 'schema', name));
}
write(join(values.out, 'index.html'), landingPage(index));
write(join(values.out, '.nojekyll'), '');
console.log(`Built ${values.out}/ for ${index.sources.map((s) => `${s.id} (valid ${s.latest.validFrom})`).join(', ') || 'no sources'}`);

function landingPage(idx) {
  const rows = idx.sources
    .map((s) => `<li><b>${s.id.toUpperCase()}</b> – ${s.publisher}, valid from ${s.latest.validFrom}${s.fuel ? `, fuel ${s.fuel.pct} %` : ''}:
      <a href="v1/${s.latest.url}">latest.json</a> · <a href="v1/${s.id}/latest.csv">CSV</a> · <a href="v1/${s.id}/latest-excel.csv">Excel CSV</a>
      · e.g. <a href="v1/${s.id}/home/DE.json">home/DE.json</a></li>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Parcel price lists (unofficial)</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 16px;color:#222;background:#fff}code{background:#f3f3f3;padding:0 4px}
@media (prefers-color-scheme:dark){body{color:#ddd;background:#161616}code{background:#2a2a2a}a{color:#8ab4f8}}</style></head><body>
<h1>Parcel price lists as data</h1>
<p>Unofficial machine-readable copies of the public Packeta (SK) price lists. Prices exclude VAT.
Always verify against the source PDF linked in each file. Not affiliated with Packeta.</p>
<ul>${rows}</ul>
<p>Index of everything: <a href="v1/index.json"><code>v1/index.json</code></a> · Format: <a href="v1/schema/pricelist.schema.json">JSON Schema</a></p>
<p><small>Generated ${idx.generatedAt}</small></p></body></html>`;
}
