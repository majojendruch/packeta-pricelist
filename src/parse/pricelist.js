// Core parser: positioned lines (src/pdf/layout.js) + language profile -> PriceList object.
// The document is read top to bottom as a stream, so tables that continue on the next page just keep going.

import { parseMoney, parsePct, parseKg, parseCm, parseDims, toNumber } from '../util/values.js';
import { slug, uniqueCodes } from '../util/text.js';

const LEFT_EDGE = 5; // TEST: deliberately broken to prove the quality gate blocks publishing // service headers and notices start left of this; table labels start right of it
const LABEL_MAX_X = 250; // cells left of this are row labels, right of it are values
const ROW_GROUP_GAP = 12; // vertical gap (pt) that separates two rows of a free-form table

/**
 * @param {import('../pdf/layout.js').Line[]} lines
 * @param {{ profile: object, source: object }} options
 */
export function parsePriceList(lines, { profile, source }) {
  const clean = lines.filter((l) => !profile.footer.test(l.text) && !/\.{5,}/.test(l.text));
  const warnings = [];
  const validFrom = findValidFrom(clean, profile);
  const sections = splitSections(clean, profile);

  const services = [];
  for (const kind of ['packeta', 'home', 'partner']) {
    services.push(...parseServices(sections[kind] ?? [], kind, profile, warnings));
  }

  return {
    schemaVersion: 1,
    source: { ...source, validFrom, language: profile.language },
    services,
    returns: parseReturns(sections.returns ?? [], profile),
    surcharges: collectSurcharges(sections, profile),
    fees: collectItems(sections, 'fees', profile),
    penalties: collectItems(sections, 'penalties', profile),
    warnings,
  };
}

