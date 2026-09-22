// Compares two price lists and explains the differences, for the pull-request change report.

const BIG_CHANGE_PCT = 15;
const tierKey = (t) => `${t.maxKg}|${t.variant ?? ''}`;
const tierLabel = (t) => `≤ ${t.maxKg} kg${t.variant ? ` (${t.variant})` : ''}`;
const pct = (from, to) => (from ? Math.round(((to - from) / from) * 1000) / 10 : null);

/**
 * @param {object} before previous price list (may be null for the first version)
 * @param {object} after new price list
 */
export function diffPriceLists(before, after) {
  const old = new Map((before?.services ?? []).map((s) => [s.id, s]));
  const now = new Map(after.services.map((s) => [s.id, s]));
  const diff = {
    from: before?.source?.validFrom ?? null,
    to: after.source.validFrom,
    addedServices: [],
    removedServices: [],
    priceChanges: [],
    serviceChanges: [],
    itemChanges: [],
  };

  for (const [id, s] of now) if (!old.has(id)) diff.addedServices.push({ id, title: s.title });
  for (const [id, s] of old) if (!now.has(id)) diff.removedServices.push({ id, title: s.title });

  for (const [id, b] of now) {
    const a = old.get(id);
    if (!a) continue;
    const aTiers = new Map(a.tiers.map((t) => [tierKey(t), t]));
    for (const t of b.tiers) {
      const prev = aTiers.get(tierKey(t));
      if (!prev) {
        diff.serviceChanges.push({ id, what: `new weight tier ${tierLabel(t)}: ${t.price.depot} ${b.currency}` });
        continue;
      }
      for (const field of ['depot', 'zpoint']) {
        const from = prev.price[field];
        const to = t.price[field];
        if (from !== to && from !== undefined && to !== undefined) {
          diff.priceChanges.push({ id, tier: tierLabel(t), field, from, to, pct: pct(from, to), currency: b.currency });
        }
      }
    }
    for (const t of a.tiers) if (!b.tiers.some((x) => tierKey(x) === tierKey(t))) diff.serviceChanges.push({ id, what: `weight tier ${tierLabel(t)} removed` });
    if (a.suspended !== b.suspended) diff.serviceChanges.push({ id, what: b.suspended ? 'delivery suspended' : 'delivery resumed' });
    if (JSON.stringify(a.leadTimeDays) !== JSON.stringify(b.leadTimeDays)) diff.serviceChanges.push({ id, what: `delivery time ${days(a.leadTimeDays)} → ${days(b.leadTimeDays)}` });
    if (a.cod.available !== b.cod.available) diff.serviceChanges.push({ id, what: b.cod.available ? 'cash on delivery now offered' : 'cash on delivery no longer offered' });
    compareAmounts(`${id} COD`, feesOf(a.cod.tiers), feesOf(b.cod.tiers), diff.serviceChanges, id);
    compareAmounts(`${id} insurance`, feesOf(a.insurance.tiers), feesOf(b.insurance.tiers), diff.serviceChanges, id);
    compareAmounts(`${id} fee`, byCode(a.fees), byCode(b.fees), diff.serviceChanges, id);
  }

  if (before) {
    compareAmounts('fee', byCode(before.fees), byCode(after.fees), diff.itemChanges);
    compareAmounts('penalty', byCode(before.penalties), byCode(after.penalties), diff.itemChanges);
    compareAmounts('return from', byKey(before.returns.prices, 'fromCountry', 'price'), byKey(after.returns.prices, 'fromCountry', 'price'), diff.itemChanges);
    compareAmounts('toll per kg', { toll: before.surcharges.toll?.perStartedKg }, { toll: after.surcharges.toll?.perStartedKg }, diff.itemChanges);
    const [fa, fb] = [before.surcharges.fuel, after.surcharges.fuel];
    if (fa.currentPct !== fb.currentPct && fb.currentPct !== null) {
      diff.itemChanges.push({ what: `fuel surcharge ${fa.currentPct ?? '?'} % → ${fb.currentPct} % (${fb.month})` });
    }
  }
  diff.priceChanges.sort((x, y) => Math.abs(y.pct ?? 0) - Math.abs(x.pct ?? 0));
  diff.hasChanges = ['addedServices', 'removedServices', 'priceChanges', 'serviceChanges', 'itemChanges'].some((k) => diff[k].length);
  return diff;
}

