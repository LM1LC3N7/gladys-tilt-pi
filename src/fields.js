// -----------------------------------------------------------------------------
// What a Tilt measures, and how it lands in Gladys. Pure: no clock, no
// network.
//
// One Gladys device per Tilt colour, two features:
//
// - `gravity`: the specific gravity (SG, about 1.000 for water). The Gladys
//   core has no category nor unit for a density
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY of server/utils/constants.js): an
//   `unknown` sensor without unit, "SG" in its name only. No unit invented.
// - `temperature`: the temperature of the wort, in °C (a unit the core lists
//   for `temperature-sensor`), as a `probe`: kept out of the room temperature
//   average of Gladys.
//
// The feature key is a name of this integration, never a Tilt Pi field: it
// is part of the external id, so it never changes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE } from './constants.js';
import { colorName } from './tiltpi.js';

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

export const fahrenheitToCelsius = (f) => ((f - 32) * 5) / 9;

/**
 * [feature key, feature definition, read(tilt, celsius)]: the order of the
 * features in Gladys. A value out of [min, max] is left out, never clamped
 * into a false reading.
 */
export const TABLE = [
  [
    'gravity',
    {
      name: 'Specific gravity (SG)',
      category: CAT.UNKNOWN,
      type: TYPES.SENSOR.DECIMAL,
      // The Tilt measures 0.990 to 1.120; a little margin on both sides.
      min: 0.95,
      max: 1.2,
    },
    (tilt) => (tilt.sg === null ? null : round(tilt.sg, 4)),
  ],
  [
    'temperature',
    {
      name: 'Temperature',
      category: CAT.TEMPERATURE_SENSOR,
      type: TYPES.TEMPERATURE_SENSOR.PROBE,
      unit: UNITS.CELSIUS,
      min: -20,
      max: 110,
    },
    (tilt, celsius) =>
      tilt.temp === null ? null : round(celsius ? tilt.temp : fahrenheitToCelsius(tilt.temp), 1),
  ],
];

const KEYS = new Set(TABLE.map(([key]) => key));

/**
 * The usable values of a Tilt: `{ values, outOfRange: [keys] }`. `celsius`:
 * the Tilt Pi sends Celsius (option), else Fahrenheit (tilt-pi).
 */
export function valuesOf(tilt, celsius) {
  const values = {};
  const outOfRange = [];
  for (const [key, def, read] of TABLE) {
    const value = read(tilt, celsius);
    if (value === null || !Number.isFinite(value)) {
      continue;
    }
    if (value >= def.min && value <= def.max) {
      values[key] = value;
    } else {
      outOfRange.push(key);
    }
  }
  return { values, outOfRange };
}

// --- Gladys devices and states ------------------------------------------------------

const idsOf = (gladys, color) => gladys.externalIds(DEVICE_TYPE, color);

/**
 * The Gladys device of a Tilt colour: both features, plus every feature of
 * the device already created (gladys.devices), so a feature this version no
 * longer knows is never removed (the core would mark the device as changed
 * and "Update" would drop its history).
 */
export function deviceOf(gladys, color) {
  const ids = idsOf(gladys, color);
  const features = TABLE.map(([key, def]) => ({
    name: def.name,
    external_id: ids.feature(key),
    category: def.category,
    type: def.type,
    ...(def.unit ? { unit: def.unit } : {}),
    min: def.min,
    max: def.max,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  }));
  const created = (gladys.devices ?? []).find((d) => d.external_id === ids.device);
  const prefix = `${ids.device}:`;
  for (const feature of created?.features ?? []) {
    const id = String(feature.external_id ?? '');
    const key = id.startsWith(prefix) ? id.slice(prefix.length) : '';
    if (key && !KEYS.has(key)) {
      features.push({
        name: feature.name,
        external_id: feature.external_id,
        category: feature.category,
        type: feature.type,
        ...(feature.unit ? { unit: feature.unit } : {}),
        min: feature.min,
        max: feature.max,
        read_only: true,
        has_feedback: false,
        keep_history: feature.keep_history !== false,
      });
    }
  }
  return {
    name: `Tilt ${colorName(color)}`,
    external_id: ids.device,
    // The integration reads the Tilt Pi at its own pace: Gladys has nothing to poll.
    should_poll: false,
    features,
  };
}

/** The states of the values of a Tilt, for the publishStates format. */
export function statesOf(gladys, color, values) {
  const ids = idsOf(gladys, color);
  return TABLE.filter(([key]) => Number.isFinite(values?.[key])).map(([key]) => ({
    device_feature_external_id: ids.feature(key),
    state: values[key],
  }));
}
