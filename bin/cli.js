#!/usr/bin/env node
// Command line: parse a price list PDF, validate a JSON file.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { parse, validatePriceList, sources } from '../src/index.js';
import { toCsv } from '../src/export/csv.js';

const HELP = `Usage:
  packeta-pricelist parse <file.pdf> [--source sk] [--out prices.json] [--csv tiers.csv] [--excel-csv]
  packeta-pricelist validate <prices.json> [--previous old.json]

  parse      Convert a Packeta / Zásilkovna price list PDF to JSON (stdout unless --out).
             --csv writes one row per service and weight tier; --excel-csv uses ";" for SK/CZ Excel.
             Exit code 1 when the result fails the quality checks.
  validate   Run the quality checks on a JSON file.

Sources: ${sources.map((s) => s.id).join(', ')}`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string', default: 'sk' },
    out: { type: 'string' },
    csv: { type: 'string' },
    'excel-csv': { type: 'boolean', default: false },
    previous: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [command, file] = positionals;

if (values.help || !command || !file) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const report = ({ errors, warnings }) => {
  for (const w of warnings) console.error(`warning: ${w}`);
  for (const e of errors) console.error(`ERROR: ${e}`);
};

if (command === 'parse') {
  const pdf = readFileSync(file);
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const priceList = await parse(pdf, { source: values.source, meta: { sha256 } });
  const result = validatePriceList(priceList, { previous: values.previous && readJson(values.previous) });
  const json = JSON.stringify(priceList, null, 2) + '\n';
  if (values.out) writeFileSync(values.out, json);
  else process.stdout.write(json);
  if (values.csv) {
    const csv = toCsv(priceList, { delimiter: values['excel-csv'] ? ';' : ',' });
    writeFileSync(values.csv, (values['excel-csv'] ? '﻿' : '') + csv);
  }
  report(result);
  console.error(`${priceList.services.length} services, valid from ${priceList.source.validFrom}: ${result.valid ? 'OK' : 'FAILED quality checks'}`);
  process.exit(result.valid ? 0 : 1);
} else if (command === 'validate') {
  const result = validatePriceList(readJson(file), { previous: values.previous && readJson(values.previous) });
  report(result);
  console.error(result.valid ? 'OK' : 'FAILED');
  process.exit(result.valid ? 0 : 1);
} else {
  console.error(`Unknown command "${command}"\n\n${HELP}`);
  process.exit(1);
}
