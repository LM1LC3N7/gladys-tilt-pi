// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Tilt Pi: devices
// and states, the pace (never faster than the interval: test button,
// reconnection, saved configuration, restart, clocks), the state file, a
// silent Tilt never shown alive, pauses, late answers, the status.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TiltPiApp } from '../src/app.js';
import { BUSY_MAX, STALE } from '../src/constants.js';
import { deviceOf } from '../src/fields.js';
import { memoryStorage } from '../src/store.js';
import {
  ADDRESS,
  ORIGIN,
  createClock,
  createFakeTimers,
  entry,
  installFetch,
  json,
  recordingLogger,
} from './helpers/fakes.js';

const NOW = Date.parse('2026-10-20T18:00:00Z');
const CONFIG = { address: ADDRESS, poll_interval: 5 };
const RED = 'ext:tilt-pi:tilt:red';
const BLUE = 'ext:tilt-pi:tilt:blue';
const MIN = 60_000;

let fake;
afterEach(() => fake?.restore());

/** A storage that records the wall instant of each write. */
function timedStorage(clock, initial) {
  const inner = memoryStorage(initial);
  const times = [];
  return {
    times,
    load: () => inner.load(),
    save(value) {
      times.push(clock.wall);
      inner.save(value);
    },
  };
}

const devicesFor = (...colors) => {
  const gladys = createFakeGladys({ selector: 'tilt-pi' });
  return colors.map((c) => deviceOf(gladys, c));
};

/**
 * `answer(clock)` builds the body of `/macid/all`; by default a red and a
 * blue Tilt dated 10 s before the Tilt Pi clock (the Date header).
 */
async function setup({
  config = CONFIG,
  clock = createClock(NOW),
  storage,
  devices = devicesFor('red', 'blue'),
  start = true,
} = {}) {
  const tilt = {
    status: 200,
    headers: {},
    date: true,
    body: (c) => [
      entry('red', { stamp: c.wall - 10_000 }),
      entry('blue', { temp: 50, sg: 1.012, stamp: c.wall - 10_000 }),
    ],
  };
  fake = installFetch([
    [
      /\/macid\/all$/,
      () =>
        json(tilt.body(clock), tilt.status, {
          ...(tilt.date ? { date: new Date(clock.wall).toUTCString() } : {}),
          ...tilt.headers,
        }),
    ],
  ]);
  const gladys = createFakeGladys({ selector: 'tilt-pi', config, devices });
  const timers = createFakeTimers();
  const logger = recordingLogger();
  const store = storage ?? timedStorage(clock);
  const app = new TiltPiApp({
    gladys,
    logger,
    now: () => clock.wall,
    mono: () => clock.mono,
    timers,
    storage: store,
  });
  gladys.onDeviceCreated(() => app.publishStates());
  gladys.onScanRequest(() => app.publishDiscovered({ force: true }));
  gladys.onAction('test_connection', () => app.testConnection());
  gladys.onConfigUpdated((c) => app.start(c));
  await gladys.connect();
  if (start) {
    await app.start(config);
  }
  return { app, gladys, timers, clock, tilt, logger, storage: store };
}

const reads = () => fake.calls.length;
const statesOf = (gladys, id) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === id);

test('one device per colour, gravity and temperature in °C, published at once', async () => {
  const { gladys } = await setup();
  assert.equal(fake.calls[0].url, `${ORIGIN}/macid/all`);
  assert.equal(fake.calls[0].init.method, 'GET');
  assert.equal(fake.calls[0].init.redirect, 'error');
  assert.match(fake.calls[0].init.headers['User-Agent'], /^gladys-tilt-pi/);
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.deepEqual(ids, [BLUE, RED]);
  const red = gladys.fake.discoveredDevices[1];
  assert.equal(red.name, 'Tilt Red');
  assert.deepEqual(
    red.features.map((f) => [f.external_id, f.category, f.type, f.unit]),
    [
      [`${RED}:gravity`, 'unknown', 'decimal', undefined],
      [`${RED}:temperature`, 'temperature-sensor', 'probe', 'celsius'],
    ],
  );
  assert.equal(gladys.fake.lastState(`${RED}:gravity`), 1.05);
  assert.equal(gladys.fake.lastState(`${RED}:temperature`), 20);
  assert.equal(gladys.fake.lastState(`${BLUE}:temperature`), 10);
  assert.equal(statesOf(gladys, `${RED}:gravity`)[0].created_at, undefined, 'current, not dated');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /2 Tilt\(s\) on the Tilt Pi/);
});

