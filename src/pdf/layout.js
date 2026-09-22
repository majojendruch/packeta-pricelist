// Turns a PDF into positioned lines: pdf.js text items -> rows (by y) -> cells (by x).
// Everything downstream works on these lines, never on raw PDF bytes.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROW_TOLERANCE = 3.2; // items whose baselines differ less than this share a row
const CELL_GAP = 4.2; // horizontal gap (pt) below which neighbouring items belong to one cell

/**
 * @typedef {{ x: number, x2: number, text: string }} Cell
 * @typedef {{ page: number, y: number, cells: Cell[], text: string }} Line
 */

/** @param {Uint8Array | ArrayBuffer | Buffer} data */
export async function readLines(data) {
  const bytes = data instanceof Uint8Array && !(typeof Buffer !== 'undefined' && Buffer.isBuffer(data))
    ? data
    : new Uint8Array(data);
  const task = getDocument({ data: bytes, verbosity: 0, isEvalSupported: false });
  const doc = await task.promise;
  /** @type {Line[]} */
  const lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    lines.push(...pageLines(items, n));
    page.cleanup();
  }
  await task.destroy();
  return lines;
}

function pageLines(items, page) {
  const tokens = items
    .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
    .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, text: it.str }));

  // Group into rows, top of page first.
  tokens.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const t of tokens) {
    const row = rows.find((r) => Math.abs(r.y - t.y) < ROW_TOLERANCE);
    if (row) row.tokens.push(t);
    else rows.push({ y: t.y, tokens: [t] });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const cells = toCells(r.tokens.sort((a, b) => a.x - b.x));
      return { page, y: round(r.y), cells, text: cells.map((c) => c.text).join('  ') };
    });
}

function toCells(tokens) {
  /** @type {Cell[]} */
  const cells = [];
  for (const t of tokens) {
    const last = cells.at(-1);
    const gap = last ? t.x - last.x2 : Infinity;
    if (last && gap < CELL_GAP) {
      last.text += (gap > 1.2 && !/^[,.]/.test(t.text) && !last.text.endsWith(',') ? ' ' : '') + t.text;
      last.x2 = t.x + t.w;
    } else {
      cells.push({ x: round(t.x), x2: t.x + t.w, text: t.text });
    }
  }
  return cells.map((c) => ({ x: c.x, x2: round(c.x2), text: normalizeSpace(c.text) }));
}

const round = (n) => Math.round(n * 10) / 10;
export const normalizeSpace = (s) => s.replace(/[  \s]+/g, ' ').trim();
