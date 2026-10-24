// -----------------------------------------------------------------------------
// The integration itself: the Tilt Pi to read, when it is due, the pauses,
// the Gladys devices and states built from the readings, the connection
// status and the test button. index.js only wires the SDK handlers to it.
//
// Two clocks: `mono` (monotonic, never set back) for every delay kept in
// memory (the interval, a pause), `now` (wall clock) only for what goes to
// /data and comes back after a restart, and for the dates shown.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  BUSY_BASE,
  BUSY_MAX,
  BUSY_MIN,
  CURRENT,
  FUTURE_TOLERANCE,
  MAC_CONFIRM,
  MAC_LOCK,
  HEARTBEAT,
  STALE,
  TEST_DEADLINE,
  TICK,
} from './constants.js';
import { deviceOf, statesOf, valuesOf } from './fields.js';
import { T, reason } from './i18n.js';
import { Store, memoryStorage } from './store.js';
import { SourceError, colorName, readHydrometers } from './tiltpi.js';

const defaultTimers = { setInterval, clearInterval, setTimeout, clearTimeout };
const defaultClient = { readHydrometers };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** 12.54 -> "12.5", "12,5" in French. */
const numberText = (value, digits, lang) => {
  const text = value.toFixed(digits);
  return lang === 'fr' ? text.replace('.', ',') : text;
};

const asSourceError = (err) => (err instanceof SourceError ? err : new SourceError('failed'));

/** The raw `timeStamp` behind a reading key (`t<ms>`), or null. */
const stampOfKey = (key) => (/^t\d+$/.test(key) ? Number(key.slice(1)) : null);

const newTilt = (
  color,
  {
    key = '',
    mac = '',
    macAt = 0,
    candidate = '',
    seen = 0,
    prev = '',
    prevAt = 0,
    lock = '',
    lockSince = 0,
    lockReads = 0,
  } = {},
) => ({
  color,
  /** The key of the last reading seen (kept under /data). */
  key,
  /** The 8-hex fingerprint of the MAC address whose values count (kept under /data). */
  mac,
  /** A different fingerprint being confirmed, and how many reads in a row showed it. */
  candidate,
  seen,
  /** When `mac` was last read; the fingerprint it replaced and when it was last read. */
  macAt,
  prev,
  prevAt,
  /** Two Tilts of one colour: the fingerprint read alone since `lockSince`, or ''. */
  lock,
  lockSince,
  /** Reads of `lock` alone since `lockSince` (kept under /data). */
  lockReads,
  /** Whether the temperature disagreed with the Tilt Pi display at the last read. */
  incoherent: false,
  /** Whether the last read brought a new, recent reading of this Tilt. */
  live: false,
  /** Whether the last read listed this colour twice. */
  twice: false,
  /** Features whose value was out of range at the last read. */
  outOfRange: [],
  /** { values, key, readMono, at, current } of the last live reading. */
  sample: null,
});

