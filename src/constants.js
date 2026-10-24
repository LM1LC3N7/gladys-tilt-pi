// -----------------------------------------------------------------------------
// The Tilt Pi route, limits, pacing and the keys users store (manifest keys,
// device types, feature keys): the keys are forever, never rename them.
// -----------------------------------------------------------------------------

/** The port of the Tilt Pi web page (Node-RED), as tilt-pi and its tests use it. */
export const DEFAULT_PORT = 1880;

/** The one route read: every Tilt the Tilt Pi hears (tilt-pi `ENDPOINT_GET_ALL`). */
export const ROUTE = '/macid/all';

export const USER_AGENT = 'gladys-tilt-pi (+https://github.com/LM1LC3N7/gladys-tilt-pi)';

/** One HTTP call, the body read included (tilt-pi waits 15 s too). */
export const HTTP_TIMEOUT = 15_000;

/** The most an answer may weigh (a few hundred bytes per Tilt). */
export const MAX_BODY = 256 * 1024;

/** At most this many entries of an answer are looked at. */
export const MAX_ENTRIES = 50;

/** How often the integration checks what is due. */
export const TICK = 15_000;

/**
 * The state file under /data is written at most once per minute (flash
 * memory, restart loops): a read waits for that too.
 */
export const WRITE_GAP = 60_000;

/**
 * 429 / 5xx: a pause, from Retry-After when given, else 5 minutes doubling;
 * always between 1 minute and 6 hours.
 */
export const BUSY_MIN = 60_000;
export const BUSY_BASE = 5 * 60_000;
export const BUSY_MAX = 6 * 60 * 60_000;

/**
 * A reading dated by the Tilt Pi (`timeStamp`) more than this old, on the
 * clock of the Tilt Pi (the `Date` of its answer), is never published: a
 * Tilt broadcasts every few seconds, a silent one is out of range, flat or
 * out of the fermenter.
 */
export const STALE = 15 * 60_000;

/** A reading more than this in the future of the Tilt Pi clock is ignored. */
export const FUTURE_TOLERANCE = 5 * 60_000;

/**
 * An unchanged value of a NEW reading is re-sent after this (a reading
 * already published is never handed to the SDK again, so this never
 * refreshes a silent Tilt).
 */
export const HEARTBEAT = 30 * 60_000;

/** The test button answers within this, with the last values if needed. */
export const TEST_DEADLINE = 25_000;

/** Where the pace, the pause and the Tilts met survive a restart. */
export const STATE_FILE = '/data/tilt-pi-state.json';

/** Device type of the external ids (`ext:tilt-pi:tilt:<color>`). */
export const DEVICE_TYPE = 'tilt';

/**
 * The eight Tilt colours (tilt-pi `TiltColor`), lower case: the colour is the
 * identity of a Tilt on a Tilt Pi, and the last part of its external id.
 */
export const COLORS = ['black', 'blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow'];

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};