function findValidFrom(lines, profile) {
  for (const l of lines.slice(0, 40)) {
    const m = profile.validFrom.exec(l.text);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Sections

// Older price lists put fees and surcharges inside each delivery section ("2.3 Poplatky k zásielke ...");
// those go to "fees:home", "surcharges:home", ... so they can be tagged with the modes they apply to.
function splitSections(lines, profile) {
  const out = {};
  let current = null;
  let section = null;
  for (const line of lines) {
    const [first, second] = line.cells;
    if (first && first.x < LEFT_EDGE && second) {
      if (/^\d\.$/.test(first.text)) {
        section = profile.sections.find((s) => s.match.test(second.text))?.kind ?? null;
        current = section ? (out[section] ??= []) : null;
        continue;
      }
      if (/^\d\.\d\.$/.test(first.text)) {
        const sub = section && Object.entries(profile.subsections ?? {}).find(([, re]) => re.test(second.text))?.[0];
        current = sub ? (out[`${sub}:${section}`] ??= []) : section ? out[section] : null;
        continue;
      }
    }
    current?.push(line);
  }
  return out;
}

const SECTION_MODES = {
  packeta: ['PACKETA_PICKUP_POINT', 'PACKETA_BOX'],
  home: ['HOME'],
  partner: ['PARTNER_PICKUP_POINT', 'PARTNER_BOX'],
};

// General fees/penalties: one list; items that exist only for some delivery modes carry appliesTo.
function collectItems(sections, kind, profile) {
  const items = parseItemTable(sections[kind] ?? [], profile);
  for (const [section, modes] of Object.entries(SECTION_MODES)) {
    for (const item of parseItemTable(sections[`${kind}:${section}`] ?? [], profile)) {
      const same = items.find((i) => i.code === item.code && i.amount === item.amount && i.appliesTo);
      if (same) same.appliesTo.push(...modes);
      else items.push({ ...item, appliesTo: [...modes] });
    }
  }
  return uniqueCodes(items);
}

function collectSurcharges(sections, profile) {
  const key = ['surcharges', ...Object.keys(SECTION_MODES).map((s) => `surcharges:${s}`)].find((k) => sections[k]?.length);
  return parseSurcharges(key ? sections[key] : [], profile);
}

// ---------------------------------------------------------------------------------------------
// Services (sections 1-3)

function parseServices(lines, kind, profile, warnings) {
  const chunks = [];
  const preamble = [];
  for (const line of lines) {
    const header = matchServiceHeader(line, profile);
    if (header) chunks.push({ header, lines: [] });
    else if (chunks.length) chunks.at(-1).lines.push(line);
    else preamble.push(line);
  }
  const services = chunks.map(({ header, lines: body }) => buildService(header, body, kind, profile, warnings));
  applySectionDefaults(services, parseDefaultTables(preamble, profile), profile.defaults?.[kind] ?? [], warnings);
  return services;
}

// Section intro tables ("2.1 Parametre zásielok") hold the limits for services that have no table of their own.
// Columns are defined by the "max weight" row; a row with a single value applies to every column.
function parseDefaultTables(lines, profile) {
  const L = profile.limits;
  const starts = lines.map((l, i) => (L.maxWeightKg.test(l.cells[0]?.text ?? '') ? i : -1)).filter((i) => i >= 0);
  return starts.map((start, n) => {
    const rows = lines.slice(start, starts[n + 1] ?? lines.length);
    const columns = rows[0].cells.slice(1).map((c) => ({ center: (c.x + c.x2) / 2, maxKg: parseKg(c.text) }));
    // Only first lines of labels count ("Maximálny súčet všetkých" / "troch strán zásielky" is one label).
    const labels = rows.filter((r) => r.cells[0].x < 150 && Object.values(L).some((re) => re.test(r.cells[0].text)));
    const table = { columns: columns.map((c) => ({ maxKg: c.maxKg })), minDimsCm: null, sizeCategories: [] };
    for (const r of rows.slice(1)) {
      const size = r.cells.find((c) => /^(XXS|XS|S|XM|M|L|XL|XXL)$/.test(c.text));
      if (size) {
        const dims = r.cells.map((c) => parseDims(c.text)).find(Boolean);
        if (dims) table.sizeCategories.push({ code: size.text, dimsCm: dims });
        continue;
      }
      const values = r.cells.filter((c) => c.x >= 150 && (parseCm(c.text) !== null || parseDims(c.text)));
      if (!values.length) continue;
      const owner = labels.reduce((best, l) => (!best || Math.abs(l.y - r.y) < Math.abs(best.y - r.y) ? l : best), null);
      if (!owner || Math.abs(owner.y - r.y) > 20) continue;
      const label = owner.cells[0].text;
      if (L.minDimsCm.test(label)) {
        table.minDimsCm = parseDims(values[0].text);
        continue;
      }
      const key = L.maxSideCm.test(label) ? 'maxSideCm' : L.maxSumCm.test(label) ? 'maxSumCm' : null;
      if (!key) continue;
      columns.forEach((col, i) => {
        const cell = values.length === 1 ? values[0] : values.reduce((b, v) => (Math.abs((v.x + v.x2) / 2 - col.center) < Math.abs((b.x + b.x2) / 2 - col.center) ? v : b));
        table.columns[i][key] = parseCm(cell.text);
      });
    }
    return table;
  });
}

function applySectionDefaults(services, tables, rules, warnings) {
  for (const s of services) {
    if (s.limits.maxWeightKg) continue;
    const rule = rules.find((r) => (!r.modes || r.modes.includes(s.mode)) && (!r.carrier || r.carrier.test(s.carrierName)));
    const table = rule && tables[rule.table];
    if (!table) {
      warnings.push(`No parcel limits for "${s.title}"`);
      continue;
    }
    const cols = (rule.columns ?? table.columns.map((_, i) => i)).map((i) => table.columns[i]).filter(Boolean);
    const max = (key) => Math.max(...cols.map((c) => c[key] ?? 0)) || null;
    s.limits = {
      maxWeightKg: max('maxKg'),
      minDimsCm: table.minDimsCm,
      maxSideCm: max('maxSideCm'),
      maxSumCm: max('maxSumCm'),
      ...(cols.length > 1 ? { byWeight: cols.map((c) => ({ ...c })) } : {}),
      ...(table.sizeCategories.length && s.mode.endsWith('BOX') ? { sizeCategories: table.sizeCategories } : {}),
      ...s.limits,
      fromSectionDefaults: true,
    };
  }
}

function matchServiceHeader(line, profile) {
  if (line.cells.length !== 1 || line.cells[0].x >= LEFT_EDGE) return null;
  const text = line.text;
  if (profile.notice.test(text)) return null;
  const m = profile.serviceHeader.exec(text);
  if (!m) return null;
  const country = m.groups.country.trim();
  const destination = profile.countries[country] ?? m.groups.iso;
  return { text, country, destination, carrierCountry: m.groups.iso, name: m.groups.name.trim(), ids: m.groups.ids, rest: m.groups.rest?.replace(/^\s*[-–]\s*/, '').trim() || null };
}

function modeFor(kind, name) {
  if (kind === 'home') return 'HOME';
  if (kind === 'packeta') return /Z-BOX/i.test(name) ? 'PACKETA_BOX' : 'PACKETA_PICKUP_POINT';
  return /\bBOX\b/i.test(name) ? 'PARTNER_BOX' : 'PARTNER_PICKUP_POINT';
}

function buildService(header, lines, kind, profile, warnings) {
  const carrierIds = (header.ids ?? '').match(/\d+/g)?.map(Number) ?? [];
  const typeMatch = /\s+(HD|PP|BOX|Box)$/.exec(header.name);
  const carrierName = typeMatch ? header.name.slice(0, typeMatch.index) : header.name;
  const mode = modeFor(kind, header.name);
  const service = {
    id: [mode.toLowerCase(), header.destination, carrierIds.length ? carrierIds.join('-') : slug(`${header.name} ${header.rest ?? ''}`)].join(':'),
    mode,
    destination: header.destination,
    carrierCountry: header.carrierCountry,
    carrierIds,
    carrierName,
    title: header.text,
    variant: header.rest && !profile.suspended.test(header.rest) ? header.rest : null,
    suspended: profile.suspended.test(header.text),
    leadTimeDays: null,
    currency: null,
    tiers: [],
    cod: { available: true, max: null, tiers: [], cardPaymentPct: null },
    insurance: { max: null, tiers: [] },
    limits: {},
    fees: [],
    volumetric: null,
    notes: [],
    page: lines[0]?.page ?? null,
  };

  let block = null;
  const blocks = [];
  let note = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const first = line.cells[0];
    const lead = profile.leadTime.exec(line.text);
    if (lead) {
      service.leadTimeDays = { min: Number(lead[1]), max: Number(lead[2] ?? lead[1]) };
      continue;
    }
    if (profile.footnote.test(line.text)) {
      block = null;
      continue;
    }
    const kindOf = blockKind(line, lines[i - 1], lines[i + 1], profile);
    if (kindOf) {
      note = null;
      blocks.push((block = { kind: kindOf, heading: line, lines: [] }));
      continue;
    }
    const freeText = first.x < LEFT_EDGE && line.cells.length === 1 && (profile.notice.test(line.text) || note || !block);
    if (freeText) {
      // Notices and explanations below the tables belong to the service as notes.
      if (profile.notice.test(line.text) || !note) service.notes.push((note = { text: line.text }));
      else note.text += ` ${line.text}`;
      block = null;
      continue;
    }
    note = null;
    if (block) block.lines.push(line);
  }

  for (const b of blocks) applyBlock(service, b, profile, warnings);
  uniqueCodes(service.fees);

  for (const n of service.notes) {
    const v = profile.volumetricDivisor.exec(n.text);
    if (v) service.volumetric = { divisor: Number(v[1]) };
  }
  service.notes = service.notes.map((n) => n.text);
  if (!service.cod.available) service.cod = { available: false, max: null, tiers: [], cardPaymentPct: null };
  if (!service.tiers.length) warnings.push(`No price tiers for "${header.text}" (page ${service.page})`);
  return service;
}

function blockKind(line, prev, next, profile) {
  const first = line.cells[0];
  if (first.x >= 130) return null;
  for (const [kind, re] of Object.entries(profile.blocks)) if (re.test(first.text)) return kind;
  if (first.x >= 100) return null;
  // An unknown priced item: a label with a "price" column header, not glued to the text above it.
  const glued = prev && prev.page === line.page && prev.y - line.y < ROW_GROUP_GAP && prev.cells[0].x >= LEFT_EDGE;
  if (glued) return null;
  const hasHeader = (l) => l?.cells.some((c) => c.x > 300 && profile.tableHeaderCell.test(c.text));
  if (hasHeader(line)) return 'fee';
  if (next && Math.abs(next.y - line.y) < 6 && next.cells.length === 1 && hasHeader(next)) return 'fee';
  return null;
}

function applyBlock(service, block, profile, warnings) {
  const rows = [block.heading, ...block.lines];
  switch (block.kind) {
    case 'price':
      return applyPriceTable(service, rows, profile, warnings);
    case 'cod':
      service.cod.tiers.push(...valueTiers(rows, profile));
      return;
    case 'insurance': {
      const supplementary = profile.supplementary?.test(block.heading.cells[0].text);
      service.insurance.tiers.push(...valueTiers(rows, profile).map((t) => (supplementary ? { ...t, supplementary: true } : t)));
      return;
    }
    case 'cardPayment': {
      const cells = rows.flatMap((r) => r.cells).filter((c) => c.x >= 300);
      const pct = cells.map((c) => parsePct(c.text)).find((v) => v !== null);
      service.cod.cardPaymentPct = pct ?? null;
      if (cells.some((c) => profile.notPossible.test(c.text))) service.cod.cardPayment = false;
      return;
    }
    case 'limits':
      return Object.assign(service.limits, parseLimits(rows.slice(1), profile));
    default:
      service.fees.push(parseFeeBlock(rows, profile));
  }
}

// Price table: header row defines the columns, every weight row becomes a tier.
function applyPriceTable(service, rows, profile, warnings) {
  const columns = [];
  for (const r of rows.slice(0, 3)) {
    for (const c of r.cells) {
      for (const [key, re] of Object.entries(profile.priceColumns)) {
        if (re.test(c.text) && !columns.some((col) => col.key === key)) columns.push({ key, center: (c.x + c.x2) / 2 });
      }
    }
  }
  const columnOf = (cell) =>
    columns.reduce((best, col) => {
      const d = Math.abs((cell.x + cell.x2) / 2 - col.center);
      return !best || d < best.d ? { key: col.key, d } : best;
    }, null)?.key;

  const firstColumnX = Math.min(...columns.map((c) => c.center)) - 30;
  for (const r of rows) {
    const label = r.cells[0].x < firstColumnX ? r.cells[0] : null;
    const weight = label ? profile.weightRow.exec(label.text) : null;
    const tier = weight ? { maxKg: toNumber(weight[1]), variant: weight[2]?.trim() || null, price: {} } : null;
    for (const c of r.cells) {
      if (c === label) continue;
      const key = columnOf(c);
      if (key === 'maxCod' || key === 'maxInsurance') {
        const notOffered = profile.notOffered.test(c.text);
        const value = notOffered ? null : parseMoney(c.text);
        if (!notOffered && !value) continue; // column header text
        if (key === 'maxCod') {
          service.cod.max = value;
          service.cod.available = value !== null;
        } else service.insurance.max = value;
      } else if (tier && key) {
        const money = parseMoney(c.text);
        if (!money) continue;
        tier.price[key] = money.amount;
        service.currency ??= money.currency;
      }
    }
    if (tier) {
      if (tier.price.depot === undefined) warnings.push(`Tier without price: "${label.text}" in ${service.title}`);
      service.tiers.push(tier);
    }
  }
}

// COD / insurance tables: "up to <amount>" label on the left, fee on the right.
function valueTiers(rows, profile) {
  const heading = rows.slice(0, 3).map((r) => r.text).join(' ');
  const above = /nad\s+([\d\s]+(?:[.,]\d+)?)\s*([A-Z]{3}|€)/i.exec(heading);
  const tiers = [];
  for (const r of rows) {
    // A tier row is exactly "<up to amount>  <fee>"; headings and descriptions never start with an amount.
    if (r.cells.length !== 2 || !parseMoney(r.cells[0].text)) continue;
    const [upToCell, valueCell] = r.cells;
    if (profile.tableHeaderCell.test(valueCell.text)) continue;
    const tier = { upTo: parseMoney(upToCell.text) };
    if (above) tier.above = { amount: toNumber(above[1]), currency: above[2] === '€' ? 'EUR' : above[2] };
    const pct = parsePct(valueCell.text);
    const money = parseMoney(valueCell.text);
    if (profile.included.test(valueCell.text)) Object.assign(tier, { fee: 0, included: true });
    else if (pct !== null) tier.feePct = pct;
    else if (money) tier.fee = money.amount;
    else tier.text = valueCell.text;
    tiers.push(tier);
  }
  return tiers;
}

// Parcel limits: labels on the left; values may sit slightly above/below their label.
function parseLimits(rows, profile) {
  const isLabel = (c) => c.x < LABEL_MAX_X && /[a-zá-ž]{3}/i.test(c.text) && !parseDims(c.text) && parseCm(c.text) === null;
  const labels = rows.filter((r) => isLabel(r.cells[0]));
  const limits = {};
  for (const r of rows) {
    const values = r.cells.filter((c) => !isLabel(c));
    if (!values.length) continue;
    const owner = labels
      .filter((l) => l.page === r.page)
      .reduce((best, l) => (!best || Math.abs(l.y - r.y) < Math.abs(best.y - r.y) ? l : best), null);
    if (!owner || Math.abs(owner.y - r.y) > ROW_GROUP_GAP) continue;
    const label = owner.cells[0].text;
    for (const v of values) applyLimit(limits, label, v.text, profile);
  }
  return limits;
}

function applyLimit(limits, label, value, profile) {
  const L = profile.limits;
  const byWeight = /^(.+?)\s*[-–]\s*zásielky do\s+(\d+(?:[.,]\d+)?)\s*kg/i.exec(value);
  const base = byWeight ? byWeight[1] : value;
  const upToKg = byWeight ? toNumber(byWeight[2]) : null;
  const cat = L.sizeCategory.exec(label);
  const dimsForWeight = /rozmery zásielky do\s+(\d+(?:[.,]\d+)?)\s*kg/i.exec(label);
  if (cat) (limits.sizeCategories ??= []).push({ code: cat[1], dimsCm: parseDims(value) });
  else if (dimsForWeight) (limits.byWeight ??= []).push({ maxKg: toNumber(dimsForWeight[1]), maxDimsCm: parseDims(value) });
  else if (L.maxWeightKg.test(label)) limits.maxWeightKg ??= parseKg(value);
  else if (L.minDimsCm.test(label)) limits.minDimsCm ??= parseDims(value);
  else if (L.maxSideCm.test(label) || L.maxSumCm.test(label)) {
    const key = L.maxSideCm.test(label) ? 'maxSideCm' : 'maxSumCm';
    const cm = parseCm(base);
    if (upToKg === null) limits[key] ??= cm;
    else {
      (limits.byWeight ??= []).push({ maxKg: upToKg, [key]: cm });
      limits[key] = Math.max(limits[key] ?? 0, cm);
    }
  }
}

// Other priced items inside a service (risk surcharge, air surcharge, island delivery, ...).
function parseFeeBlock(rows, profile) {
  const [heading, ...rest] = rows;
  const labelParts = [heading.cells[0].text];
  const fee = { code: null, label: null, amount: null, currency: null, pct: null, byWeight: null, note: null, description: null };
  const description = [];
  let prevY = heading.y;
  for (const r of rest) {
    const left = r.cells[0].x < LABEL_MAX_X ? r.cells[0] : null;
    const weight = left ? profile.weightRow.exec(left.text) : null;
    const values = r.cells.filter((c) => c.x >= 300 && !profile.tableHeaderCell.test(c.text));
    if (weight) {
      const money = values.map((v) => parseMoney(v.text)).find(Boolean);
      if (money) (fee.byWeight ??= []).push({ maxKg: toNumber(weight[1]), amount: money.amount });
      continue;
    }
    for (const v of values) {
      const money = parseMoney(v.text);
      const pct = parsePct(v.text);
      if (money && fee.amount === null) Object.assign(fee, { amount: money.amount, currency: money.currency });
      else if (profile.included.test(v.text) && fee.amount === null) Object.assign(fee, { amount: 0, included: true });
      else if (pct !== null && fee.pct === null) fee.pct = pct;
      else if (/^\(.*\)$/.test(v.text)) fee.note = v.text.slice(1, -1);
    }
    const text = r.cells.filter((c) => c.x < 300).map((c) => c.text).join(' ');
    if (text) {
      const continuesLabel = !description.length && r.page === heading.page && prevY - r.y < 11 && !/^(Uplatňuje|\()/.test(text);
      (continuesLabel ? labelParts : description).push(text);
    }
    prevY = r.y;
  }
  fee.label = labelParts.join(' ');
  const known = profile.feeCodes?.find(([re]) => re.test(fee.label));
  fee.code = known ? known[1] : slug(heading.cells[0].text.replace(/\(.*$/, ''));
  fee.description = description.join(' ') || null;
  if (fee.byWeight) fee.currency ??= 'EUR';
  return fee;
}

// ---------------------------------------------------------------------------------------------
// Sections 4-7

function parseReturns(lines, profile) {
  const prices = [];
  for (const l of lines) {
    const iso = profile.countries[l.cells[0]?.text];
    const money = l.cells.map((c) => parseMoney(c.text)).find(Boolean);
    if (iso && money) prices.push({ fromCountry: iso, price: money.amount, currency: money.currency });
  }
  const limitStart = lines.findIndex((l) => profile.blocks.limits.test(l.cells[0]?.text ?? ''));
  const limits = limitStart >= 0 ? parseLimits(lines.slice(limitStart + 1, limitStart + 8), profile) : {};
  return { limits, prices };
}

function parseSurcharges(lines, profile) {
  const dieselTable = [];
  let above = null;
  let toll = null;
  const notes = [];
  let inToll = false;
  for (const l of lines) {
    const cells = l.cells.map((c) => c.text);
    if (profile.tollHeading.test(cells[0])) inToll = true;
    const eur = cells.map((t) => parseMoney(t)).filter((m) => m && m.currency === 'EUR');
    const pct = cells.map((t) => parsePct(t)).find((p) => p !== null);
    if (!inToll && eur.length === 2 && pct !== undefined) {
      dieselTable.push({ fromEurPer1000l: eur[0].amount, toEurPer1000l: eur[1].amount, pct });
      continue;
    }
    const aboveMatch = profile.fuelAbove.exec(l.text);
    const step = profile.fuelStep.exec(l.text);
    if (aboveMatch && step) {
      above = { fromEurPer1000l: toNumber(aboveMatch[1]), stepPct: toNumber(step[1]), perEur: Number(step[2]) };
      continue;
    }
    if (inToll && eur.length && toll === null) toll = { perStartedKg: eur[0].amount, currency: 'EUR' };
    if (l.cells[0].x < LEFT_EDGE && l.text.length > 60) notes.push(l.text);
  }
  return {
    fuel: { currentPct: null, month: null, sourceUrl: null, basis: 'base-price', dieselTable, above },
    toll,
    notes: notes.join(' ') || null,
  };
}

// Fees (§6) and penalties (§7): a two-column table whose rows are separated by vertical gaps.
function parseItemTable(lines, profile) {
  const start = lines.findIndex((l) => l.cells.some((c) => profile.tableHeaderCell.test(c.text)));
  const body = start >= 0 ? lines.slice(start + 1) : [];
  const groups = [];
  for (const l of body) {
    const prev = groups.at(-1)?.at(-1);
    if (prev && prev.page === l.page && prev.y - l.y < ROW_GROUP_GAP) groups.at(-1).push(l);
    else groups.push([l]);
  }
  const items = groups
    .map((g) => {
      const cells = g.flatMap((l) => l.cells);
      const label = cells.filter((c) => c.x < 300).map((c) => c.text).join(' ').replace(/(\S)- (\S)/g, '$1-$2');
      const money = cells.filter((c) => c.x >= 300).map((c) => parseMoney(c.text)).find(Boolean);
      if (!money) return null;
      const unit = profile.unit?.exec(label)?.[1]?.trim() ?? null;
      const name = profile.unit ? label.replace(profile.unit, '').trim() : label;
      const detail = /\(([^)]*)\)/.exec(name)?.[1];
      const known = profile.feeCodes?.find(([re]) => re.test(label));
      const code = known ? known[1] : slug(name.replace(/\(.*$/, ''));
      return { code, detail: known ? null : detail, label: name, amount: money.amount, currency: money.currency, unit };
    })
    .filter(Boolean)
    .map((item, i, all) => {
      // Same name twice (e.g. four customs items): tell them apart by their bracketed detail.
      if (item.detail && all.some((o, j) => j !== i && o.code === item.code)) item.code = slug(`${item.code} ${item.detail}`);
      delete item.detail;
      return item;
    });
  return uniqueCodes(items);
}
