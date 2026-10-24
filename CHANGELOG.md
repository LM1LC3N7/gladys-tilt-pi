# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Your Tilt hydrometers in Gladys, read only, from the Tilt Pi app on your
  network (its local HTTP API, `GET /macid/all`): the address of the Tilt
  Pi, nothing else; no cloud, no Bluetooth in Gladys.
- One device per Tilt colour: the specific gravity (a sensor without unit,
  the core has none for a density) and the temperature in °C (a probe, kept
  out of the room average); a Celsius option for a Tilt Pi that sends °C.
- Read every 5 minutes by default, never faster: not by the test button, a
  reconnection, a saved configuration, the Discovery tab nor a restart.
  A 429 or 5xx pauses the reads (Retry-After, else 5 minutes doubling,
  between 1 minute and 6 hours), also across a restart.
- Each reading is handed to Gladys once; a silent Tilt is never shown alive
  (nothing is sent, the status says "no recent reading"); a reading more
  than 15 minutes old on the Tilt Pi clock is never sent.
