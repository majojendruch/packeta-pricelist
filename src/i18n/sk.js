// Language profile: Slovak price list published by Packeta Slovakia.
// A profile holds every language-specific pattern, so the parser core stays language-neutral.

export default {
  language: 'sk',

  validFrom: /(?:Účinnosť|Platnosť) od (\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/,
  footer: /^Strana \d+ z \d+$/,

  // Section headings "2. Doručenie zásielok kuriérom na adresu ..." -> section kind
  sections: [
    { kind: 'packeta', match: /Z-POINT|Z-BOX/i },
    { kind: 'home', match: /na adresu/i },
    { kind: 'partner', match: /PICK-UP/i },
    { kind: 'returns', match: /vratiek/i },
    { kind: 'surcharges', match: /^Príplatky/i },
    { kind: 'fees', match: /^Poplatky/i },
    { kind: 'penalties', match: /^Pokuty/i },
  ],

  // Subsections inside a delivery section (older layout, e.g. 16.2.2026)
  subsections: { fees: /^Poplatky k zásielke/i, surcharges: /^Príplatky k zásielke/i },

  serviceHeader:
    /^(?<country>[^:]{3,40}):\s+(?<iso>[A-Z]{2})\s+(?<name>.+?)(?:\s*\(ID dopravcu:?\s*(?<ids>[^)]*)\))?(?<rest>\s+[-–]\s.*)?$/,
  suspended: /pozastaven/i,
  leadTime: /^Lehota dodania:?\s*D\s*\+\s*(\d+)(?:\s*až\s*D\s*\+\s*(\d+))?/i,
  footnote: /^\*\s*Depá|^\*\s*Depa/,
  notice: /^UPOZORNENIE/i,

  blocks: {
    price: /^Doručenie (?:na adresu|do Z-BOXu|do Z-POINTu|na výdajné miesta)/i,
    cod: /^Dobierka$/i,
    insurance: /^(?:Doplnkové )?Poistenie\b/i,
    cardPayment: /^Úhrada dobierky platobnou kartou/i,
    limits: /^Parametre (?:zásielky|vratiek)/i,
  },
  supplementary: /^Doplnkové/i, // optional extra insurance on top of the included one
  tableHeaderCell: /^(?:Cena bez DPH|kg\/cm|v % z )/i,

  priceColumns: {
    depot: /podaj na depe/i,
    zpoint: /podaj na Z-POINTE/i,
    maxCod: /^dobierky$/i,
    maxInsurance: /^poistenia$/i,
  },

  // Which intro table ("Parametre zásielok") applies to services without their own limits table.
  // table = index of the table in the section intro; columns = which weight columns of that table.
  defaults: {
    packeta: [{ table: 0, modes: ['PACKETA_PICKUP_POINT'] }, { table: 1, modes: ['PACKETA_BOX'] }],
    home: [{ table: 0, columns: [0, 1], carrier: /^(Packeta Home|Doručenie na adresu)$/ }, { table: 0, columns: [2, 3] }],
    partner: [{ table: 0 }],
  },

  weightRow: /do\s+(?:hmotnosti\s+)?(\d+(?:[.,]\d+)?)\s*kg(?:\s*[-–]\s*(?:kategória\s+)?(.+))?$/i,
  notOffered: /^neposkytuje sa$/i,
  included: /^v cene doru/i,
  notPossible: /nie je možná/i,

  limits: {
    maxWeightKg: /^Max(?:\.|imálna) hmotnosť zásielky/i,
    minDimsCm: /^Minimálne rozmery zásielky/i,
    maxSideCm: /^Maximálny rozmer jednej/i,
    maxSumCm: /^Maximálny súčet/i,
    sizeCategory: /^Kategória\s+(\w+):/i,
  },

  // Stable, language-independent codes for priced extras; unknown ones fall back to a slug of the label.
  feeCodes: [
    [/^Rizikový príplatok/i, 'risk_surcharge'],
    [/^Letecký príplatok/i, 'air_surcharge'],
    [/^Podpis/i, 'signature'],
    [/^Open\b/i, 'open_on_delivery'],
    [/^Test\b/i, 'test_on_delivery'],
    [/^Poplatok za osobitné spracovanie/i, 'special_handling'],
    [/^Poplatok za pozastavenie/i, 'delivery_hold'],
    [/^Poplatok za doručovanie na ostrovy/i, 'island_delivery'],
    [/^Poplatok za presmerovanie/i, 'redirection'],
    [/^Poplatok za odoslanie zásielky s obsahom/i, 'voc_content'],
    // general fees (§6)
    [/^Podaj zásielky na Z-POINTe/i, 'zpoint_handin'],
    [/^Preštítkovanie/i, 'relabelling'],
    [/^Overenie veku/i, 'age_verification'],
    [/^Skladovanie/i, 'storage_per_day'],
    [/^Nesystémová zásielka/i, 'non_system_parcel'],
    [/^Zásielka nespĺňajúca/i, 'nonconforming_parcel'],
    [/^Neaktuálny zoznam výdajných miest/i, 'outdated_pickup_point_list'],
    [/^Zastupovanie v colnom konaní \(cena za vystavenie/i, 'customs_declaration'],
    [/^Zastupovanie v colnom konaní \(cena za každú ďalšiu/i, 'customs_extra_item'],
    [/^Zastupovanie v colnom konaní \(zničenie/i, 'customs_destruction'],
    [/^Zastupovanie v colnom konaní \(tranzit/i, 'customs_return_transit'],
    // penalties (§7)
    [/^Zásielka vylúčená z prepravy/i, 'excluded_goods'],
    [/^Nevyžiadaná zásielka/i, 'unsolicited_parcel'],
    [/^Prvé omeškanie s úhradou/i, 'late_payment_first'],
    [/^Každé ďalšie omeškanie s úhradou/i, 'late_payment_repeat'],
    [/^Prvé zistené použitie neodsúhlasenej/i, 'unapproved_third_party_first'],
    [/^Každé ďalšie zistené použitie neodsúhlasenej/i, 'unapproved_third_party_repeat'],
    [/^Neoprávnené využitie osobitných cien/i, 'special_price_misuse'],
    [/^Neposkytnutie požadovanej súčinnosti/i, 'billing_cooperation_failure'],
  ],
  unit: /\((cena za [^)]+)\)/i, // "(cena za 1 zásielku)" in fee and penalty labels

  volumetricDivisor: /\/\s*(\d{4})\s*=\s*volumetrick/i,

  fuelRow: /% palivového/i,
  fuelAbove: /viac ako\s+([\d\s]+)\s*EUR/i,
  fuelStep: /([\d,]+)\s*%\s*za každých ďalších\s+(\d+)\s*EUR/i,
  tollHeading: /^Mýtny príplatok$/i,
  fuelHeading: /^Palivový príplatok$/i,

  // Destination names used in the returns table
  countries: {
    Slovensko: 'SK', 'Česká republika': 'CZ', Česko: 'CZ', Maďarsko: 'HU', Poľsko: 'PL', Rakúsko: 'AT',
    Nemecko: 'DE', Rumunsko: 'RO', Bulharsko: 'BG', Taliansko: 'IT', Francúzsko: 'FR', Slovinsko: 'SI',
    Lotyšsko: 'LV', Litva: 'LT', Estónsko: 'EE', Španielsko: 'ES', Portugalsko: 'PT', Chorvátsko: 'HR',
    Grécko: 'GR', Belgicko: 'BE', Holandsko: 'NL', Dánsko: 'DK', Fínsko: 'FI', Švédsko: 'SE',
    Luxembursko: 'LU', Írsko: 'IE', Cyprus: 'CY', Izrael: 'IL', Lichtenštajnsko: 'LI', Rusko: 'RU',
    'Spojené arabské emiráty': 'AE', Švajčiarsko: 'CH', Turecko: 'TR', Ukrajina: 'UA', USA: 'US',
    'Veľká Británia': 'GB', Malta: 'MT',
  },
};
