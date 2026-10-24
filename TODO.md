# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with a real Tilt Pi and at least one Tilt:
      the devices of the Discovery tab, their values, the status, the test
      button, a Tilt taken out of range. Never done yet.
- [ ] Run the store validator with the image check once the image is
      published.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store.

## To confirm on a real Tilt Pi

- [ ] The unit of `Temp` in `/macid/all`: tilt-pi and Home Assistant read
      it as °F; whether it follows the Celsius setting of the Tilt Pi page
      (then the `temperature_unit` option is needed, or could be guessed
      from a `tempunits` field).
- [ ] Whether entries carry a `timeStamp` (ms) and whether the Tilt Pi
      answer has a `Date` header (Node-RED adds one): without them,
      readings are dated by change only.
- [ ] Whether a Tilt no longer heard stays in `/macid/all` with its last
      values (then it is reported "no recent reading", as designed) or
      disappears.
- [ ] Tilt HD / Tilt Pro: `SG` with 4 decimals (kept, rounded to 4).
- [ ] What `SG` holds when the Tilt Pi shows Plato or Brix (out of range
      here, so left out and reported).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag
  (`ghcr.io/lm1lc3n7/gladys-tilt-pi:0.1.0`); the first patch release gives
  0.1.1.
- **Reference**: michaelheyman/tilt-pi (MIT, tag v0.2.1 = PyPI 0.2.1,
  commit f4eb22f of 2025-06-16; the publish workflow sets the version from
  the tag, `pyproject.toml` still says 0.2.0), license read in its LICENSE file (not GPL),
  cloned read only in `~/code/ref/lot15/tilt-pi`. Ported to JavaScript,
  credited in the docs and in `THIRD_PARTY_NOTICES.md` with the MIT notice
  in full (copied into the image with `LICENSE`). The User-Agent names this
  integration.
- **Neighbour module**: gladys-sensorpush (read only, pace and state file
  under `/data`, pauses, test button, readings told apart by their raw key,
  devices that never lose a feature). Simplified: no account, no secret,
  one route.
- **Read only, local only, no Bluetooth**: one route, `GET /macid/all`
  (tilt-pi `ENDPOINT_GET_ALL`), port 1880 by default. The Tilt Pi does the
  Bluetooth on its Raspberry Pi.
- **Identity**: one device per Tilt colour (`ext:tilt-pi:tilt:<colour>`,
  the eight colours of tilt-pi `TiltColor`, lower case): the colour is how
  a Tilt Pi tells Tilts apart; an unknown colour is skipped and counted.
  The MAC address is never used for the id nor kept (only inside the digest
  of an undated entry). Two entries of the same colour (two Tilts, or a
  swapped Tilt still listed): neither is published (no merge without
  proof), the status says so.
- **Units**: the core has no density category nor unit
  (`DEVICE_FEATURE_UNITS_BY_CATEGORY`, checked in
  `~/code/Gladys/server/utils/constants.js`): the gravity is an `unknown`
  decimal sensor without unit, "SG" in its name only, bounds 0.95 to 1.2
  (the Tilt reads 0.990 to 1.120), 4 decimals. The temperature is
  `temperature-sensor` / `probe` in °C (converted from °F unless the option
  says the Tilt Pi sends °C), bounds -20 to 110 °C, 1 decimal. A value out
  of bounds is left out, never clamped, and reported in the status.
- **Silent Tilt never shown alive (lesson 28)**: a reading is new when its
  raw key changes (the `timeStamp` of the entry when it is a plausible
  Unix time in ms, else a sha256 digest of the whole entry); the last key
  of each colour is kept under `/data`, so a reading is published once,
  also across a restart. A dated reading is published only when at most
  15 minutes old on the Tilt Pi clock (`Date` header; a reading more than
  5 minutes in the future, or older than the last one seen, is ignored).
  An undated reading (no `timeStamp` or no `Date`) is published only when
  an earlier key of the same colour is known and differs: the first sight
  after an install is never published. The status lists every Tilt without
  a new reading at the last read ("no recent reading").
- **States**: current right after the read that brought them; a device
  created later gets the last live reading dated (`created_at`, no scene)
  up to 15 minutes after the read; never after a restart (the values are
  not kept). `publishChangedStates` with a 30-minute heartbeat for an
  unchanged value of a NEW reading. At most 8 colours × 2 features per
  read (one read a minute at most): far under the 300 states a minute of
  the core, so no budget queue.
- **Pace (lessons 11, 12; lesson 5 of lot 14)**: the instant of a request is
  written to `/data` (wall clock) before it leaves, a read waits until a
  write is allowed (60 s after the previous one). In memory the interval
  and the pause run on `performance.now()` (monotonic); loaded from `/data`
  once per process: a request instant in the future counts as just made
  (whole interval), a pause is capped at 6 hours, and capped again at each
  use. Nothing reads before last request + interval (test button,
  reconnection, unchanged configuration, Discovery, restart). A new address
  is read at once (still one request a minute at most): its pace is its
  own. A reconnection during a read starts no other read (chained reads).
- **Errors**: 429 / 5xx → pause (Retry-After, else 5 minutes doubling, 1
  minute to 6 hours), persisted; 401/403, 404, other statuses, not a JSON
  list, network → retried at the interval (no secret here, nothing to lock
  out). A late answer of an old start publishes nothing and sets no status
  (a pause of the same address is still kept).
- **Bounded answers**: 256 KB and 15 s (body included), chunks joined once,
  no redirection; at most 50 entries looked at; numbers parsed strictly
  (number or decimal string; `''`, `null`, exponents are unknown); own
  fields only.
- **Address**: IP, host name or bracketed IPv6, optional port and
  `http://`; no `https`, path, query or user; any, broadcast and multicast
  refused; a control character refused before any request.
- **Status and Discovery republished at each `connected`** (the core keeps
  them in memory only); the pace and the pause are kept.
- **No command, no energy index, no scene event, no secret**: those rules do
  not apply.

## Ideas

- The signal (`rssi`) and the battery age of the Tilt, if the Tilt Pi gives
  them reliably.
- The beer name of the Tilt Pi in the test button.
