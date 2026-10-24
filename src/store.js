// -----------------------------------------------------------------------------
// What must survive a restart of the container (a file under /data): the
// address read last, the instant of the last request to the Tilt Pi, the
// end of a pause (429/5xx), and the Tilts met (colour and the key of the
// last reading seen: nothing else), so a container restarting in a loop
// never reads faster than the interval, a reading already published is never
// published again, and the Discovery list is not empty after a restart.
//
// The instant of a request is written at most once per minute (WRITE_GAP
// after the previous write, whatever it was; the instant of the write is
// kept in the file): a read waits until such a write is allowed, so the
// instant of its request is always on disk before the request leaves. A
// pause or a new Tilt is written at once (one such write per request at
// most).
//
// Instants in the file are wall-clock times (they must survive a restart);
// the app turns them into monotonic deadlines when it loads them, capped.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { COLORS, WRITE_GAP } from './constants.js';

/** A storage in memory (tests, and the fallback). */
export function memoryStorage(initial) {
  let value = initial;
  return {
    writes: 0,
    load: () => value,
    save(next) {
      this.writes += 1;
      value = JSON.parse(JSON.stringify(next));
    },
  };
}

/**
 * A JSON file, written atomically (a .tmp file, then a rename). A missing or
 * unreadable file is a first start (warned once, without its content); a
 * write failure is warned once: memory only then.
 */
export function fileStorage(path, { logger } = {}) {
  const warned = new Set();
  const warnOnce = (kind, text) => {
    if (!warned.has(kind)) {
      warned.add(kind);
      logger?.warn?.(text);
    }
  };
  return {
    load() {
      let text;
      try {
        text = readFileSync(path, 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') {
          warnOnce('read', `State file unreadable (${err.code ?? 'error'}): starting afresh`);
        }
        return undefined;
      }
      if (text.length > 64 * 1024) {
        warnOnce('read', 'State file too large: starting afresh');
        return undefined;
      }
      try {
        return JSON.parse(text);
      } catch {
        warnOnce('read', 'State file corrupt: starting afresh');
        return undefined;
      }
    },
    save(value) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, JSON.stringify(value));
        renameSync(tmp, path);
      } catch (err) {
        warnOnce('write', `State file not writable (${err.code ?? 'error'}): kept in memory`);
      }
    },
  };
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** A Tilt read back from the file, or undefined when it does not look right. */
function tiltOf(value) {
  if (!value || typeof value !== 'object' || !COLORS.includes(value.color)) {
    return undefined;
  }
  return {
    color: value.color,
    key:
      typeof value.key === 'string' && /^(t\d{1,16}|d[0-9a-f]{16})$/.test(value.key)
        ? value.key
        : '',
  };
}

export class Store {
  constructor({
    storage = memoryStorage(),
    now = Date.now,
    timers = { setTimeout, clearTimeout },
  }) {
    this.storage = storage;
    this.now = now;
    this.timers = timers;
    this.flushTimer = undefined;
    this.dirty = false;
    const saved = storage.load();
    const valid = saved && typeof saved === 'object' && !Array.isArray(saved);
    const at = now();
    // The instant of the last write, never in the future: a restart loop
    // writes no more often than a running process.
    this.writtenAt = valid ? Math.min(finite(saved.writtenAt), at) : 0;
    const seen = new Set();
    this.entry = {
      address: valid && typeof saved.address === 'string' ? saved.address.slice(0, 300) : '',
      lastAttemptAt: valid ? finite(saved.lastAttemptAt) : 0,
      pausedUntil: valid ? finite(saved.pausedUntil) : 0,
      streak: valid ? Math.min(Math.max(0, Math.floor(finite(saved.streak))), 20) : 0,
      tilts:
        valid && Array.isArray(saved.tilts)
          ? saved.tilts
              .slice(0, COLORS.length)
              .map(tiltOf)
              .filter((t) => t && !seen.has(t.color) && seen.add(t.color))
          : [],
    };
  }

  get() {
    return this.entry;
  }

  /**
   * Update the entry. A change is written at once (a pause, a new Tilt: one
   * per request at most), or with `defer` at the next allowed instant.
   */
  update(changes, { defer = false } = {}) {
    const previous = this.entry;
    const next = { ...previous, ...changes };
    this.entry = next;
    if (JSON.stringify(next) !== JSON.stringify(previous)) {
      if (defer) {
        this.markDirty();
      } else {
        this.dirty = true;
        this.write();
      }
    }
    return next;
  }

  /** The first instant a write is allowed. */
  writableAt() {
    return this.writtenAt + WRITE_GAP;
  }

  canWrite() {
    const now = this.now();
    // A clock set back: the gap is counted from now, never forever.
    if (this.writtenAt > now) {
      this.writtenAt = now;
    }
    return now >= this.writableAt();
  }

  markDirty() {
    this.dirty = true;
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushTimer !== undefined) {
      return;
    }
    const delay = Math.min(WRITE_GAP, Math.max(0, this.writableAt() - this.now()));
    this.flushTimer = this.timers.setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, delay);
  }

  /** Write the file now if something changed and a write is allowed; returns whether it is on disk. */
  flush({ force = false } = {}) {
    if (!this.dirty) {
      return true;
    }
    if (!force && !this.canWrite()) {
      this.scheduleFlush();
      return false;
    }
    this.write();
    return true;
  }

  write() {
    this.timers.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.writtenAt = this.now();
    this.dirty = false;
    this.storage.save({ writtenAt: this.writtenAt, ...this.entry });
  }

  /** Stop the pending write (the next start writes what is left). */
  close() {
    this.timers.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }
}