test('Temp is always °F, also when the Tilt Pi page shows °C; out of range is left out', async () => {
  const { gladys, tilt, app } = await setup({ start: false });
  tilt.body = (c) => [
    // The real entry of a Tilt Pi displaying °C: Temp in °F, displayTemp in °C.
    { ...entry('red', { temp: '68.0', stamp: c.wall }), tempunits: '°C', displayTemp: '20.0' },
    // 0 °F: the fallback of a broken calibration (-17.8 °C), and a gravity of 0.5.
    entry('blue', { temp: '0.0', sg: 0.5, stamp: c.wall }),
    // Temp disagreeing with the display: never published.
    { ...entry('green', { temp: 68, stamp: c.wall }), tempunits: '°C', displayTemp: '68.0' },
  ];
  await app.start(CONFIG);
  assert.equal(gladys.fake.lastState(`${RED}:temperature`), 20);
  assert.equal(gladys.fake.lastState(`${RED}:gravity`), 1.05);
  assert.ok(!gladys.fake.states.some((st) => st.state === 68), 'never 68 °C');
  assert.equal(gladys.fake.lastState(`${BLUE}:temperature`), undefined);
  assert.equal(gladys.fake.lastState(`${BLUE}:gravity`), undefined);
  const message = gladys.fake.connectionStatus.message.en;
  assert.match(message, /out of range, not published: Tilt Blue \(gravity, temperature\)/);
  assert.match(message, /disagrees with the Tilt Pi display: Tilt Green/);
});

test('{} (no Tilt heard) is a working Tilt Pi with no Tilt, not an error', async () => {
  const { app, gladys, clock, tilt } = await setup();
  tilt.body = () => ({});
  clock.advance(5 * MIN);
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Without value: Tilt Blue \(no recent reading\), Tilt Red \(no recent reading\)/,
  );
  tilt.body = () => ({ a: 1 });
  clock.advance(5 * MIN);
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /not a Tilt Pi answer/);
});

test('a changed MAC holds the colour back until read twice in a row', async () => {
  const { app, gladys, clock, tilt } = await setup({ devices: devicesFor('red') });
  const A = 'AA:BB:CC:DD:EE:01';
  const B = 'AA:BB:CC:DD:EE:02';
  const read = async (mac, sg) => {
    tilt.body = (c) => [entry('red', { mac, sg, stamp: c.wall - 1_000 })];
    clock.advance(5 * MIN);
    await app.tick();
  };
  assert.equal(gladys.fake.lastState(`${RED}:gravity`), 1.05);
  // Two Tilts of one colour taking turns: nothing after the first change.
  await read(B, 1.008);
  await read(A, 1.052);
  await read(B, 1.008);
  assert.deepEqual(
    statesOf(gladys, `${RED}:gravity`).map((st) => st.state),
    [1.05],
  );
  assert.match(gladys.fake.connectionStatus.message.en, /Tilt Red \(MAC changed/);
  // An unreadable MAC changes nothing (still held).
  await read('??', 1.007);
  assert.equal(statesOf(gladys, `${RED}:gravity`).length, 1);
  // A replaced Tilt: the same new MAC twice in a row, then it counts again.
  await read(B, 1.006);
  assert.deepEqual(
    statesOf(gladys, `${RED}:gravity`).map((st) => st.state),
    [1.05, 1.006],
  );
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /MAC changed/);
  assert.doesNotMatch(JSON.stringify(app.store.get()), /AA:BB/i, 'only fingerprints in /data');
});

