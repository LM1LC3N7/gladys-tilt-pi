// -----------------------------------------------------------------------------
// The Tilt Pi answer (strict, bounded, linear), the HTTP layer against a real
// local server (size bound, no redirection, timeout) and the address checks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseAddress, normalizeConfig } from '../src/config.js';
import { MAX_BODY, MAX_ENTRIES } from '../src/constants.js';
import { fahrenheitToCelsius, valuesOf } from '../src/fields.js';
import { setFetch } from '../src/http.js';
import { macPrint, parseHydrometers, readHydrometers, strictNumber } from '../src/tiltpi.js';

const parse = (value) => parseHydrometers(JSON.stringify(value));

test('the tilt-pi test answer: colours (any case), Fahrenheit and SG', () => {
  const { tilts, unknown, twice } = parse([
    { mac: '00:11:22:33:44:55', Color: 'blue', Temp: 70, SG: 1.012 },
    { mac: 'AA:BB:CC:DD:EE:FF', Color: 'RED', Temp: '68', SG: '1.015' },
  ]);
  assert.equal(unknown, 0);
  assert.equal(twice.size, 0);
  assert.deepEqual(
    [...tilts.values()].map((t) => [t.color, t.temp, t.sg, t.stamp]),
    [
      ['blue', 70, 1.012, null],
      ['red', 68, 1.015, null],
    ],
  );
  assert.match(tilts.get('blue').key, /^d[0-9a-f]{16}$/);
  assert.equal(Math.round(fahrenheitToCelsius(68) * 10) / 10, 20);
});

test('numbers are parsed strictly: empty, null, exponent or text are unknown', () => {
  assert.equal(strictNumber(''), null);
  assert.equal(strictNumber(null), null);
  assert.equal(strictNumber('1e3'), null);
  assert.equal(strictNumber(' 1.050 '), 1.05);
  assert.equal(strictNumber(Number.NaN), null);
  assert.equal(strictNumber(true), null);
  const { tilts } = parse([{ Color: 'green', Temp: '', SG: null }]);
  assert.deepEqual(valuesOf(tilts.get('green')), { values: {}, outOfRange: [], incoherent: false });
});

test('an empty object is no Tilt (the Tilt Pi flow answers {} without Tilt)', () => {
  assert.equal(parseHydrometers('{}').tilts.size, 0);
  assert.throws(() => parseHydrometers('{"a":1}'), { kind: 'invalid' });
  assert.throws(() => parseHydrometers('null'), { kind: 'invalid' });
});

test('"ID by MAC" mode: COLOUR:mac, the colour stays the identity, the MAC is fingerprinted', () => {
  const { tilts, unknown } = parse([
    { Color: 'RED:aa:bb:cc:dd:ee:01', Temp: '68.0', SG: 1.05, timeStamp: Date.now() },
    { Color: 'RED:zz', Temp: 1, SG: 1 },
    { Color: 'BLUE', mac: 'AA:BB:CC:DD:EE:02', Temp: 68, SG: 1.05 },
    { Color: 'GREEN', mac: 'not a mac', Temp: 68, SG: 1.05 },
  ]);
  assert.deepEqual([...tilts.keys()], ['red', 'blue', 'green']);
  assert.equal(unknown, 1);
  assert.equal(tilts.get('red').mac, macPrint('AA:BB:CC:DD:EE:01'));
  assert.match(tilts.get('red').mac, /^[0-9a-f]{8}$/);
  assert.notEqual(tilts.get('blue').mac, tilts.get('red').mac);
  assert.equal(tilts.get('green').mac, null, 'unreadable');
});

test('the digest of an undated entry ignores the fields that move without a reading', () => {
  const base = { Color: 'RED', mac: 'AA:BB:CC:DD:EE:01', Temp: '68.0', SG: 1.05 };
  const a = parse([{ ...base, rssi: -70, clock: '18:00:01', Timepoint: 1 }]).tilts.get('red');
  const b = parse([{ ...base, rssi: -75, clock: '18:00:02', Timepoint: 2 }]).tilts.get('red');
  const c = parse([{ ...base, SG: 1.049 }]).tilts.get('red');
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
});

test('Temp is always °F; a disagreement with the display drops the temperature', () => {
  const real = (extra) =>
    parse([{ Color: 'RED', Temp: '68.0', SG: 1.05, ...extra }]).tilts.get('red');
  // The Tilt Pi page in °C: Temp stays in °F, displayTemp follows the page.
  assert.deepEqual(valuesOf(real({ tempunits: '°C', displayTemp: '20.0' })).values, {
    gravity: 1.05,
    temperature: 20,
  });
  assert.equal(valuesOf(real({ tempunits: '°F', displayTemp: '68.0' })).values.temperature, 20);
  const odd = valuesOf(real({ tempunits: '°C', displayTemp: '68.0' }));
  assert.equal(odd.values.temperature, undefined);
  assert.equal(odd.incoherent, true);
  // The 0 °F fallback of a broken calibration is out of range (-17.8 °C).
  const zero = valuesOf(parse([{ Color: 'RED', Temp: '0.0', SG: 1.05 }]).tilts.get('red'));
  assert.deepEqual(zero.outOfRange, ['temperature']);
});