export class TiltPiApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'tilt-pi' }),
    now = Date.now,
    mono = () => performance.now(),
    timers = defaultTimers,
    storage = memoryStorage(),
    client = defaultClient,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.mono = mono;
    this.timers = timers;
    this.client = client;
    this.config = normalizeConfig();
    this.store = new Store({ storage, now, timers });
    // Loaded once per process: the pace, the pause and the Tilts met live
    // as long as the process, across restarts of the app and reconnections.
    this.loaded = false;
    /** Monotonic instant of the last request, or null (none known). */
    this.lastAttemptMono = null;
    /** Monotonic end of the pause and the instant it was set (to recap it). */
    this.pause = { until: 0, setAt: 0 };
    /** The error of the last read (`failed`, `busy`...), or undefined. */
    this.error = undefined;
    /** Whether a read succeeded in this process (for the status). */
    this.readOk = false;
    /** colour -> Tilt */
    this.tilts = new Map();
    /** Entries of the last answer left out (unknown colour, beyond the limit). */
    this.unknown = 0;
    /** feature external id -> key of the reading last handed to Gladys. */
    this.pushed = new Map();
    this.interval = undefined;
    this.ticking = undefined;
    this.chain = Promise.resolve();
    this.lastDiscovered = undefined;
    this.lastStatus = undefined;
    this.generation = 0;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** The saved pace and pause, turned into monotonic deadlines (capped). */
  load() {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const saved = this.store.get();
    const wall = this.now();
    const mono = this.mono();
    if (saved.lastAttemptAt > 0) {
      // A request "in the future" (a clock set back) counts as just made:
      // the next read waits a whole interval, never less.
      const since = clamp(wall - saved.lastAttemptAt, 0, 24 * 60 * 60_000);
      this.lastAttemptMono = mono - since;
    }
    const remaining = clamp(saved.pausedUntil - wall, 0, BUSY_MAX);
    if (remaining > 0) {
      this.pause = { until: mono + remaining, setAt: mono };
      this.error = 'busy';
    }
    for (const tilt of saved.tilts) {
      this.tilts.set(tilt.color, newTilt(tilt.color, tilt));
    }
  }

  async start(raw = {}) {
    this.stop();
    const generation = ++this.generation;
    this.load();
    this.config = normalizeConfig(raw);
    const origin = this.config.address?.origin ?? '';
    if (origin && origin !== this.store.get().address) {
      // Another Tilt Pi: its pace and pause are its own (the writes to /data
      // still keep at least a minute between two requests).
      this.lastAttemptMono = null;
      this.pause = { until: 0, setAt: 0 };
      this.error = undefined;
      this.readOk = false;
      for (const tilt of this.tilts.values()) {
        Object.assign(tilt, { live: false, twice: false, outOfRange: [], sample: null });
      }
      // Written with the instant of the first request (never a write of its
      // own, which would hold that request back for a minute).
      this.store.update(
        { address: origin, lastAttemptAt: 0, pausedUntil: 0, streak: 0 },
        { defer: true },
      );
    }
    // Gladys keeps the status and the Discovery list in memory only: a
    // (re)connection may follow a restart of the core, so both are published
    // again even when nothing changed.
    this.lastStatus = undefined;
    this.lastDiscovered = undefined;
    await this.tick();
    if (generation !== this.generation) {
      return;
    }
    this.interval = this.timers.setInterval(
      () => this.tick().catch((err) => this.logger.warn(`Refresh failed: ${err.message}`)),
      TICK,
    );
    await this.publishDiscovered();
    if (generation === this.generation) {
      await this.refreshStatus();
    }
  }

  stop() {
    this.generation += 1;
    if (this.interval !== undefined) {
      this.timers.clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /** The container stops: the state file is written, the timers dropped. */
  shutdown() {
    this.stop();
    // A clean stop happens once per restart: the keys of the last readings
    // are written even before the one-minute gap.
    this.store.flush({ force: true });
    this.store.close();
  }

  /** Run `fn` after every read already queued: never two reads at once. */
  exclusive(fn) {
    const run = this.chain.catch(() => {}).then(fn);
    this.chain = run.catch(() => {});
    return run;
  }

  // --- Pace ---------------------------------------------------------------------------

  intervalMs() {
    return this.config.pollMinutes * 60_000;
  }

  /** The end of the pause, capped again at each use. */
  pauseEnd() {
    return Math.min(this.pause.until, this.pause.setAt + BUSY_MAX);
  }

  /** The earliest read, on the monotonic clock: the interval and a pause are always kept. */
  earliest() {
    const paced =
      this.lastAttemptMono === null ? -Infinity : this.lastAttemptMono + this.intervalMs();
    return Math.max(paced, this.pauseEnd());
  }

  /** When the next read can happen, on the wall clock (shown by the test button). */
  nextRead() {
    const wall = this.now();
    const wait = Math.max(0, this.earliest() - this.mono(), this.store.writableAt() - wall);
    return wall + wait;
  }

  // --- Reading -----------------------------------------------------------------------

  /** Read what is due (a tick never overlaps another). */
  tick() {
    if (this.ticking && this.tickGeneration === this.generation) {
      return this.ticking;
    }
    const run = this.exclusive(() => this.readDue()).finally(() => {
      if (this.ticking === run) {
        this.ticking = undefined;
      }
    });
    this.ticking = run;
    this.tickGeneration = this.generation;
    return run;
  }

  /**
   * Read the Tilt Pi when the interval has passed. Nothing, not even the test
   * button, reads before the last request + the interval, nor during a
   * pause. The instant of the request is written to /data before it leaves
   * (a read waits until a write is allowed).
   */
  async readDue() {
    const generation = this.generation;
    const { address } = this.config;
    if (!address || this.mono() < this.earliest() || !this.store.canWrite()) {
      return;
    }
    this.lastAttemptMono = this.mono();
    this.store.update({ lastAttemptAt: this.now() });
    let answer;
    try {
      answer = await this.client.readHydrometers(address.origin);
    } catch (err) {
      this.failed(asSourceError(err), generation === this.generation, address.origin);
      if (generation === this.generation) {
        await this.refreshStatus();
      }
      return;
    }
    if (generation !== this.generation) {
      // Disconnected or reconfigured meanwhile: a late answer publishes
      // nothing and sets no status.
      return;
    }
    const added = this.apply(answer);
    const paused = this.store.get().pausedUntil !== 0;
    this.error = undefined;
    this.readOk = true;
    this.pause = { until: 0, setAt: 0 };
    // A new Tilt or the end of a pause is written at once; the keys of the
    // readings with the next allowed write (at most once per minute).
    this.store.update(
      { pausedUntil: 0, streak: 0, tilts: this.serialize() },
      { defer: !added && !paused },
    );
    await this.publish();
    if (generation === this.generation) {
      await this.refreshStatus();
    }
  }

  /**
   * The MAC fingerprint of a reading, against the one of its colour.
   * Returns whether its values may count. Wall-clock instants (they are kept
   * under /data and must survive a restart).
   *
   * - A new fingerprint is held back until read MAC_CONFIRM times in a row:
   *   a replaced Tilt (A -> B, A never back) comes back after 2 reads.
   * - A replaced fingerprint coming back within MAC_LOCK (A -> B -> A, or
   *   A -> B held then A) locks the colour: two Tilts of one colour taking
   *   turns, at random, in one slot. Nothing is published until a single
   *   fingerprint has been read alone for MAC_LOCK, in at least
   *   lockReadsNeeded() reads; a saved configuration
   *   or a restart never lifts the lock.
   * - An unreadable fingerprint changes nothing.
   */
  /** Reads of the lock fingerprint alone needed to lift it: half a day of reads, 12 at least. */
  lockReadsNeeded() {
    return Math.max(12, Math.ceil(MAC_LOCK / this.intervalMs() / 2));
  }

  checkMac(tilt, print, wall) {
    if (print === null) {
      return !tilt.candidate && !tilt.lock;
    }
    if (tilt.lock) {
      if (print !== tilt.lock || tilt.lockSince > wall) {
        Object.assign(tilt, { lock: print, lockSince: wall, lockReads: 1 });
        return false;
      }
      tilt.lockReads += 1;
      // 24 wall-clock hours AND enough reads of it alone in them: a clock
      // jumping forward, or a day without any read, never lifts the lock.
      if (wall - tilt.lockSince < MAC_LOCK || tilt.lockReads < this.lockReadsNeeded()) {
        return false;
      }
      Object.assign(tilt, { mac: print, macAt: wall, candidate: '', seen: 0 });
      Object.assign(tilt, { prev: '', prevAt: 0, lock: '', lockSince: 0, lockReads: 0 });
      return true;
    }
    if (!tilt.mac) {
      tilt.mac = print;
      tilt.macAt = wall;
      return true;
    }
    // An instant in the future (a clock set back) counts as recent: it locks.
    const recent = (at) => wall - at < MAC_LOCK;
    const back =
      (tilt.candidate && print === tilt.mac) ||
      (tilt.prev && print === tilt.prev && recent(tilt.prevAt));
    if (back) {
      Object.assign(tilt, { candidate: '', seen: 0, lock: print, lockSince: wall, lockReads: 1 });
      return false;
    }
    if (!tilt.candidate && print === tilt.mac) {
      tilt.macAt = wall;
      return true;
    }
    if (print === tilt.candidate) {
      tilt.seen += 1;
    } else {
      tilt.candidate = print;
      tilt.seen = 1;
    }
    if (tilt.seen >= MAC_CONFIRM) {
      Object.assign(tilt, { prev: tilt.mac, prevAt: tilt.macAt });
      Object.assign(tilt, { mac: print, macAt: wall, candidate: '', seen: 0 });
      return true;
    }
    return false;
  }

  /**
   * The Tilts of an answer. A reading is new when its key differs from the
   * last one seen (the raw `timeStamp`, else a digest of Temp, SG, mac and
   * timeStamp). It is published only when it is new AND recent:
   *
   * - with the `Date` of the answer (always there with the Tilt Pi), on its
   *   age alone, on the Tilt Pi clock: -5 min to 15 min (so a Tilt Pi clock
   *   set back loses nothing); current up to 3 minutes, dated beyond;
   * - without it, only once an earlier reading of the same Tilt is known
   *   and not newer, so a Tilt left silent with its last values on the Tilt
   *   Pi never looks alive, not even at the first read.
   *
   * A reading whose MAC fingerprint changed is held back (checkMac). Returns
   * whether a colour was met for the first time.
   */
  apply({ tilts, unknown, twice, date }) {
    const readMono = this.mono();
    const readAt = this.now();
    let added = false;
    for (const tilt of this.tilts.values()) {
      tilt.live = false;
      tilt.twice = twice.has(tilt.color);
      tilt.outOfRange = [];
      tilt.incoherent = false;
    }
    for (const color of twice) {
      if (!this.tilts.has(color)) {
        this.tilts.set(color, { ...newTilt(color), twice: true });
        added = true;
      }
    }
    for (const reading of tilts.values()) {
      let tilt = this.tilts.get(reading.color);
      if (!tilt) {
        tilt = newTilt(reading.color);
        this.tilts.set(reading.color, tilt);
        added = true;
      }
      const age = reading.stamp !== null && date !== null ? date - reading.stamp : null;
      if (age !== null && age < -FUTURE_TOLERANCE) {
        continue;
      }
      if (age === null) {
        const previous = stampOfKey(tilt.key);
        if (reading.stamp !== null && previous !== null && reading.stamp < previous) {
          // Older than a reading already seen, and no clock to tell: ignored.
          continue;
        }
      }
      const isNew = reading.key !== tilt.key;
      const proven = age !== null ? age <= STALE : tilt.key !== '';
      tilt.key = reading.key;
      const macOk = this.checkMac(tilt, reading.mac, readAt);
      const { values, outOfRange, incoherent } = valuesOf(reading);
      tilt.outOfRange = outOfRange;
      tilt.incoherent = incoherent;
      tilt.live = macOk && isNew && proven && Object.keys(values).length > 0;
      if (tilt.live) {
        tilt.sample = {
          values,
          key: reading.key,
          readMono,
          age: Math.max(0, age ?? 0),
          at: readAt - Math.max(0, age ?? 0),
          current: (age ?? 0) <= CURRENT,
          first: true,
        };
      }
    }
    this.unknown = unknown;
    return added;
  }

  /** A failed read: a pause (429/5xx) or a passing failure (retried at the interval). */
  failed(error, current, origin) {
    if (error.kind === 'limited' || error.kind === 'busy') {
      // Kept even when the answer comes late, as long as it is the same Tilt Pi.
      if (current || origin === this.config.address?.origin) {
        this.recordBusy(error);
      }
    }
    if (!current) {
      return;
    }
    this.error = error.kind;
    this.readOk = false;
    for (const tilt of this.tilts.values()) {
      tilt.live = false;
    }
    this.logger.warn(error.message);
  }

  /** A 429 / 5xx: Retry-After, else 5 minutes doubling; 1 minute to 6 hours. */
  recordBusy(error) {
    const streak = this.store.get().streak + 1;
    const length = clamp(
      error.retryAfterMs ?? BUSY_BASE * 2 ** Math.min(streak - 1, 10),
      BUSY_MIN,
      BUSY_MAX,
    );
    const mono = this.mono();
    this.pause = { until: mono + length, setAt: mono };
    this.store.update({ streak, pausedUntil: this.now() + length });
  }

  /**
   * The Tilts as kept under /data: colour, key of the last reading and MAC
   * fingerprints (8 hex, never the address), nothing else.
   */
  serialize() {
    return [...this.tilts.values()].map((t) => ({
      color: t.color,
      key: t.key,
      mac: t.mac,
      candidate: t.candidate,
      seen: t.seen,
      macAt: t.macAt,
      prev: t.prev,
      prevAt: t.prevAt,
      lock: t.lock,
      lockSince: t.lockSince,
      lockReads: t.lockReads,
    }));
  }

  // --- Gladys devices and states --------------------------------------------------

  devices() {
    return [...this.tilts.keys()].sort().map((color) => deviceOf(this.gladys, color));
  }

  async publish() {
    await this.publishDiscovered();
    await this.publishStates();
  }

  /** The Discovery tab, published again only when it changed. */
  async publishDiscovered({ force = false } = {}) {
    const devices = this.devices();
    const key = JSON.stringify(devices);
    if (!force && key === this.lastDiscovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.lastDiscovered = key;
    } catch (err) {
      this.logger.warn(`publishDiscoveredDevices failed: ${err.message}`);
    }
  }

  /**
   * The values of the created features, from each Tilt's last live reading.
   * A reading is handed to Gladys once per feature: as current right after
   * the read that brought it if at most 3 minutes old, else dated
   * (`created_at`, no scene fires), also to a feature created later, while
   * at most 15 minutes old; never after a
   * restart (the readings are not kept). A silent Tilt sends nothing.
   */
  async publishStates() {
    const created = new Set();
    for (const device of this.gladys.devices ?? []) {
      for (const feature of device.features ?? []) {
        created.add(feature.external_id);
      }
    }
    const mono = this.mono();
    const batch = [];
    for (const tilt of this.tilts.values()) {
      const { sample } = tilt;
      if (!sample) {
        continue;
      }
      const current = sample.first && sample.current;
      sample.first = false;
      if (mono - sample.readMono + sample.age > STALE) {
        continue;
      }
      for (const state of statesOf(this.gladys, tilt.color, sample.values)) {
        const id = state.device_feature_external_id;
        if (!created.has(id) || this.pushed.get(id) === sample.key) {
          continue;
        }
        this.pushed.set(id, sample.key);
        batch.push(current ? state : { ...state, created_at: new Date(sample.at).toISOString() });
      }
    }
    if (batch.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(batch, { heartbeat: HEARTBEAT });
    } catch (err) {
      this.logger.warn(`Publishing the states failed: ${err.message}`);
      // Sent again (dated) by the next publication, if still recent.
      for (const state of batch) {
        this.pushed.delete(state.device_feature_external_id);
      }
    }
  }

  // --- Status ------------------------------------------------------------------------

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** The Tilts, by colour. */
  sorted() {
    return [...this.tilts.values()].sort((a, b) => a.color.localeCompare(b.color));
  }

  /** What has no value, and why: [{ name, kind }]. */
  failing() {
    if (this.error) {
      return [{ name: 'Tilt Pi', kind: this.error }];
    }
    const list = [];
    for (const tilt of this.sorted()) {
      if (tilt.twice) {
        list.push({ name: `Tilt ${colorName(tilt.color)}`, kind: 'twice' });
      } else if (tilt.lock) {
        list.push({ name: `Tilt ${colorName(tilt.color)}`, kind: 'locked' });
      } else if (tilt.candidate) {
        list.push({ name: `Tilt ${colorName(tilt.color)}`, kind: 'mac' });
      } else if (!tilt.live) {
        list.push({ name: `Tilt ${colorName(tilt.color)}`, kind: 'stale' });
      }
    }
    return list;
  }

  withNotes(text) {
    const notes = [];
    if (this.unknown > 0) {
      notes.push(T.others(this.unknown));
    }
    const out = this.sorted()
      .filter((t) => t.outOfRange.length > 0)
      .map((t) => `Tilt ${colorName(t.color)} (${t.outOfRange.join(', ')})`);
    if (out.length > 0) {
      notes.push(T.outOfRange(out.join(', ')));
    }
    const incoherent = this.sorted()
      .filter((t) => t.incoherent)
      .map((t) => `Tilt ${colorName(t.color)}`);
    if (incoherent.length > 0) {
      notes.push(T.incoherent(incoherent.join(', ')));
    }
    if (notes.length === 0) {
      return text;
    }
    return {
      en: `${text.en} ${notes.map((n) => n.en).join(' ')}`,
      fr: `${text.fr} ${notes.map((n) => n.fr).join(' ')}`,
    };
  }

  configMessage() {
    if (this.config.invalid) {
      return T.invalid;
    }
    return this.config.address ? null : T.notConfigured;
  }

  async refreshStatus() {
    const missing = this.configMessage();
    if (missing) {
      return this.setStatus(false, missing);
    }
    if (!this.readOk && !this.error) {
      const at = T.nextRead(this.nextRead());
      return this.setStatus(false, {
        en: `Waiting for the first read of the Tilt Pi (${at.en}).`,
        fr: `En attente de la première lecture du Tilt Pi (${at.fr}).`,
      });
    }
    const text = T.ok({
      tilts: [...this.tilts.values()].filter((t) => !t.twice).length,
      interval: this.config.pollMinutes,
      failing: this.failing(),
    });
    return this.setStatus(!this.error, this.withNotes(text));
  }

  // --- Configuration screen button -------------------------------------------------

  tiltLine(tilt, lang) {
    const colon = lang === 'fr' ? ' :' : ':';
    const name = `Tilt ${colorName(tilt.color)}`;
    if (tilt.twice) {
      return `- ${name}${colon} ${reason('twice')[lang]}`;
    }
    if (tilt.lock) {
      return `- ${name}${colon} ${reason('locked')[lang]}`;
    }
    if (tilt.candidate) {
      return `- ${name}${colon} ${reason('mac')[lang]}`;
    }
    if (!tilt.live || !tilt.sample) {
      return `- ${name}${colon} ${reason('stale')[lang]}`;
    }
    const v = tilt.sample.values;
    const parts = [];
    if (Number.isFinite(v.gravity)) {
      parts.push(`${lang === 'fr' ? 'densité' : 'gravity'} ${numberText(v.gravity, 3, lang)}`);
    }
    if (Number.isFinite(v.temperature)) {
      parts.push(
        `${lang === 'fr' ? 'température' : 'temperature'} ${numberText(v.temperature, 1, lang)} °C`,
      );
    }
    return `- ${name}${colon} ${parts.join(', ')}`;
  }

  lines(lang) {
    const colon = lang === 'fr' ? ' :' : ':';
    const head = [];
    if (this.error) {
      head.push(reason(this.error)[lang]);
      if (this.pauseEnd() > this.mono()) {
        head.push(T.pausedUntil(this.now() + this.pauseEnd() - this.mono())[lang]);
      }
    } else if (!this.readOk) {
      head.push(lang === 'fr' ? 'pas encore lu depuis le démarrage' : 'not read since the start');
    } else {
      head.push(lang === 'fr' ? `${this.tilts.size} Tilt` : `${this.tilts.size} Tilt(s)`);
    }
    head.push(T.nextRead(this.nextRead())[lang]);
    const lines = [`Tilt Pi ${this.config.address.origin}${colon} ${head.join(', ')}`];
    if (!this.error && this.readOk) {
      for (const tilt of this.sorted()) {
        lines.push(this.tiltLine(tilt, lang));
      }
    }
    return lines;
  }

  async testConnection() {
    const missing = this.configMessage();
    if (missing) {
      return missing;
    }
    // The button reads only what is due (never sooner than the interval);
    // past the deadline the last values are shown and a read still running
    // finishes in the background.
    let timer;
    const timeout = new Promise((resolve) => {
      timer = this.timers.setTimeout(resolve, TEST_DEADLINE);
    });
    try {
      await Promise.race([this.tick(), timeout]);
    } finally {
      this.timers.clearTimeout(timer);
    }
    await this.publishDiscovered();
    await this.refreshStatus();
    return this.withNotes({ en: this.lines('en').join('\n'), fr: this.lines('fr').join('\n') });
  }
}
