// -----------------------------------------------------------------------------
// The Tilt Pi API, ported from tilt-pi (michaelheyman/tilt-pi, MIT): one
// GET of `/macid/all` on the Tilt Pi, a JSON array with one entry per Tilt
// heard, `{ mac, Color, Temp, SG, ... }`. tilt-pi reads `Temp` as degrees
// Fahrenheit and `SG` as the specific gravity, the colour (title case) as
// the identity of the Tilt.
//
// Ported further, for this integration: the answer is bounded (size, number
// of entries), parsed once (JSON.parse is linear), every field read as an
// own field, numbers parsed strictly (an empty string is unknown, never 0),
// an unknown colour or a colour heard twice left out. The `timeStamp` (ms)
// the Tilt Pi adds to an entry dates the reading.
//
// Facts read in the official Tilt Pi Node-RED flow (baronbrew/TILTpi,
// flow.json, commit e2aeef6; no license, so nothing of it is copied): `Temp`
// is always °F (the display unit lives in `tempunits` / `displayTemp`), `SG`
// always a gravity, `timeStamp` always set, an answer without Tilt is `{}`,
// and the "ID by MAC" option writes `Color` as `RED:aa:bb:cc:dd:ee:ff`.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { COLORS, MAX_ENTRIES, ROUTE } from './constants.js';
import { NetworkError, getText } from './http.js';

/** Why a read failed: `failed`, `limited` (429), `busy` (5xx), `denied`, `notfound`, `invalid`. */
export class SourceError extends Error {
  constructor(kind, detail = kind, { retryAfterMs } = {}) {
    super(`Tilt Pi: ${detail}`);
    this.name = 'SourceError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

const own = (record, key) => (Object.hasOwn(record, key) ? record[key] : undefined);

/** A finite number, or a decimal string; anything else (`''`, null, `1e3`, NaN) is null. */
export function strictNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.length <= 32 && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

/** A Unix time in ms between 2015 and 2100, or null. */
function stampOf(value) {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,16}$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n >= 1_420_070_400_000 && n <= 4_102_444_800_000 ? n : null;
}

/** A short digest of an entry: tells a new reading from the same one (no MAC kept). */
const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

const COLOR_ENTRY = new RegExp(
  `^(${COLORS.join('|')})(?::([0-9a-f]{2}(?::[0-9a-f]{2}){5}))?$`,
  'i',
);
const MAC = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;

/** An 8-hex fingerprint of a MAC address (never the address itself), or null if unreadable. */
export function macPrint(mac) {
  if (typeof mac !== 'string' || !MAC.test(mac.trim())) {
    return null;
  }
  return createHash('sha256')
    .update(`tilt-pi:mac:${mac.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 8);
}

/**
 * Whether `Temp` (always °F in the Tilt Pi flow) disagrees with what the Tilt
 * Pi page shows (`displayTemp` in `tempunits`). Unknown when either is
 * missing: false.
 */
function incoherent(tempF, record) {
  const units = own(record, 'tempunits');
  const shown = strictNumber(own(record, 'displayTemp'));
  if (tempF === null || shown === null || typeof units !== 'string') {
    return false;
  }
  if (/C/i.test(units)) {
    return Math.abs((tempF - 32) / 1.8 - shown) > 0.3;
  }
  if (/F/i.test(units)) {
    return Math.abs(tempF - shown) > 0.2;
  }
  return false;
}

/**
 * Parse the answer of `/macid/all`. Returns
 * `{ tilts: Map<color, { color, temp, sg, stamp, key, mac, incoherent }>, unknown, twice: Set<color> }`
 * or throws a SourceError('invalid'). An empty object (`{}`: what the Tilt
 * Pi flow answers when it hears no Tilt) is no Tilt. `Color` is `RED`, or
 * `RED:aa:bb:cc:dd:ee:ff` in the "ID by MAC" mode of the Tilt Pi: the colour
 * is the identity either way. `Temp` is °F (the Tilt Pi flow always stores
 * it so). `key` tells a new reading apart: the raw `timeStamp`, else a
 * digest of `Temp`, `SG`, `mac` and the raw `timeStamp` only (never the
 * clock fields the Tilt Pi rewrites every second). `mac`: an 8-hex
 * fingerprint of the MAC address, or null.
 */
export function parseHydrometers(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SourceError('invalid', 'not JSON');
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) {
    data = [];
  }
  if (!Array.isArray(data)) {
    throw new SourceError('invalid', 'not a list of Tilts');
  }
  const tilts = new Map();
  const twice = new Set();
  let unknown = 0;
  for (const entry of data.slice(0, MAX_ENTRIES)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      unknown += 1;
      continue;
    }
    const rawColor = own(entry, 'Color');
    const match =
      typeof rawColor === 'string' && rawColor.length <= 40
        ? COLOR_ENTRY.exec(rawColor.trim())
        : null;
    if (!match) {
      unknown += 1;
      continue;
    }
    const color = match[1].toLowerCase();
    if (tilts.has(color) || twice.has(color)) {
      // Two Tilts of the same colour: neither is told apart, both left out.
      tilts.delete(color);
      twice.add(color);
      continue;
    }
    const rawStamp = own(entry, 'timeStamp');
    const stamp = stampOf(rawStamp);
    const rawMac = match[2] ?? own(entry, 'mac');
    const temp = strictNumber(own(entry, 'Temp'));
    tilts.set(color, {
      color,
      temp,
      sg: strictNumber(own(entry, 'SG')),
      stamp,
      key:
        stamp !== null
          ? `t${stamp}`
          : `d${digest(JSON.stringify([own(entry, 'Temp'), own(entry, 'SG'), rawMac, rawStamp]))}`,
      mac: macPrint(rawMac),
      incoherent: incoherent(temp, entry),
    });
  }
  return { tilts, unknown: unknown + Math.max(0, data.length - MAX_ENTRIES), twice };
}

/** Read every Tilt of the Tilt Pi at `origin` (`http://host:port`). */
export async function readHydrometers(origin) {
  let answer;
  try {
    answer = await getText(`${origin}${ROUTE}`);
  } catch (err) {
    throw new SourceError('failed', err instanceof NetworkError ? err.message : 'no answer');
  }
  const { status } = answer;
  if (status === 429) {
    throw new SourceError('limited', 'HTTP 429', answer);
  }
  if (status >= 500) {
    throw new SourceError('busy', `HTTP ${status}`, answer);
  }
  if (status === 401 || status === 403) {
    throw new SourceError('denied', `HTTP ${status}`);
  }
  if (status === 404) {
    throw new SourceError('notfound', 'HTTP 404');
  }
  if (status !== 200) {
    throw new SourceError('invalid', `HTTP ${status}`);
  }
  return { ...parseHydrometers(answer.text), date: answer.date };
}

/** The display name of a colour: `red` -> `Red`. */
export const colorName = (color) => color.charAt(0).toUpperCase() + color.slice(1);