test('the timeStamp dates a reading and is its key', () => {
  const stamp = Date.parse('2026-10-20T18:00:00Z');
  const { tilts } = parse([
    { Color: 'Pink', Temp: 66, SG: 1.04, timeStamp: stamp },
    { Color: 'Black', Temp: 66, SG: 1.04, timeStamp: 12 },
  ]);
  assert.equal(tilts.get('pink').key, `t${stamp}`);
  assert.equal(tilts.get('black').stamp, null, 'an implausible time is no date');
});

test('bad answers: not JSON, not a list; unknown entries counted; prototype keys ignored', () => {
  assert.throws(() => parseHydrometers('<html>'), { kind: 'invalid' });
  assert.throws(() => parseHydrometers('{"Color":"red"}'), { kind: 'invalid' });
  const { tilts, unknown } = parseHydrometers(
    '[{"__proto__":{"Color":"red"},"Temp":1},{"Color":"constructor"},null,[],{"Color":"Yellow","SG":1.01,"Temp":60}]',
  );
  assert.deepEqual([...tilts.keys()], ['yellow']);
  assert.equal(unknown, 4);
  assert.equal({}.Color, undefined);
});

test('a colour heard twice (or more) is left out', () => {
  const { tilts, twice } = parse([
    { Color: 'red', mac: '1', SG: 1, Temp: 60 },
    { Color: 'red', mac: '2', SG: 1, Temp: 60 },
    { Color: 'red', mac: '3', SG: 1, Temp: 60 },
  ]);
  assert.equal(tilts.size, 0);
  assert.deepEqual([...twice], ['red']);
});

test('at most MAX_ENTRIES entries are looked at', () => {
  const list = Array.from({ length: MAX_ENTRIES + 30 }, () => ({ Color: 'nope' }));
  const { unknown } = parse(list);
  assert.equal(unknown, MAX_ENTRIES + 30);
});

test('the address: IP, host name, port, http only, no path, no broadcast', () => {
  assert.equal(parseAddress('192.168.1.30').origin, 'http://192.168.1.30:1880');
  assert.equal(parseAddress(' http://TiltPi.local:8080/ ').origin, 'http://tiltpi.local:8080');
  assert.equal(parseAddress('[fe80::1]').origin, 'http://[fe80::1]:1880');
  assert.equal(parseAddress(''), null);
  for (const bad of [
    'https://192.168.1.30',
    '192.168.1.30/macid/all',
    'user:pass@192.168.1.30',
    '192.168.1.30\r\nX: y',
    'a b',
    '0.0.0.0',
    '255.255.255.255',
    '239.1.2.3',
    'ftp://x',
    '192.168.1.30:99999',
    '[ff02::1]',
    'x'.repeat(300),
  ]) {
    assert.deepEqual(parseAddress(bad), { invalid: true }, bad);
  }
  assert.equal(normalizeConfig({ address: 'https://x' }).invalid, true);
  assert.equal(normalizeConfig({ poll_interval: '0' }).pollMinutes, 1);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollMinutes, 5);
  assert.equal(normalizeConfig({ poll_interval: 600 }).pollMinutes, 60);
});

/** A real HTTP server on 127.0.0.1, its handler set by each test. */
async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = setFetch((...args) => globalThis.fetch(...args));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    setFetch(previous);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a real server: the route, the Date header, the errors', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/macid/all') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ Color: 'ORANGE', SG: 1.02, Temp: 64, timeStamp: Date.now() }]));
      } else {
        res.statusCode = 404;
        res.end('no');
      }
    },
    async (origin) => {
      const answer = await readHydrometers(origin);
      assert.deepEqual([...answer.tilts.keys()], ['orange']);
      assert.ok(Math.abs(answer.date - Date.now()) < 5_000, 'the Date header of the Tilt Pi');
    },
  );
  for (const [status, kind] of [
    [404, 'notfound'],
    [401, 'denied'],
    [429, 'limited'],
    [502, 'busy'],
    [302, 'failed'],
    [418, 'invalid'],
  ]) {
    await withServer(
      (req, res) => {
        res.statusCode = status;
        res.setHeader('retry-after', '120');
        if (status === 302) {
          res.setHeader('location', 'http://example.com/');
        }
        res.end();
      },
      async (origin) => {
        await assert.rejects(readHydrometers(origin), (err) => {
          assert.equal(err.kind, kind, String(status));
          if (status === 429) {
            assert.equal(err.retryAfterMs, 120_000);
          }
          return true;
        });
      },
    );
  }
});

test('a real server: an answer too large is cut, never kept whole', async () => {
  await withServer(
    (req, res) => {
      res.write('[');
      const chunk = `${JSON.stringify({ Color: 'red', SG: 1, Temp: 1 })},`.repeat(1000);
      let sent = 0;
      const more = () => {
        while (sent < MAX_BODY * 4) {
          sent += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', more);
            return;
          }
        }
        res.end('1]');
      };
      more();
    },
    async (origin) => {
      await assert.rejects(readHydrometers(origin), (err) => {
        assert.equal(err.kind, 'failed');
        assert.match(err.message, /answer too large on 127\.0\.0\.1/);
        return true;
      });
    },
  );
});

test('a real server that never answers: the read is abandoned', async () => {
  const { getText } = await import('../src/http.js');
  await withServer(
    () => {},
    async (origin) => {
      await assert.rejects(getText(`${origin}/macid/all`, { timeout: 200 }), /timeout/);
    },
  );
});
