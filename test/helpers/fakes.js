// -----------------------------------------------------------------------------
// Fakes for the tests: fetch (routes requests to handlers, records every call,
// fails loudly on an unexpected URL), Tilt Pi answers (as tilt-pi's tests
// model them, plus the `timeStamp` the Tilt Pi adds), clocks and timers
// (nothing fires by itself). No test touches the disk.
// -----------------------------------------------------------------------------

import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export const ADDRESS = '192.168.1.30';
export const ORIGIN = 'http://192.168.1.30:1880';

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** One entry of `/macid/all`. */
export const entry = (color, { temp = 68, sg = 1.05, stamp, mac, rssi = -70 } = {}) => ({
  mac: mac ?? `AA:BB:CC:DD:EE:0${color.length}`,
  Color: color.toUpperCase(),
  Temp: temp,
  SG: sg,
  rssi,
  ...(stamp === undefined ? {} : { timeStamp: stamp }),
});

/** Install a fake fetch; `routes` is a list of [RegExp, handler(call)]. */
export function installFetch(routes) {
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const call = { url, init };
    calls.push(call);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) {
      throw new Error(`Unexpected network call in a test: ${url}`);
    }
    return route[1](call);
  });
  return { calls, restore: () => setFetch(previous) };
}

export function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  const add = (kind, fn, ms) => {
    const id = nextId++;
    pending.set(id, { id, kind, fn, ms });
    return id;
  };
  return {
    pending,
    setTimeout: (fn, ms) => add('timeout', fn, ms),
    setInterval: (fn, ms) => add('interval', fn, ms),
    clearTimeout: (id) => pending.delete(id),
    clearInterval: (id) => pending.delete(id),
    async runIntervals() {
      for (const t of [...pending.values()].filter((t) => t.kind === 'interval')) {
        await t.fn();
      }
    },
    async runTimeouts() {
      for (const t of [...pending.values()].filter((t) => t.kind === 'timeout')) {
        pending.delete(t.id);
        await t.fn();
      }
    },
  };
}

/** Wall clock and monotonic clock, moved together by `advance` (or apart by hand). */
export function createClock(wall) {
  const clock = {
    wall,
    mono: 1_000,
    advance(ms) {
      clock.wall += ms;
      clock.mono += ms;
    },
  };
  return clock;
}

/** A logger that keeps every line. */
export function recordingLogger() {
  const lines = [];
  const keep =
    (level) =>
    (...args) =>
      lines.push(`${level} ${args.map((a) => String(a?.message ?? a)).join(' ')}`);
  return {
    lines,
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
    debug: keep('debug'),
  };
}
