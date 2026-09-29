#!/usr/bin/env node
// Checks a built API folder before it goes live: every file present, valid, and consistent with the index.
//
//   node scripts/check-published.js [dist]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validatePriceList, validateSlice } from '../src/validate/index.js';

const dist = process.argv[2] ?? 'dist';
const v1 = join(dist, 'v1');
const problems = [];
const read = (p) => JSON.parse(readFileSync(join(v1, p), 'utf8'));
const check = (ok, message) => ok || problems.push(message);

check(existsSync(join(dist, 'index.html')), 'index.html (landing page) missing');
check(existsSync(join(dist, '.nojekyll')), '.nojekyll missing (GitHub Pages would skip files starting with _)');
for (const s of ['pricelist.schema.json', 'slice.schema.json']) check(existsSync(join(v1, 'schema', s)), `schema/${s} missing`);

const index = read('index.json');
check(index.schemaVersion === 1, 'index.json: wrong schemaVersion');
check(index.sources?.length > 0, 'index.json: no sources');

let files = 0;
let tiers = 0;
for (const source of index.sources ?? []) {
  const latest = read(source.latest.url);
  files++;
  const result = validatePriceList(latest);
  for (const e of result.errors) problems.push(`${source.id} latest.json: ${e}`);
  check(latest.source.validFrom === source.latest.validFrom, `${source.id}: index says ${source.latest.validFrom}, latest.json says ${latest.source.validFrom}`);
  check(latest.source.validFrom <= index.today, `${source.id}: latest.json is not valid yet (${latest.source.validFrom} > ${index.today})`);
  check(latest.surcharges.fuel.currentPct !== null, `${source.id}: latest.json has no current fuel surcharge`);
  check(source.fuel?.validFrom <= index.today, `${source.id}: index fuel entry is not valid yet`);

  for (const v of source.versions) {
    check(existsSync(join(v1, v.url)), `${source.id}: version ${v.validFrom} listed but missing`);
    files++;
  }
  if (source.upcoming) {
    const upcoming = read(source.upcoming.url);
    check(upcoming.source.validFrom > index.today, `${source.id}: upcoming.json is already valid`);
  }

  const ids = new Set(latest.services.map((s) => s.id));
  let sliced = 0;
  for (const slicePath of source.slices) {
    if (!existsSync(join(v1, slicePath))) {
      problems.push(`${slicePath}: listed in index.json but missing`);
      continue;
    }
    const slice = read(slicePath);
    files++;
    const r = validateSlice(slice);
    for (const e of r.errors) problems.push(`${slicePath}: ${e}`);
    for (const s of slice.services) {
      check(ids.has(s.id), `${slicePath}: service ${s.id} is not in latest.json`);
      sliced++;
    }
    check(slice.source.validFrom === latest.source.validFrom, `${slicePath}: different valid-from than latest.json`);
    check(slice.surcharges.fuel.currentPct === latest.surcharges.fuel.currentPct, `${slicePath}: different fuel surcharge than latest.json`);
  }
  check(sliced === latest.services.length, `${source.id}: slices hold ${sliced} services, latest.json has ${latest.services.length}`);
  tiers += latest.services.reduce((n, s) => n + s.tiers.length, 0);

  for (const [name, delimiter] of [['latest.csv', ','], ['latest-excel.csv', ';']]) {
    const csv = readFileSync(join(v1, source.id, name), 'utf8').replace(/^﻿/, '').trim().split('\r\n');
    files++;
    check(csv.length - 1 === latest.services.reduce((n, s) => n + s.tiers.length, 0), `${name}: row count does not match the price tiers`);
    check(csv[0].split(delimiter).length > 10, `${name}: header does not use "${delimiter}"`);
  }
}

console.log(`checked ${files} files, ${tiers} price tiers`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log('published API is consistent');
