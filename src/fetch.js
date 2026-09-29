// Polite network access: per source and run, one pricing-page GET, one HEAD per linked price list,
// and a PDF download only when the file actually changed.

import { createHash } from 'node:crypto';

const contact = () =>
  process.env.CONTACT_URL ??
  (process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}` : 'local run');
export const userAgent = () => `packeta-pricelist-bot/1 (+${contact()}; checks once a day)`;

async function request(url, method = 'GET') {
  const res = await fetch(url, { method, redirect: 'follow', headers: { 'user-agent': userAgent() } });
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}`);
  return res;
}

export const getText = async (url) => (await request(url)).text();

/** File stamp without downloading: { url, etag, lastModified, size } */
export async function headFile(url) {
  const res = await request(url, 'HEAD');
  return {
    url,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    size: Number(res.headers.get('content-length')) || null,
  };
}

/**
 * Downloads a file: { bytes, sha256 }.
 * A short read is rejected: a truncated PDF can still parse and would publish half a price list.
 */
export async function downloadFile(url, expectedSize = null) {
  const res = await request(url);
  const promised = Number(res.headers.get('content-length')) || expectedSize;
  const bytes = Buffer.from(await res.arrayBuffer());
  assertCompletePdf(bytes, promised, url);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Rejects a short read or a file that is not a PDF. */
export function assertCompletePdf(bytes, promisedSize, url) {
  if (promisedSize && bytes.length !== promisedSize) throw new Error(`incomplete download of ${url}: got ${bytes.length} of ${promisedSize} bytes`);
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`${url} is not a PDF`);
}

/**
 * Finds the current price list PDF.
 * "fixed": one known URL. "newest-linked": every matching link on the pricing page, newest Last-Modified wins
 * (publishers leave old files linked, e.g. Packeta SK links both a 16.2.2026 and a 1.9.2026 list).
 */
export async function discoverPdf(discovery, pageHtml) {
  if (discovery.type === 'fixed') return headFile(discovery.url);
  const urls = [...new Set(pageHtml.match(discovery.link) ?? [])];
  if (!urls.length) throw new Error(`no price list link matching ${discovery.link} on ${discovery.page}`);
  const heads = await Promise.all(urls.map(headFile));
  return heads.sort((a, b) => Date.parse(b.lastModified ?? 0) - Date.parse(a.lastModified ?? 0))[0];
}

/**
 * Reads the current fuel surcharge from the pricing page.
 * @param {string} html
 * @param {{ url: string, pattern: RegExp }} fuel pattern groups: day, month, year, percent
 */
export function readFuel(html, { url, pattern }) {
  const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  const m = pattern.exec(text);
  if (!m) throw new Error(`fuel surcharge text not found on ${url}`);
  const [, d, mo, y, pct] = m;
  const month = `${y}-${mo.padStart(2, '0')}`;
  return { validFrom: `${month}-${d.padStart(2, '0')}`, month, pct: Number(pct.replace(',', '.')), sourceUrl: url };
}
