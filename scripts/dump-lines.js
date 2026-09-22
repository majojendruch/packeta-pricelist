// Prints the positioned lines the parser sees - the main tool when adding a new source or fixing a table.
// Usage: node scripts/dump-lines.js <pdf> [fromPage] [toPage]
import fs from 'node:fs';
import { readLines } from '../src/pdf/layout.js';

const [file, from = 1, to = 999] = process.argv.slice(2);
const lines = await readLines(fs.readFileSync(file));
for (const l of lines) {
  if (l.page < +from || l.page > +to) continue;
  console.log(`p${l.page} y${l.y}\t` + l.cells.map((c) => `[${c.x}] ${c.text}`).join('  |  '));
}