test('"ID by MAC" mode: RED:mac is the red Tilt, same external ids', async () => {
  const { gladys, tilt, app } = await setup({ start: false });
  tilt.body = (c) => [
    { ...entry('red', { stamp: c.wall }), Color: 'RED:aa:bb:cc:dd:ee:01' },
    { ...entry('blue', { stamp: c.wall }), Color: 'BLUE:aa:bb:cc:dd:ee:02' },
    { ...entry('blue', { stamp: c.wall }), Color: 'BLUE:aa:bb:cc:dd:ee:03' },
  ];
  await app.start(CONFIG);
  assert.equal(gladys.fake.lastState(`${RED}:gravity`), 1.05);
  assert.equal(gladys.fake.lastState(`${BLUE}:gravity`), undefined);
  assert.match(gladys.fake.connectionStatus.message.en, /Tilt Blue \(two Tilts of this colour\)/);
});

test('a Tilt Pi clock set back 3 hours loses nothing: the age alone decides', async () => {
  const { app, gladys, clock, tilt } = await setup({ devices: devicesFor('red') });
  const back = 3 * 60 * MIN;
  tilt.date = false;
  tilt.headers = {};
  tilt.body = (c) => [entry('red', { sg: 1.04, stamp: c.wall - back - 2_000 })];
  const piDate = () => new Date(clock.wall - back).toUTCString();
  fake.restore();
  fake = installFetch([[/macid/, () => json(tilt.body(clock), 200, { date: piDate() })]]);
  clock.advance(5 * MIN);
  await app.tick();
  assert.equal(gladys.fake.lastState(`${RED}:gravity`), 1.04);
  tilt.body = (c) => [entry('red', { sg: 1.03, stamp: c.wall - back - 2_000 })];
  clock.advance(5 * MIN);
  await app.tick();
  assert.equal(gladys.fake.lastState(`${RED}:gravity`), 1.03);
});

test('current up to 3 minutes old, dated beyond (up to 15 minutes)', async () => {
  const { app, gladys, clock, tilt } = await setup({ devices: devicesFor('red') });
  tilt.body = (c) => [entry('red', { sg: 1.03, stamp: c.wall - 4 * MIN })];
  clock.advance(5 * MIN);
  await app.tick();
  const last = statesOf(gladys, `${RED}:gravity`).at(-1);
  assert.equal(last.state, 1.03);
  assert.equal(last.created_at, new Date(clock.wall - 4 * MIN).toISOString());
});

test('never faster than the interval: test button, reconnection, same config, restart', async () => {
  const { app, gladys, clock, storage } = await setup();
  assert.equal(reads(), 1);
  clock.advance(2 * MIN);
  await gladys.fake.action('test_connection', {});
  await app.start(CONFIG);
  await gladys.fake.configUpdated(CONFIG);
  await gladys.fake.scanRequest();
  await app.tick();
  assert.equal(reads(), 1);
  // A restart of the container: a new process, the same /data.
  const next = new TiltPiApp({
    gladys,
    now: () => clock.wall,
    mono: () => 50, // a new process: the monotonic clock starts again
    timers: createFakeTimers(),
    storage,
    logger: recordingLogger(),
  });
  await next.start(CONFIG);
  assert.equal(reads(), 1);
  clock.advance(3 * MIN);
  await app.tick();
  assert.equal(reads(), 2, 'read again once the interval has passed');
});

test('the instant of a request is on disk before it leaves; at most one write a minute', async () => {
  const clock = createClock(NOW);
  const storage = timedStorage(clock);
  const { app, tilt } = await setup({ clock, storage, start: false });
  const savedAtRequest = [];
  const body = tilt.body;
  tilt.body = (c) => {
    savedAtRequest.push(storage.load()?.lastAttemptAt);
    return body(c);
  };
  await app.start({ ...CONFIG, poll_interval: 1 });
  assert.deepEqual(savedAtRequest, [NOW]);
  // Interval 1 minute: a tick 30 s later reads nothing, one at 60 s reads.
  clock.advance(30_000);
  await app.tick();
  clock.advance(30_000);
  await app.tick();
  assert.deepEqual(savedAtRequest, [NOW, NOW + MIN]);
  // The request writes, and the first sight of the two colours.
  assert.deepEqual(storage.times, [NOW, NOW, NOW + MIN]);
  assert.doesNotMatch(
    JSON.stringify(storage.load()),
    /AA:BB|1\.05/,
    'no MAC nor value under /data',
  );
});

