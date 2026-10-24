# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with a real Tilt Pi and at least one Tilt:
      the devices of the Discovery tab, their values, the status, the test
      button, a Tilt taken out of range. Never done yet.
- [ ] Run the store validator with the image check once the image is
      published.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store.

## Facts of the Tilt Pi app (settled)

Read in the official Node-RED flow of the app, `baronbrew/TILTpi`
`flow.json`, commit e2aeef6 of 2025-08-08 (found by the review r1). That
repository has no license: it was read for its facts only, nothing of it is
copied, so nothing is added to `THIRD_PARTY_NOTICES.md`.

- `Temp` is **always °F**: with a page in °C, the flow converts to °C to
  calibrate, then back to °F (`Temp`); `tempunits` and `displayTemp`
  follow the page. Hence no unit option, and a disagreement between `Temp`
  and `displayTemp` drops the temperature.
- `timeStamp` (`Date.now()` of the Raspberry Pi) is always set, and the
  answer has a `Date` header (Node sets it).
- `SG` is always a gravity (Plato and Brix go to `ferm`).
- A Tilt silent more than `displayTimeout` (120 s by default) makes the flow
  clear **every** slot; they fill again with the next frames. Without Tilt
  the answer is `{}` (the `http in` payload), not `[]`.
- Entries are kept per colour (25 slots at most): two Tilts of one colour
  share a slot, the last heard wins. The "ID by MAC" option gives each its
  own entry, `Color = "RED:aa:bb:cc:dd:ee:ff"`.
- On a broken temperature calibration the flow falls back to `calTemp = 0`,
  so `Temp: "0.0"` (-17.8 °C, out of the -10 to 60 °C bounds). The same
  fallback with a page in °C gives 0 °C once converted back to 32 °F: that
  case stays undetectable.

## To confirm on a real Tilt Pi

- [ ] Tilt HD / Tilt Pro: `SG` with 4 decimals (kept, rounded to 4).

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
  a Tilt Pi tells Tilts apart; `Color` is `RED` or, in the "ID by MAC"
  mode, `RED:aa:bb:cc:dd:ee:ff` (the colour still the identity, external
  ids unchanged). An unknown colour is skipped and counted. Two entries of
  the same colour (ID by MAC with two Tilts of one colour): neither is
  published. Without ID by MAC two Tilts share one entry: an 8-hex
  fingerprint of the MAC (sha256, kept in memory and under `/data`, never
  the address) is compared per colour (lesson 11: MAC against MAC); a
  change holds the colour back ("MAC changed: two Tilts of this colour, or
  a Tilt replaced") until the same new fingerprint is read twice in a row
  (`MAC_CONFIRM`); an unreadable MAC changes nothing.
- **Units**: the core has no density category nor unit
  (`DEVICE_FEATURE_UNITS_BY_CATEGORY`, checked in
  `~/code/Gladys/server/utils/constants.js`): the gravity is an `unknown`
  decimal sensor without unit, "SG" in its name only, bounds 0.95 to 1.2
  (the Tilt reads 0.990 to 1.120), 4 decimals. The temperature is
  `temperature-sensor` / `probe` in °C, always converted from the °F of
  `Temp` (`(F - 32) × 5 / 9`, 1 decimal), bounds -10 to 60 °C (a wort;
  the 0 °F fallback is left out). A value out of bounds is left out, never
  clamped, and reported in the status; a `Temp` disagreeing with
  `displayTemp` in `tempunits` (°C: > 0.3, °F: > 0.2) is not published and
  reported.
- **Silent Tilt never shown alive (lesson 28)**: a reading is new when its
  raw key changes (the `timeStamp` of the entry when it is a plausible
  Unix time in ms, else a sha256 digest of `Temp`, `SG`, `mac` and the raw
  `timeStamp` only, never `rssi`, `clock`, `Timepoint`); the last key of
  each colour is kept under `/data`, so a reading is published once, also
  across a restart. With the `Date` header, the age alone decides, on the
  Tilt Pi clock: -5 to 15 minutes (a Raspberry Pi clock set back loses
  nothing). Without it, an older `timeStamp` than the last one is ignored,
  and a reading is published only when an earlier key of the same colour
  is known and differs: the first sight after an install is never
  published. The status lists every Tilt without a new reading at the
  last read ("no recent reading"). `{}` is no Tilt: the Tilt Pi stays
  connected, the known Tilts are "no recent reading".
- **States**: a new reading at most 3 minutes old (`CURRENT`) is current;
  3 to 15 minutes, dated (`created_at` = its time, no scene; lot 12 rule:
  never a stale value as new). A device created later gets the last live
  reading dated while it is at most 15 minutes old; never after a restart
  (the values are not kept). `publishChangedStates` with a 30-minute
  heartbeat for an unchanged value of a NEW reading. At most 8 colours × 2
  features per read (one read a minute at most): far under the 300 states
  a minute of the core, so no budget queue.
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
