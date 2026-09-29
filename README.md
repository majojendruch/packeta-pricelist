# packeta-pricelist

**Packeta (SK) price lists as clean, versioned JSON** – every destination and every delivery mode, updated automatically.

> **Unofficial.** This project is not affiliated with or endorsed by Packeta / Zásilkovna. Prices are copied from the publicly available price list PDFs and may contain errors. Every file links to its source PDF (with a SHA-256 fingerprint) — always treat the PDF as authoritative. See [DISCLAIMER.md](DISCLAIMER.md).

Packeta has no API for prices; they are only published as a 100+ page PDF. This project reads that PDF every day and publishes it as data, so e-shops can show correct shipping prices without typing tables by hand.

## What you get

A free static API (GitHub Pages, CORS enabled, no key, no rate limit beyond GitHub's):

| URL (relative to `https://majojendruch.github.io/packeta-pricelist/v1/`) | Content |
|---|---|
| `index.json` | Sources, current valid-from date, all versions, current fuel surcharge |
| `sk/latest.json` | The price list valid **today** (current fuel % filled in) |
| `sk/upcoming.json` | A published list that is not valid yet (only exists while there is one) |
| `sk/2026-09-01.json` | Any archived version, by valid-from date |
| `sk/home/DE.json` | Small slice: one delivery mode, one destination country |
| `sk/latest.csv`, `sk/latest-excel.csv` | One row per service and weight band (`-excel` = `;` and decimal commas for SK/CZ Excel) |
| `schema/pricelist.schema.json` | The format of the full price list (JSON Schema) |
| `schema/slice.schema.json` | The format of a per-country slice |

Delivery modes in the slice paths: `home`, `packeta-pickup-point` (Z-POINT), `packeta-box` (Z-BOX), `partner-pickup-point`, `partner-box`.

A **slice** holds `source`, `surcharges` and the `services` of that one mode and country — everything needed to price a parcel, in a few kilobytes. Returns, general fees and penalties live only in the full price list.

### Example

```js
const res = await fetch('https://majojendruch.github.io/packeta-pricelist/v1/sk/home/DE.json');
const { services, surcharges } = await res.json();
const tier = services[0].tiers.find((t) => t.maxKg >= 3); // first weight band that fits 3 kg
console.log(services[0].carrierName, tier.price.depot, services[0].currency); // "Doručenie na adresu" 7.82 "EUR"
```

A service looks like this (shortened):

```json
{
  "id": "home:DE:13613",
  "mode": "HOME",
  "destination": "DE",
  "carrierIds": [13613],
  "carrierName": "Doručenie na adresu",
  "leadTimeDays": { "min": 2, "max": 2 },
  "currency": "EUR",
  "tiers": [{ "maxKg": 1, "variant": null, "price": { "depot": 6.92, "zpoint": 7.32 } }, "…"],
  "cod": { "available": true, "max": { "amount": 700, "currency": "EUR" }, "tiers": [{ "upTo": { "amount": 700, "currency": "EUR" }, "fee": 6.2 }] },
  "insurance": { "max": { "amount": 700, "currency": "EUR" }, "tiers": ["…"] },
  "limits": { "maxWeightKg": 15, "minDimsCm": [10, 7, 1], "maxSideCm": 120, "maxSumCm": 150 },
  "fees": [{ "code": "island_delivery", "amount": 8.5, "currency": "EUR" }, "…"]
}
```

`carrierIds` are the same ids the Packeta API uses, so you can join prices to your shipments. Full field reference: [the schema](schema/pricelist.schema.json).

## How a shipping price is made up

All prices **exclude VAT**.

1. **Base price** — the first weight band (`tiers[].maxKg`) that fits the parcel. `depot` = handed in at a Packeta depot, `zpoint` = handed in at a Z-POINT. Some carriers bill the higher of real and volumetric weight (`volumetric.divisor`, e.g. L×W×H / 5000).
2. **Fuel surcharge** — `surcharges.fuel.currentPct` % of the base price (changes monthly).
3. **Toll surcharge** — `surcharges.toll.perStartedKg` × every started kilogram.
4. **Optional:** cash on delivery (`cod.tiers`), insurance above the included amount (`insurance.tiers`), carrier extras (`fees`, e.g. signature, island delivery).

Example, DE home delivery, 3 kg, depot, no COD: 7.82 + 18.5 % × 7.82 + 3 × 0.04 = **9.39 € excl. VAT**.

Fuel and toll are added for Packeta's own network (Z-POINT, Z-BOX, home delivery); for some partner carriers they are already included — see `surcharges.notes`.

## How updates work

Every day a GitHub Action:

1. reads Packeta's pricing page and finds the newest linked price list PDF (Packeta keeps old files linked, so the newest file wins),
2. downloads it **only** when its file stamp changed (one small request per day otherwise),
3. parses it and runs the **quality checks** (data format, weight bands in order, prices never dropping with weight, no suddenly missing services, …),
4. opens a **pull request** with a plain-language change report ("DE home 1 kg: 6.92 → 7.10 €"). A maintainer merges it, and the API is republished.

If a new PDF fails the checks, nothing is published — the old prices stay live and an issue is opened.

## Use it with your own contract price list

Negotiated prices with Packeta? Parse your own PDF locally; nothing is uploaded anywhere:

```bash
npx packeta-pricelist parse my-contract.pdf --out prices.json --csv prices.csv --excel-csv
```

(Until the npm package is published: clone this repo, `npm ci`, then `node bin/cli.js parse …`.)

## Stability promise

- URLs under `/v1/` and the v1 schema only ever **gain** optional fields. Anything breaking goes to `/v2/`, and `/v1/` keeps working for at least 6 months after that.
- Service ids (`home:DE:13613`) and fee codes (`signature`, `air_surcharge`, …) are stable.
- Every version is archived by its valid-from date, together with the source PDF, in [`data/`](data/).

## Coverage and limits

- **Now:** price list of Packeta Slovakia (sending from Slovakia, prices in EUR). **Planned:** Zásilkovna CZ (sending from Czechia, CZK).
- Prices are the **public list prices**. Contract prices can differ.
- The current fuel % is read from Packeta's website; archived versions do not carry a fuel %.

## Development

```bash
npm ci
npm test                                   # parser golden tests, quality checks, change report
node bin/cli.js parse test/fixtures/sk/2026-09-01.pdf --out /tmp/sk.json
node scripts/dump-lines.js file.pdf 13 14  # show the positioned text lines the parser sees (pages 13–14)
node scripts/update.js --data /tmp/data    # what the daily job does, into a scratch folder
node scripts/build-api.js --data data --out dist
```

How it works inside: `src/pdf/layout.js` turns the PDF into text lines with coordinates, `src/i18n/sk.js` holds every Slovak-language pattern, `src/parse/pricelist.js` turns lines into data, `src/validate/` is the quality gate. Adding a country or language means a new profile in `src/i18n/` plus an entry in `src/sources/registry.js` and test fixtures — no changes to the parser core.

## License

Code: [MIT](LICENSE). The price data belongs to its publisher; it is republished here as public commercial information with a link to the source.
