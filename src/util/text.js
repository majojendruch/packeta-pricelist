// "Poplatok za doručovanie na ostrovy" -> "poplatok-za-dorucovanie-na-ostrovy" (cut at a word boundary)
export function slug(s, max = 48) {
  const full = String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (full.length <= max) return full;
  const cut = full.slice(0, max + 1);
  return cut.slice(0, cut.lastIndexOf('-') > 0 ? cut.lastIndexOf('-') : max);
}

/** Makes codes unique within one list: second "x" becomes "x-2". */
export function uniqueCodes(items) {
  const seen = new Map();
  for (const it of items) {
    const n = (seen.get(it.code) ?? 0) + 1;
    seen.set(it.code, n);
    if (n > 1) it.code = `${it.code}-${n}`;
  }
  return items;
}
