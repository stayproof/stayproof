/**
 * Currency detection for StayProof.
 *
 * Detects the user's local currency via the browser Intl API.
 * Falls back to USD when the locale is ambiguous.
 *
 * This file intentionally uses `var` (no const/let) for broad
 * compatibility — it runs in both service worker and content script
 * contexts, matching the convention of scoring.js and name-matching.js.
 */

// Region → currency code lookup (~40 entries covering 95%+ of users)
var CURRENCY_MAP = {
  // North America
  US: 'USD', CA: 'CAD',
  // Europe
  GB: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR',
  BE: 'EUR', AT: 'EUR', IE: 'EUR', PT: 'EUR', GR: 'EUR', FI: 'EUR',
  DK: 'DKK', SE: 'SEK', NO: 'NOK', CH: 'CHF', PL: 'PLN', CZ: 'CZK',
  HU: 'HUF', RO: 'RON', HR: 'EUR', SK: 'EUR', SI: 'EUR', LT: 'EUR',
  LV: 'EUR', EE: 'EUR', BG: 'BGN', RS: 'RSD',
  // Asia-Pacific
  AU: 'AUD', NZ: 'NZD', JP: 'JPY', KR: 'KRW', CN: 'CNY', HK: 'HKD',
  SG: 'SGD', MY: 'MYR', TH: 'THB', ID: 'IDR', PH: 'PHP', VN: 'VND',
  IN: 'INR', TW: 'TWD', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR',
  // Middle East
  AE: 'AED', SA: 'SAR', IL: 'ILS', QA: 'QAR', OM: 'OMR', KW: 'KWD',
  BH: 'BHD', TR: 'TRY',
  // Africa
  ZA: 'ZAR', NG: 'NGN', KE: 'KES', EG: 'EGP', MA: 'MAD',
  // South America
  BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  // Central America / Caribbean
  MX: 'MXN', CR: 'CRC', PA: 'PAD',
};

// IANA timezone → currency for locale fallback when navigator.language
// has no region subtag (e.g. just 'en' or 'fr').
var TIMEZONE_CURRENCY_MAP = {
  // Europe
  'Europe/London': 'GBP', 'Europe/Paris': 'EUR', 'Europe/Berlin': 'EUR',
  'Europe/Madrid': 'EUR', 'Europe/Rome': 'EUR', 'Europe/Amsterdam': 'EUR',
  'Europe/Brussels': 'EUR', 'Europe/Vienna': 'EUR', 'Europe/Stockholm': 'SEK',
  'Europe/Oslo': 'NOK', 'Europe/Copenhagen': 'DKK', 'Europe/Warsaw': 'PLN',
  'Europe/Prague': 'CZK', 'Europe/Budapest': 'HUF', 'Europe/Bucharest': 'RON',
  'Europe/Zurich': 'CHF', 'Europe/Istanbul': 'TRY', 'Europe/Moscow': 'RUB',
  'Europe/Helsinki': 'EUR', 'Europe/Lisbon': 'EUR', 'Europe/Dublin': 'EUR',
  'Europe/Athens': 'EUR',
  // Asia-Pacific
  'Asia/Tokyo': 'JPY', 'Asia/Seoul': 'KRW', 'Asia/Shanghai': 'CNY',
  'Asia/Hong_Kong': 'HKD', 'Asia/Taipei': 'TWD', 'Asia/Singapore': 'SGD',
  'Asia/Kuala_Lumpur': 'MYR', 'Asia/Bangkok': 'THB', 'Asia/Jakarta': 'IDR',
  'Asia/Ho_Chi_Minh': 'VND', 'Asia/Manila': 'PHP', 'Asia/Kolkata': 'INR',
  'Asia/Dubai': 'AED', 'Asia/Riyadh': 'SAR', 'Asia/Doha': 'QAR',
  'Asia/Kuwait': 'KWD', 'Asia/Muscat': 'OMR', 'Asia/Bahrain': 'BHD',
  'Asia/Tehran': 'IRR', 'Asia/Kathmandu': 'NPR', 'Asia/Dhaka': 'BDT',
  'Asia/Karachi': 'PKR', 'Asia/Colombo': 'LKR',
  // North America
  'America/New_York': 'USD', 'America/Chicago': 'USD', 'America/Denver': 'USD',
  'America/Los_Angeles': 'USD', 'America/Toronto': 'CAD', 'America/Vancouver': 'CAD',
  'America/Montreal': 'CAD', 'America/Mexico_City': 'MXN',
  // South America
  'America/Sao_Paulo': 'BRL', 'America/Argentina/Buenos_Aires': 'ARS',
  'America/Santiago': 'CLP', 'America/Lima': 'PEN', 'America/Bogota': 'COP',
  // Africa
  'Africa/Johannesburg': 'ZAR', 'Africa/Lagos': 'NGN', 'Africa/Nairobi': 'KES',
  'Africa/Cairo': 'EGP', 'Africa/Casablanca': 'MAD',
  // Oceania
  'Australia/Sydney': 'AUD', 'Australia/Melbourne': 'AUD', 'Australia/Perth': 'AUD',
  'Australia/Brisbane': 'AUD', 'Pacific/Auckland': 'NZD',
};

var DEFAULT_CURRENCY = 'USD';

