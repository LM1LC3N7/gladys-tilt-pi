# Tilt Pi

**Unofficial connector, not affiliated with Tilt Hydrometer (Baron Brew
Equipment).** It brings into Gladys the **Tilt** hydrometers floating in
your fermenters (beer, wine, cider, mead...), read from the **Tilt Pi** app
running on a Raspberry Pi on your network, through its local HTTP API,
without any cloud.

> **This integration has never been tested with a real Tilt Pi.** It follows
> the `tilt-pi` library used by the Tilt Pi integration of Home Assistant.
> Please report what you see on the Gladys forum.

## What you need

- One or more **Tilt** (or Tilt Pro, Tilt HD).
- A **Raspberry Pi running the Tilt Pi app** (the official Tilt Pi image),
  on the same network as Gladys, that shows your Tilts on its web page
  (`http://<Raspberry Pi address>:1880/`). The Tilt Pi listens to the Tilts
  over **Bluetooth**, on its Raspberry Pi: Gladys never uses Bluetooth (a
  Gladys integration runs in a container without Bluetooth).

## What you get

One Gladys device per Tilt **colour** ("Tilt Red", "Tilt Blue"...):

| Feature               | Unit                | Notes                                             |
| --------------------- | ------------------- | ------------------------------------------------- |
| Specific gravity (SG) | none ("SG" in name) | the gravity, about 1.000 for water                |
| Temperature           | °C                  | a probe: kept out of the room temperature average |

- Gladys has no category nor unit for a density: the gravity is an
  "unknown" sensor without unit, its unit (SG) only written in its name. No
  unit is invented.
- The colour is the identity of a Tilt on a Tilt Pi: the device of a colour
  stays the same, even when you swap the Tilt of that colour.
- The feature names are in English; rename them at creation if you like.

## Installation

1. Install the integration from the Gladys catalog (Gladys 5.1 or later).
2. On the **Configuration** screen, enter the **Tilt Pi address** (the IP
   address of the Raspberry Pi, e.g. `192.168.1.30`, with `:port` only if it
   is not 1880).
3. Click **Test the Tilt Pi**: the message shows the gravity and the
   temperature of each Tilt.
4. Open the **Discovery** tab and add the devices.

## Configuration

- **Tilt Pi address**: an IP address or a host name, with a port if it is
  not 1880; `http://` is accepted, not `https://` (the Tilt Pi page has
  none), nor a path or a user. Give the Raspberry Pi a fixed address in
  your router. A new address is read at once (one request a minute at
  most).
- **Read interval**: 5 minutes by default, 1 to 60.
- **Temperature unit sent by the Tilt Pi**: Fahrenheit by default, as the
  `tilt-pi` library reads it. If the temperature looks wrong in Gladys
  (about 20 °C shown as -7 °C), choose Celsius. Gladys always stores °C.

## How often the Tilt Pi is read

- A read sends **one request**: `GET /macid/all` (every Tilt the Tilt Pi
  hears).
- **Never faster than the interval**, counted from the last read on a
  monotonic clock (a clock change never reads sooner): not by the test
  button, a reconnection to Gladys, an unchanged saved configuration, the
  Discovery tab nor a restart of the container (the instant of the last
  request is kept under `/data`, written before the request leaves). Before
  the interval has passed, the test button shows the last values and when
  the next read can happen.
- **Read only**: the integration never writes anything to the Tilt Pi.
- When the Tilt Pi answers **429 or a 5xx error**, it is left alone for the
  `Retry-After` it gives, else 5 minutes, then 10, 20...; always between 1
  minute and 6 hours, also across a restart.
- No answer, a page that is not a Tilt Pi (404, an answer that is not a
  list) or a refused access: tried again at the next interval only.

## Which values reach Gladys

- Each reading is handed to Gladys **once**. A reading is told apart by its
  time (`timeStamp`) when the Tilt Pi gives one, else by the content of its
  entry (a live Tilt changes at least its signal).
- A **silent** Tilt (out of range, flat battery, out of the fermenter) is
  **never shown alive**: when its reading no longer changes, nothing is
  sent, and the status shows "no recent reading". A reading dated more than
  15 minutes ago, measured with the Tilt Pi clock (the `Date` of its
  answer), is never sent. Without a time, the first reading seen of a Tilt
  is not sent: only a reading that changed since the previous read proves
  the Tilt alive.
- A value out of range (gravity outside 0.950 to 1.200, temperature outside
  -20 to 110 °C) is never sent nor clamped; the status reports it.
- Two Tilts of the same colour on the Tilt Pi: neither is sent (there is no
  telling which is which), the status reports it.
- A device created later gets the last reading, dated, if it is less than
  15 minutes old.

## What is kept under `/data`

The address read, the instant of the last request, the pause, and for each
colour met the key of the last reading seen (its time, or a short digest of
the entry): never the MAC address of a Tilt, never the values. The file is
written at most once per minute, but for a pause or a new colour.

8 colours at most; 50 entries at most are read; an answer larger than 256
KB, or slower than 15 seconds, is dropped.

## External ids

`ext:tilt-pi:tilt:<colour>` (`black`, `blue`, `green`, `orange`, `pink`,
`purple`, `red`, `yellow`), then `:gravity` or `:temperature`. These ids
never change.

## Troubleshooting

- **"no answer"**: check the address, and that the Tilt Pi page
  `http://<address>:1880/` opens from your network.
- **"no Tilt Pi at this address (404)"**: another service answers at this
  address; check the port.
- **"no recent reading"**: the Tilt Pi has not heard this Tilt lately
  (Bluetooth range, battery, Tilt lying out of the liquid).
- Logs: the level is set with the `LOG_LEVEL` variable.

## Privacy

The integration only talks to the Tilt Pi, on your local network, over
HTTP. Of its answers it keeps only the colour, the gravity and the
temperature.

## Credits

Built after [michaelheyman/tilt-pi](https://github.com/michaelheyman/tilt-pi)
(MIT, Michael Heyman), the library of the Tilt Pi integration of Home
Assistant: the route, the fields and their units are ported to JavaScript.
Its notice is in `THIRD_PARTY_NOTICES.md`. Tilt is a trademark of its
owner; this connector is free and unofficial.