test('the interval is measured on the monotonic clock: a wall clock jump reads nothing', async () => {
  const { app, clock } = await setup();
  clock.wall += 24 * 60 * MIN;
  await app.tick();
  assert.equal(reads(), 1);
  clock.mono += 5 * MIN;
  await app.tick();
  assert.equal(reads(), 2);
});

test('a request instant in the future of the clock (set back) waits a whole interval', async () => {
  const clock = createClock(NOW);
  const storage = memoryStorage({ address: ORIGIN, lastAttemptAt: NOW + 60 * MIN, writtenAt: 0 });
  const { app } = await setup({ clock, storage });
  assert.equal(reads(), 0);
  clock.advance(4 * MIN);
  await app.tick();
  assert.equal(reads(), 0);
  clock.advance(MIN);
  await app.tick();
  assert.equal(reads(), 1);
});

test('a silent Tilt (same timeStamp) is never published again nor shown alive', async () => {
  const { app, gladys, clock, tilt } = await setup();
  const frozen = clock.wall - 10_000;
  tilt.body = (c) => [entry('red', { stamp: frozen }), entry('blue', { stamp: c.wall - 1_000 })];
  const before = statesOf(gladys, `${RED}:gravity`).length;
  clock.advance(5 * MIN);
  await app.tick();
  assert.equal(statesOf(gladys, `${RED}:gravity`).length, before);
  assert.equal(statesOf(gladys, `${BLUE}:gravity`).length, 2);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Without value: Tilt Red \(no recent reading\)/,
  );
  const answer = await gladys.fake.action('test_connection', {});
  assert.match(answer.data?.en ?? JSON.stringify(answer), /Tilt Red: no recent reading/);
});

test('a reading dated more than 15 minutes ago by the Tilt Pi clock is never published', async () => {
  const clock = createClock(NOW);
  const { gladys, tilt, app } = await setup({ clock, start: false });
  tilt.body = (c) => [entry('red', { stamp: c.wall - STALE - 1_000 })];
  await app.start(CONFIG);
  assert.equal(statesOf(gladys, `${RED}:gravity`).length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /Tilt Red \(no recent reading\)/);
});

test('the age is taken on the Tilt Pi clock, not on the Gladys clock', async () => {
  const clock = createClock(NOW);
  const { gladys, tilt, app } = await setup({ clock, start: false });
  const piClock = NOW + 2 * 60 * MIN;
  tilt.date = false;
  tilt.headers = { date: new Date(piClock).toUTCString() };
  tilt.body = () => [entry('red', { stamp: piClock - 5_000 })];
  await app.start(CONFIG);
  assert.equal(gladys.fake.lastState(`${RED}:gravity`), 1.05);
});

test('undated entries: the first sight is never published, a new reading is', async () => {
  const { app, gladys, clock, tilt } = await setup({ start: false });
  tilt.date = false;
  let sg = 1.05;
  let rssi = -70;
  tilt.body = () => [entry('red', { rssi, sg })];
  await app.start(CONFIG);
  assert.equal(statesOf(gladys, `${RED}:gravity`).length, 0, 'not proven alive yet');
  rssi = -75;
  clock.advance(5 * MIN);
  await app.tick();
  assert.equal(statesOf(gladys, `${RED}:gravity`).length, 0, 'only the signal moved: silent');
  sg = 1.049;
  clock.advance(5 * MIN);
  await app.tick();
  assert.equal(gladys.fake.lastState(`${RED}:gravity`), 1.049);
});