// Curated symbols and names for every currency CURRENCY_MAP can return.
// Single source of truth — search.html dropdown, getCurrencySymbol(), Top Picks,
// map popups all read from here. A parity test (tests/currency.test.js) asserts
// every CURRENCY_MAP value has matching entries below; CI fails if drift creeps in.
var CURRENCY_SYMBOLS = {
  USD: '$',   EUR: '€',   GBP: '£',   JPY: '¥',   AUD: 'A$',
  CAD: 'C$',  CHF: 'Fr',  CNY: '¥',   HKD: 'HK$', SGD: 'S$',
  KRW: '₩',   TWD: 'NT$', THB: '฿',   IDR: 'Rp',  MYR: 'RM',
  PHP: '₱',   VND: '₫',   INR: '₹',   PKR: '₨',   BDT: '৳',
  LKR: 'Rs',  NPR: 'Rs',  NZD: 'NZ$', DKK: 'kr',  SEK: 'kr',
  NOK: 'kr',  PLN: 'zł',  CZK: 'Kč',  HUF: 'Ft',  RON: 'lei',
  BGN: 'лв',  RSD: 'дин', AED: 'د.إ', SAR: '﷼',   ILS: '₪',
  QAR: 'QR',  OMR: 'OR',  KWD: 'د.ك', BHD: 'BD',  TRY: '₺',
  ZAR: 'R',   NGN: '₦',   KES: 'KSh', EGP: 'E£',  MAD: 'د.م',
  BRL: 'R$',  ARS: 'AR$', CLP: 'CL$', COP: 'CO$', PEN: 'S/',
  MXN: 'MX$', CRC: '₡',   PAD: 'B/.', RUB: '₽',   IRR: '﷼',
};

var CURRENCY_NAMES = {
  USD: 'US Dollar',           EUR: 'Euro',                GBP: 'British Pound',
  JPY: 'Japanese Yen',        AUD: 'Australian Dollar',   CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',         CNY: 'Chinese Yuan',        HKD: 'Hong Kong Dollar',
  SGD: 'Singapore Dollar',    KRW: 'South Korean Won',    TWD: 'Taiwan Dollar',
  THB: 'Thai Baht',           IDR: 'Indonesian Rupiah',   MYR: 'Malaysian Ringgit',
  PHP: 'Philippine Peso',     VND: 'Vietnamese Dong',     INR: 'Indian Rupee',
  PKR: 'Pakistani Rupee',     BDT: 'Bangladeshi Taka',    LKR: 'Sri Lankan Rupee',
  NPR: 'Nepalese Rupee',      NZD: 'New Zealand Dollar',  DKK: 'Danish Krone',
  SEK: 'Swedish Krona',       NOK: 'Norwegian Krone',     PLN: 'Polish Zloty',
  CZK: 'Czech Koruna',        HUF: 'Hungarian Forint',    RON: 'Romanian Leu',
  BGN: 'Bulgarian Lev',       RSD: 'Serbian Dinar',       AED: 'UAE Dirham',
  SAR: 'Saudi Riyal',         ILS: 'Israeli Shekel',      QAR: 'Qatari Riyal',
  OMR: 'Omani Rial',          KWD: 'Kuwaiti Dinar',       BHD: 'Bahraini Dinar',
  TRY: 'Turkish Lira',        ZAR: 'South African Rand',  NGN: 'Nigerian Naira',
  KES: 'Kenyan Shilling',     EGP: 'Egyptian Pound',      MAD: 'Moroccan Dirham',
  BRL: 'Brazilian Real',      ARS: 'Argentine Peso',      CLP: 'Chilean Peso',
  COP: 'Colombian Peso',      PEN: 'Peruvian Sol',        MXN: 'Mexican Peso',
  CRC: 'Costa Rican Colón',   PAD: 'Panamanian Balboa',  RUB: 'Russian Ruble',
  IRR: 'Iranian Rial',
};

/**
 * Detect the user's local currency from browser locale.
 * Returns a 3-letter currency code (e.g. 'GBP', 'JPY').
 */
function detectCurrency() {
  try {
    var lang = navigator.language;
    if (lang) {
      var locale = new Intl.Locale(lang);
      var region = locale.region;
      if (region && CURRENCY_MAP[region]) {
        return CURRENCY_MAP[region];
      }
    }
    // No region in language tag — try timezone as fallback
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TIMEZONE_CURRENCY_MAP[tz]) {
      return TIMEZONE_CURRENCY_MAP[tz];
    }
  } catch (_) {
    // Intl not supported or other error — fall through
  }
  return DEFAULT_CURRENCY;
}

/**
 * Get the currency symbol for display.
 *
 * Consults the curated CURRENCY_SYMBOLS map first — Intl.NumberFormat returns
 * locale-dependent symbols (e.g. 'IDR' instead of 'Rp' in en-GB), so the static
 * map gives consistent output regardless of the user's browser locale. Falls
 * back to Intl.NumberFormat for codes not in the map, then to the code itself.
 */
function getCurrencySymbol(currencyCode) {
  if (!currencyCode) return '$';
  if (CURRENCY_SYMBOLS[currencyCode]) return CURRENCY_SYMBOLS[currencyCode];
  try {
    var fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode });
    var parts = fmt.formatToParts(0);
    for (var i = 0; i < parts.length; i++) {
      // '¤' is Intl's generic currency placeholder for unknown codes — return
      // the code itself rather than that confusing glyph.
      if (parts[i].type === 'currency' && parts[i].value !== '¤') return parts[i].value;
    }
  } catch (_) {
    // fall through
  }
  return currencyCode;
}

/**
 * Get the currency display name (e.g. 'Indonesian Rupiah').
 * Falls back to the currency code itself if not in the map.
 */
function getCurrencyName(currencyCode) {
  if (!currencyCode) return '';
  return CURRENCY_NAMES[currencyCode] || currencyCode;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CURRENCY_MAP,
    TIMEZONE_CURRENCY_MAP,
    CURRENCY_SYMBOLS,
    CURRENCY_NAMES,
    DEFAULT_CURRENCY,
    detectCurrency,
    getCurrencySymbol,
    getCurrencyName,
  };
}
