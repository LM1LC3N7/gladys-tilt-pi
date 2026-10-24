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
// an unknown colour or a colour heard twice left out. The optional
// `timeStamp` (ms) the Tilt Pi adds to an entry dates the reading.
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

/**
 * Parse the answer of `/macid/all`. Returns
 * `{ tilts: Map<color, { color, temp, sg, stamp, key }>, unknown, twice: Set<color> }`
 * or throws a SourceError('invalid'). `key` tells a new reading apart: the
 * raw `timeStamp` when the Tilt Pi gives one, else a digest of the whole
 * entry (a live Tilt changes at least its signal).
 */
export function parseHydrometers(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SourceError('invalid', 'not JSON');
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
    const color = typeof rawColor === 'string' ? rawColor.trim().toLowerCase() : '';
    if (!COLORS.includes(color)) {
      unknown += 1;
      continue;
    }
    if (tilts.has(color) || twice.has(color)) {
      // Two Tilts of the same colour: neither is told apart, both left out.
      tilts.delete(color);
      twice.add(color);
      continue;
    }
    const stamp = stampOf(own(entry, 'timeStamp'));
    tilts.set(color, {
      color,
      temp: strictNumber(own(entry, 'Temp')),
      sg: strictNumber(own(entry, 'SG')),
      stamp,
      key: stamp !== null ? `t${stamp}` : `d${digest(JSON.stringify(entry))}`,
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
