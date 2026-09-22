#!/usr/bin/env node
// Daily job: look for a new price list / fuel %, parse, run the quality gate, store, write a change report.
//
//   node scripts/update.js [--source sk] [--pdf local.pdf] [--report .tmp/report.md]
//
// --pdf  use a PDF you downloaded yourself instead of fetching it (manual fallback); --url says where it came from.
// In GitHub Actions it also writes step outputs: changed, failed, title.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { parse, validatePriceList, sources, getSource } from '../src/index.js';
import { getText, discoverPdf, downloadFile, readFuel } from '../src/fetch.js';
import { diffPriceLists, diffToMarkdown } from '../src/diff.js';
import { Store } from '../src/store.js';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    pdf: { type: 'string' },
    url: { type: 'string' }, // where the --pdf file came from, recorded in the data
    report: { type: 'string', default: '.tmp/update-report.md' },
    data: { type: 'string', default: 'data' },
  },
});

const store = new Store(values.data);
const targets = values.source ? [getSource(values.source)] : sources;
const sections = [];
const titles = [];
let changed = false;
let failed = false;

for (const def of targets) {
  try {
    const result = await updateSource(def);
    if (result.report) sections.push(result.report);
    if (result.title) titles.push(result.title);
    changed ||= result.changed;
    failed ||= result.failed;
  } catch (err) {
    failed = true;
    titles.push(`${def.id.toUpperCase()}: update failed`);
    sections.push(`## ${def.id.toUpperCase()}: the update could not run\n\n\`\`\`\n${err.stack ?? err}\n\`\`\`\n\nUsually Packeta changed its website or the network was down. If it keeps failing, the parser needs a look.`);
  }
}

const report = sections.join('\n\n---\n\n') || 'Nothing changed.';
mkdirSync(dirname(values.report), { recursive: true });
writeFileSync(values.report, report + '\n');
const title = titles.join('; ') || 'No changes';
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nfailed=${failed}\ntitle=${title}\n`);
console.log(`${title}\n(report: ${values.report})`);

async function updateSource(def) {
  const name = def.id.toUpperCase();
  const state = store.state(def.id);
  const html = await getText(def.discovery.page ?? def.fuel.url);
  const out = { changed: false, failed: false, report: null, title: null };
  const notes = [];

  // 1. Fuel surcharge (monthly). A failure here is a warning: prices are still usable.
  let fuel = null;
  try {
    fuel = readFuel(html, def.fuel);
  } catch (err) {
    notes.push(`⚠️ Could not read the current fuel surcharge: ${err.message}`);
  }
  const history = store.fuel(def.id);
  const lastFuel = history.at(-1);
  if (fuel && (lastFuel?.validFrom !== fuel.validFrom || lastFuel?.pct !== fuel.pct)) {
    store.saveFuel(def.id, [...history.filter((h) => h.validFrom !== fuel.validFrom), { ...fuel, fetchedAt: new Date().toISOString() }]);
    notes.push(`Fuel surcharge from ${fuel.validFrom}: **${fuel.pct} %** (previous: ${lastFuel ? `${lastFuel.pct} %` : 'none'})`);
    out.changed = true;
  }

  // 2. Price list PDF: download only when the file stamp changed.
  let head = null;
  let bytes = null;
  let sha256 = null;
  if (values.pdf) {
    bytes = readFileSync(values.pdf);
    sha256 = createHash('sha256').update(bytes).digest('hex');
  } else {
    head = await discoverPdf(def.discovery, html);
    const sameStamp = state.pdf && head.url === state.pdf.url && head.etag === state.pdf.etag && head.size === state.pdf.size;
    if (!sameStamp) ({ bytes, sha256 } = await downloadFile(head.url));
  }

  if (bytes && sha256 !== state.pdf?.sha256) {
    const previous = store.newest(def.id);
    const meta = { url: head?.url ?? values.url, sha256, etag: head?.etag, lastModified: head?.lastModified, fetchedAt: new Date().toISOString() };
    const priceList = await parse(bytes, {
      source: def.id,
      meta: Object.fromEntries(Object.entries(meta).filter(([, v]) => v != null)), // a manual PDF has no url/etag
    });
    const check = validatePriceList(priceList, { previous });
    if (!check.valid) {
      out.failed = true;
      out.title = `${name}: new price list failed the quality checks`;
      out.report = [
        `## ${name}: a new price list was found, but it did NOT pass the quality checks`,
        '',
        'Nothing was published; the previous prices stay live. The PDF layout probably changed and the parser needs an update.',
        '',
        `Source: ${head?.url ?? values.pdf} (valid from ${priceList.source.validFrom ?? 'unknown'})`,
        '',
        '### Errors',
        ...check.errors.map((e) => `- ${e}`),
        ...(check.warnings.length ? ['', '### Warnings', ...check.warnings.map((w) => `- ${w}`)] : []),
      ].join('\n');
      return out; // keep the old state, so tomorrow's run tries again
    }
    store.savePriceList(def.id, priceList, bytes);
    const diff = diffPriceLists(previous, priceList);
    notes.unshift(diffToMarkdown(diff, { sourceName: name }));
    if (check.warnings.length) notes.push('### Warnings (published anyway)', ...check.warnings.map((w) => `- ${w}`));
    out.changed = true;
    out.title = `${name}: price list valid from ${priceList.source.validFrom}`;
  }

  // 3. Remember the file stamp (also when the file was re-uploaded unchanged).
  if (head || sha256) {
    store.saveState(def.id, {
      pdf: { url: head?.url ?? state.pdf?.url ?? null, etag: head?.etag ?? null, lastModified: head?.lastModified ?? null, size: head?.size ?? bytes?.length ?? null, sha256: sha256 ?? state.pdf?.sha256 },
    });
  }

  if (out.changed) {
    out.title ??= `${name}: fuel surcharge ${fuel?.pct} % from ${fuel?.validFrom}`;
    out.report = [`# ${name}`, '', ...notes].join('\n');
  }
  return out;
}
