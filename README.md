# gladys-tilt-pi

[Gladys Assistant](https://gladysassistant.com) external integration for the
**Tilt** hydrometers, read from the **Tilt Pi** app (on a Raspberry Pi of
your network) through its local HTTP API: the specific gravity and the
temperature of each Tilt, one device per Tilt colour. Read only, no cloud,
no Bluetooth in Gladys (the Tilt Pi listens to the Tilts). **Unofficial,
not affiliated with Tilt Hydrometer. Never tested with a real Tilt Pi yet.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (TiltPiApp)   what is due, pause, devices, states, status, test
                 ├─ src/tiltpi.js          GET /macid/all, error kinds, strict bounded parsing
                 ├─ src/fields.js          readings -> values in core units, devices, states (pure)
                 ├─ src/store.js           pace, pause, Tilts met, persisted in /data
                 ├─ src/config.js          DEFAULT_CONFIG, the address, normalization
                 └─ src/http.js            fetch, timeout, no redirection, bounded body
```

- **Read**: `GET http://<address>:1880/macid/all` at each interval (5
  minutes by default), never faster: test button, reconnections, saved
  configuration, Discovery and restarts included (the instant of the last
  request is persisted before it leaves, written at most once per minute;
  in memory the interval and the pauses run on a monotonic clock).
- **Readings**: told apart by the raw `timeStamp` of the Tilt Pi (else a
  digest of Temp, SG, mac and timeStamp), handed to Gladys once; with the
  `Date` header, on their age alone: current up to 3 minutes, dated up to
  15; undated ones only once a change proves the Tilt alive. A silent Tilt
  sends nothing. `Temp` is always °F (the Tilt Pi flow). A changed MAC
  fingerprint on a colour holds it back until read twice in a row; a
  replaced one coming back within 24 h locks the colour for 24 h of one
  MAC alone.
- **429/5xx** → `Retry-After`, else 5 minutes doubling, between 1 minute
  and 6 hours, persisted.
- **Devices**: `tilt:<colour>` (the eight Tilt colours), features
  `gravity` (`unknown`, no unit: the core has none for a density) and
  `temperature` (°C, `probe`). A feature once created is never dropped
  from the Discovery list.

No runtime dependency besides the Gladys SDK.

## Development

```bash
npm install
npm test                                        # node --test (fake Gladys, fake fetch, a loopback server)
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
node .github/scripts/cover.mjs                  # draws cover.png (no dependency)
```

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags,
builds the multi-arch image to GHCR and publishes the GitHub Release.

## Credits

- [michaelheyman/tilt-pi](https://github.com/michaelheyman/tilt-pi) (MIT,
  Michael Heyman): the route, the fields and the colours of the Tilt Pi API,
  as the Tilt Pi integration of Home Assistant reads them.

Its notice is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Apache-2.0 ([LICENSE](LICENSE)). Tilt is a trademark of its owner.
