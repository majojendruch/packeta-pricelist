#!/usr/bin/env node
// Independent check: compares parsed prices against Packeta's ENGLISH edition of the same price list.
// A different document, read with its own simple logic - so a parser mistake shows up as a difference.
//
//   node scripts/crosscheck-en.js <english.pdf> <pricelist.json>

import { readFileSync } from 'node:fs';
import { readLines } from '../src/pdf/layout.js';

const [enPdf, jsonFile] = process.argv.slice(2);
const num = (s) => Number(String(s).replace(/[\s ]/g, '').replace(',', '.'));
const MONEY = /^([\d\s .,]+)\s*€$/;
const WEIGHT = /^(?:Parcels?|Consignments?|Packages?|Shipments?)\s+(?:weighing\s+)?up to\s+([\d.,]+)\s*kg\s*(?:[-–]\s*(?:category\s+)?(\S+))?$/i;
const CARRIER_ID = /\(carrier.{0,3}s?\s*ID:?\s*([^)]*)\)/i;

const lines = await readLines(readFileSync(enPdf));
const rows = new Map();
let carrierId = null;
let inExtraTable = false;

for (const line of lines) {
  if (/\.{4,}/.test(line.text)) continue; // table of contents
  const header = CARRIER_ID.exec(line.text);
  if (header) {
    carrierId = Number(header[1].match(/\d+/)?.[0]);
    inExtraTable = false;
  }
  // Air surcharge tables repeat the same row shape with a single price - skip them.
  if (/^(Air|Surcharge for air)/i.test(line.cells[0].text)) inExtraTable = true;
  if (/^(Parcel parameters|Cash on delivery|Insurance)/i.test(line.cells[0].text)) inExtraTable = false;
  const weight = WEIGHT.exec(line.cells[0].text);
  if (!weight || !carrierId || inExtraTable) continue;
  const values = line.cells.slice(1).map((c) => MONEY.exec(c.text)).filter(Boolean).map((m) => num(m[1]));
  if (values.length >= 2) rows.set(`${carrierId}|${num(weight[1])}|${weight[2] ?? ''}`, values.slice(0, 2));
}

const pl = JSON.parse(readFileSync(jsonFile, 'utf8'));
let compared = 0;
const differences = [];
const notInEnglish = [];
for (const s of pl.services) {
  if (!s.carrierIds.length) continue;
  for (const t of s.tiers) {
    const ref = rows.get(`${s.carrierIds[0]}|${t.maxKg}|${t.variant ?? ''}`);
    if (!ref) {
      notInEnglish.push(`${s.id}@${t.maxKg}kg${t.variant ? `/${t.variant}` : ''}`);
      continue;
    }
    compared++;
    if (ref[0] !== t.price.depot || ref[1] !== t.price.zpoint) {
      differences.push({ service: s.id, maxKg: t.maxKg, english: ref, parsed: [t.price.depot, t.price.zpoint] });
    }
  }
}

console.log(`rows read from the English edition: ${rows.size}`);
console.log(`price tiers compared: ${compared}`);
console.log(`differences: ${differences.length}`);
for (const d of differences.slice(0, 20)) console.log(' ', JSON.stringify(d));
console.log(`tiers with no English counterpart: ${notInEnglish.length}`);
if (notInEnglish.length) console.log(' ', notInEnglish.slice(0, 10).join(', '));
process.exit(differences.length ? 1 : 0);
