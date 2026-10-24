// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized so
// the rest of the code never deals with strings or `undefined`.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  poll_interval: 5,
  temperature_unit: 'fahrenheit',
};

const number = (value, fallback, min, max) => {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : fallback;
};

/** No control character, no space (a pasted line break never reaches a request). */
const printable = (text) =>
  [...text].every((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f);

/** Addresses that are never a Tilt Pi: any, broadcast, multicast. */
function forbiddenHost(host) {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const first = Number(v4[1]);
    return host === '0.0.0.0' || host === '255.255.255.255' || (first >= 224 && first <= 239);
  }
  return host === '[::]' || /^\[ff/i.test(host);
}

/**
 * The address of the Tilt Pi: `192.168.1.30`, `tiltpi.local:1880` or
 * `http://192.168.1.30:1880/`. Returns `{ host, port, origin }`, or
 * `{ invalid: true }`, or null when empty. Only `http:` (the Tilt Pi page
 * has no TLS); no user, no path, no query.
 */
export function parseAddress(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return null;
  }
  if (text.length > 255 || !printable(text)) {
    return { invalid: true };
  }
  const bare = text.replace(/^http:\/\//i, '').replace(/\/$/, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(bare) || /[/?#@\\]/.test(bare)) {
    return { invalid: true };
  }
  let url;
  try {
    url = new URL(`http://${bare}`);
  } catch {
    return { invalid: true };
  }
  const host = url.hostname;
  if (
    !host ||
    url.username ||
    url.password ||
    !/^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/i.test(
      host,
    ) ||
    forbiddenHost(host)
  ) {
    return { invalid: true };
  }
  const port = url.port ? Number(url.port) : DEFAULT_PORT;
  return { host, port, origin: `http://${host}:${port}` };
}

/** The configuration: the Tilt Pi address, the interval, the temperature unit it sends. */
export function normalizeConfig(raw = {}) {
  const address = parseAddress(raw.address);
  return {
    address: address && !address.invalid ? address : null,
    invalid: Boolean(address?.invalid),
    pollMinutes: number(raw.poll_interval, DEFAULT_CONFIG.poll_interval, 1, 60),
    celsius: raw.temperature_unit === 'celsius',
  };
}