test('a restart never publishes a reading already published (keys flushed on stop)', async () => {
  const { app, gladys, clock, storage, tilt } = await setup();
  // A second reading: its key waits for the next allowed write...
  clock.advance(5 * MIN);
  const stamp = clock.wall - 1_000;
  tilt.body = () => [entry('red', { stamp, sg: 1.04 }), entry('blue', { stamp, sg: 1.011 })];
  await app.tick();
  assert.equal(gladys.fake.lastState(`${RED}:gravity`), 1.04);
  assert.notEqual(storage.load().tilts[0].key, `t${stamp}`, 'not written yet');
  // ...and is written by the clean stop.
  app.shutdown();
  assert.equal(storage.load().tilts.find((t) => t.color === 'red').key, `t${stamp}`);
  const count = gladys.fake.states.length;
  const next = new TiltPiApp({
    gladys,
    now: () => clock.wall,
    mono: () => clock.mono,
    timers: createFakeTimers(),
    storage,
    logger: recordingLogger(),
  });
  clock.advance(5 * MIN);
  await next.start(CONFIG);
  assert.equal(reads(), 3, 'read again: the Tilt Pi still shows the same readings');
  assert.equal(gladys.fake.states.length, count);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Tilt Blue \(no recent reading\), Tilt Red/,
  );
});

test('a device created later gets the last reading, dated, while recent', async () => {
  const { app, gladys, clock } = await setup({ devices: [] });
  assert.equal(gladys.fake.states.length, 0);
  clock.advance(MIN);
  const [, red] = devicesFor('blue', 'red');
  await gladys.fake.deviceCreated(red);
  const [state] = statesOf(gladys, `${RED}:gravity`);
  assert.equal(state.created_at, new Date(NOW - 10_000).toISOString());
  void app;
});

test('two Tilts of the same colour: neither is published', async () => {
  const { gladys } = await setup({
    start: false,
  }).then(async (s) => {
    s.tilt.body = (c) => [
      entry('red', { stamp: c.wall, mac: '11:11:11:11:11:11' }),
      entry('red', { stamp: c.wall, mac: '22:22:22:22:22:22' }),
      entry('blue', { stamp: c.wall }),
    ];
    await s.app.start(CONFIG);
    return s;
  });
  assert.equal(statesOf(gladys, `${RED}:gravity`).length, 0);
  assert.equal(statesOf(gladys, `${BLUE}:gravity`).length, 1);
  assert.match(gladys.fake.connectionStatus.message.en, /Tilt Red \(two Tilts of this colour\)/);
});

test('unknown colours and non-objects are counted, never published', async () => {
  const s = await setup({ start: false });
  s.tilt.body = (c) => [
    { Color: 'MAGENTA', SG: 1.01, Temp: 60, timeStamp: c.wall },
    'x',
    { Color: '__proto__', SG: 1, Temp: 1 },
    entry('red', { stamp: c.wall }),
  ];
  await s.app.start(CONFIG);
  assert.deepEqual(
    s.gladys.fake.discoveredDevices.map((d) => d.external_id),
    [RED],
  );
  assert.match(s.gladys.fake.connectionStatus.message.en, /3 other entry\(ies\)/);
});

test('429: a bounded pause, persisted, kept by a restart, never read during it', async () => {
  const { app, gladys, clock, tilt, storage } = await setup({ start: false });
  tilt.status = 429;
  tilt.headers = { 'retry-after': '600' };
  await app.start(CONFIG);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /too many requests/);
  assert.equal(storage.load().pausedUntil, NOW + 10 * MIN);
  tilt.status = 200;
  clock.advance(5 * MIN);
  await app.tick();
  assert.equal(reads(), 1, 'paused');
  const next = new TiltPiApp({
    gladys,
    now: () => clock.wall,
    mono: () => 7,
    timers: createFakeTimers(),
    storage,
    logger: recordingLogger(),
  });
  await next.start(CONFIG);
  assert.equal(reads(), 1, 'the pause survives a restart');
  assert.match(gladys.fake.connectionStatus.message.en, /unavailable/);
  clock.advance(5 * MIN);
  await app.tick();
  assert.equal(reads(), 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(storage.load().pausedUntil, 0);
});