const days = (d) => (d ? (d.min === d.max ? `D+${d.min}` : `D+${d.min}–${d.max}`) : '?');
const feesOf = (tiers) => Object.fromEntries(tiers.map((t) => [`up to ${t.upTo.amount} ${t.upTo.currency}`, t.fee ?? t.feePct]));
const byCode = (items) => Object.fromEntries((items ?? []).map((i) => [i.code, i.amount]));
const byKey = (items, key, value) => Object.fromEntries((items ?? []).map((i) => [i[key], i[value]]));

function compareAmounts(prefix, a, b, out, id) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue;
    const what = a[k] === undefined ? `${prefix} ${k} added: ${b[k]}` : b[k] === undefined ? `${prefix} ${k} removed` : `${prefix} ${k}: ${a[k]} → ${b[k]}`;
    out.push(id ? { id, what: what.replace(`${id} `, '') } : { what });
  }
}

/** Plain-language Markdown report (used as the pull request description). */
export function diffToMarkdown(diff, { sourceName = '', maxRows = 60 } = {}) {
  const out = [];
  const head = diff.from ? `Price list ${sourceName} valid from **${diff.to}** (previous: ${diff.from})` : `First price list ${sourceName} valid from **${diff.to}**`;
  out.push(`## ${head}`, '');
  if (!diff.hasChanges) return [...out, 'No price changes.'].join('\n');

  const big = diff.priceChanges.filter((c) => Math.abs(c.pct ?? 0) >= BIG_CHANGE_PCT);
  out.push('### Summary', '');
  out.push(`- ${diff.priceChanges.length} price changes${big.length ? ` (**${big.length} by ${BIG_CHANGE_PCT} % or more** – please check these against the PDF)` : ''}`);
  out.push(`- ${diff.addedServices.length} new services, ${diff.removedServices.length} removed services`);
  out.push(`- ${diff.serviceChanges.length} other service changes, ${diff.itemChanges.length} changes to fees, returns and surcharges`, '');

  if (diff.addedServices.length) out.push('### New services', '', ...diff.addedServices.map((s) => `- ${s.title}`), '');
  if (diff.removedServices.length) out.push('### Removed services', '', ...diff.removedServices.map((s) => `- ${s.title}`), '');
  if (diff.priceChanges.length) {
    out.push('### Price changes (biggest first)', '', '| Service | Weight | Hand-in | Old | New | Change |', '|---|---|---|---|---|---|');
    for (const c of diff.priceChanges.slice(0, maxRows)) {
      const flag = Math.abs(c.pct ?? 0) >= BIG_CHANGE_PCT ? ' ⚠️' : '';
      out.push(`| ${c.id} | ${c.tier} | ${c.field} | ${c.from} | ${c.to} | ${c.pct > 0 ? '+' : ''}${c.pct} %${flag} |`);
    }
    if (diff.priceChanges.length > maxRows) out.push('', `…and ${diff.priceChanges.length - maxRows} more (see the JSON diff in this pull request).`);
    out.push('');
  }
  if (diff.serviceChanges.length) out.push('### Other service changes', '', ...diff.serviceChanges.slice(0, maxRows).map((c) => `- ${c.id}: ${c.what}`), '');
  if (diff.itemChanges.length) out.push('### Fees, returns and surcharges', '', ...diff.itemChanges.map((c) => `- ${c.what}`), '');
  return out.join('\n');
}
