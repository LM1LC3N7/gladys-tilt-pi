# Third-party notices

This integration is licensed under Apache-2.0 (see `LICENSE`). It ports to
JavaScript parts of the following project, under the MIT license. No code
of it is shipped as is: its logic was rewritten.

## michaelheyman/tilt-pi

- Project: https://github.com/michaelheyman/tilt-pi (Python client of the
  Tilt Pi API, PyPI package `tilt-pi`, used by the Tilt Pi integration of
  Home Assistant; tag v0.2.1, the PyPI version 0.2.1, commit f4eb22f of
  2025-06-16)
- Author: Michael Heyman
- Ported: the route `GET /macid/all` on port 1880 (`tiltpi/api.py`), the
  fields read of each entry (`mac`, `Color` in title case, `Temp` in
  degrees Fahrenheit, `SG`), the eight Tilt colours (`tiltpi/model.py`) and
  the 15-second timeout.
- Changes: rewritten in JavaScript; the answer bounded in size and number of
  entries, numbers parsed strictly, only own fields read (no prototype
  pollution), an unknown colour or a colour heard twice left out; the
  optional `timeStamp` of an entry used to date a reading; no redirection
  followed.
- License: MIT, reproduced below.

```
MIT License

Copyright (c) 2025 Michael Heyman

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