test('a pause read back from /data is capped at 6 hours', async () => {
  const clock = createClock(NOW);
  const storage = memoryStorage({ address: ORIGIN, pausedUntil: NOW + 1000 * 60 * MIN });
  const { app } = await setup({ clock, storage });
  assert.equal(reads(), 0);
  clock.advance(BUSY_MAX);
  await app.tick();
  assert.equal(reads(), 1);
});

test('5xx without Retry-After: 5 minutes, then doubling', async () => {
  const { app, clock, tilt, storage } = await setup({ start: false });
  tilt.status = 503;
  await app.start(CONFIG);
  assert.equal(storage.load().pausedUntil, NOW + 5 * MIN);
  clock.advance(5 * MIN);
  await app.tick();
  assert.equal(reads(), 2);
  assert.equal(storage.load().pausedUntil, clock.wall + 10 * MIN);
});

test('404, invalid answers and network failures: retried at the interval only', async () => {
  const { app, gladys, clock, tilt } = await setup({ start: false });
  tilt.status = 404;
  await app.start(CONFIG);
  assert.match(gladys.fake.connectionStatus.message.en, /no Tilt Pi at this address/);
  tilt.status = 200;
  tilt.body = () => ({ not: 'a list' });
  clock.advance(MIN);
  await app.tick();
  assert.equal(reads(), 1);
  clock.advance(4 * MIN);
  await app.tick();
  assert.equal(reads(), 2);
  assert.match(gladys.fake.connectionStatus.message.en, /not a Tilt Pi answer/);
});

test('a late answer of a previous start publishes nothing and sets no status', async () => {
  const { app, gladys } = await setup({ start: false, devices: devicesFor('red') });
  let release;
  app.client = {
    readHydrometers: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  const first = app.start(CONFIG);
  await new Promise((r) => setImmediate(r));
  app.stop();
  const statuses = gladys.fake.connectionStatuses.length;
  release({
    tilts: new Map([['red', { color: 'red', temp: 68, sg: 1.05, stamp: NOW, key: `t${NOW}` }]]),
    unknown: 0,
    twice: new Set(),
    date: NOW,
  });
  await first;
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(gladys.fake.connectionStatuses.length, statuses);
});

test('a reconnection during a read does not start another read', async () => {
  const { app } = await setup({ start: false });
  let release;
  let count = 0;
  app.client = {
    readHydrometers: () => {
      count += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  const first = app.start(CONFIG);
  await new Promise((r) => setImmediate(r));
  const second = app.start(CONFIG);
  release({ tilts: new Map(), unknown: 0, twice: new Set(), date: null });
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test('status and Discovery are published again at each connection', async () => {
  const { app, gladys } = await setup();
  const statuses = gladys.fake.connectionStatuses.length;
  const discoveries = gladys.fake.requests.filter((r) => /discover/.test(r.path)).length;
  await app.start(CONFIG);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.requests.filter((r) => /discover/.test(r.path)).length, discoveries + 1);
});

test('another address is read at once; the address is checked', async () => {
  const { app, gladys, clock } = await setup();
  clock.advance(MIN);
  await app.start({ ...CONFIG, address: 'http://tiltpi.local:8080/' });
  assert.equal(reads(), 2);
  assert.equal(fake.calls[1].url, 'http://tiltpi.local:8080/macid/all');
  await app.start({ ...CONFIG, address: 'https://x/y' });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Address not valid/);
  await app.start({ ...CONFIG, address: '' });
  assert.match(gladys.fake.connectionStatus.message.en, /Enter the address/);
  assert.equal(reads(), 2);
});

test('a created feature unknown to this version is kept in the Discovery list', async () => {
  const [red] = devicesFor('red');
  red.features.push({ ...red.features[0], external_id: `${RED}:old`, name: 'Old' });
  const { gladys } = await setup({ devices: [red] });
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === RED);
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').pop()),
    ['gravity', 'temperature', 'old'],
  );
});

test('the test button without an address answers at once', async () => {
  const { gladys } = await setup({ config: {} });
  const answer = await gladys.fake.action('test_connection', {});
  assert.match(JSON.stringify(answer), /Enter the address/);
  assert.equal(reads(), 0);
});
