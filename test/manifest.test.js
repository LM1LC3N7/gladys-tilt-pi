// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. They also guard
// the text files against mojibake, a BOM and control bytes (a manifest once
// shipped broken), and the texts against the word "encrypted" for a secret
// field (Gladys keeps a secret in clear in its database; this integration
// has none, and the manifest test forbids a `default` on any secret).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTIONS, COLORS } from '../src/constants.js';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';
import { TABLE, deviceOf } from '../src/fields.js';

const readBuffer = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const read = (path) => readBuffer(path).toString('utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const USER_DOCS = ['docs/en.md', 'docs/fr.md', 'README.md', 'CHANGELOG.md'];

// Built from code points, so that this file passes its own check.
const REPLACEMENT = String.fromCharCode(0xfffd);
const MOJIBAKE = [[0xc3], [0xc2], [0xe2, 0x20ac]].map((codes) => String.fromCharCode(...codes));
const isCombining = (c) => c.charCodeAt(0) >= 0x300 && c.charCodeAt(0) <= 0x36f;
const dir = (path) =>
  readdirSync(new URL(`../${path}/`, import.meta.url))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `${path}/${name}`);

test('no mojibake, no BOM and no control byte in the manifest, the docs and the code', () => {
  const files = [
    'gladys-assistant-integration.json',
    ...USER_DOCS,
    'TODO.md',
    'CLAUDE.md',
    'THIRD_PARTY_NOTICES.md',
    'Dockerfile',
    'package.json',
    'index.js',
    '.github/scripts/cover.mjs',
    ...dir('src'),
    ...dir('test'),
    ...dir('test/helpers'),
  ];
  assert.ok(files.length > 20, 'every source file is checked');
  for (const file of files) {
    const buffer = readBuffer(file);
    assert.ok(
      !(buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf),
      `${file} starts with a BOM`,
    );
    for (const byte of buffer) {
      assert.ok(byte >= 0x20 || byte === 0x0a || byte === 0x0d, `${file} holds a control byte`);
    }
    const text = buffer.toString('utf8');
    assert.ok(!text.includes(REPLACEMENT), `${file} holds an invalid UTF-8 sequence`);
    for (const bad of MOJIBAKE) {
      assert.ok(!text.includes(bad), `${file} holds mojibake (${bad})`);
    }
    assert.ok(![...text].some(isCombining), `${file} holds a bare combining mark`);
  }
  assert.match(read('docs/fr.md'), /é/);
  assert.match(manifest.config_schema[0].description.fr, /densité et la température/);
});

test('a secret is never said "encrypted" ("chiffré") to the user', () => {
  for (const [path, text] of texts(manifest)) {
    assert.doesNotMatch(`${text.en} ${text.fr}`, /encrypt|chiffr/i, path);
  }
  for (const file of USER_DOCS) {
    assert.doesNotMatch(read(file), /encrypt|chiffr/i, file);
  }
});

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.transports, ['local']);
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /michaelheyman\/tilt-pi/, `docs/${lang}.md credits tilt-pi`);
  }
  assert.match(read('docs/en.md'), /never been tested with a real Tilt Pi/i);
  assert.match(read('docs/fr.md'), /jamais été testée avec un vrai Tilt Pi/i);
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
  assert.match(manifest.config_schema[0].description.en, /not affiliated with Tilt Hydrometer/);
});

test('no secret field, and never a default on a secret', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'secret') {
      assert.equal(field.default, undefined, field.key);
    }
  }
  assert.equal(manifest.config_schema.filter((f) => f.type === 'secret').length, 0);
});

test('one version everywhere (semver), and the image is tagged with it', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-tilt-pi:${manifest.version}`);
});

test('the license and the notices ship with the image', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/, 'no personal name');
  assert.equal(pkg.license, 'Apache-2.0');
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /michaelheyman\/tilt-pi/);
  assert.match(notices, /Copyright \(c\) 2025 Michael Heyman/);
  assert.match(notices, /Permission is hereby granted, free of charge/, 'the MIT notice in full');
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY .*LICENSE/);
  assert.match(dockerfile, /COPY .*THIRD_PARTY_NOTICES\.md/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('sections are purely presentational, with https links', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang} is too long`);
    }
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.equal(fields[key]?.default, value, key);
  }
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
  assert.equal(fields.address.type, 'string');
  assert.equal(fields.poll_interval.min, 1);
  assert.equal(fields.poll_interval.max, 60);
  assert.deepEqual(
    fields.temperature_unit.options.map((o) => o.value),
    ['fahrenheit', 'celsius'],
  );
  assert.equal(normalizeConfig({ temperature_unit: 'celsius' }).celsius, true);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollMinutes, 5);
  assert.equal(normalizeConfig({ poll_interval: 600 }).pollMinutes, 60);
});

test('the keys of the manifest are the keys of the code; read only', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  assert.ok(manifest.actions[0].timeout_seconds <= 120);
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
  assert.ok(!index.includes('onSetValue'), 'no command: read only');
  // Only the one read route of the Tilt Pi, by GET.
  const sources = dir('src').map(read).join('\n');
  assert.deepEqual([...new Set(sources.match(/'\/[a-z/]+'/g))], ["'/macid/all'"]);
  assert.doesNotMatch(sources, /method: '(POST|PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(sources, /bluetooth|@abandonware|\bnoble\b|\bhci\b/i, 'no Bluetooth');
});

// DEVICE_FEATURE_UNITS_BY_CATEGORY of server/utils/constants.js (Gladys core),
// for the categories this integration uses. The core has no category nor
// unit for a density: the gravity is `unknown`, without unit.
const CORE_UNITS = {
  'temperature-sensor': ['celsius', 'fahrenheit', 'kelvin'],
  unknown: [undefined],
};

test('every feature uses a unit the core lists for its category', async () => {
  const gladys = createFakeGladys({ selector: 'tilt-pi' });
  const devices = COLORS.map((color) => deviceOf(gladys, color));
  for (const device of devices) {
    assert.equal(device.features.length, TABLE.length);
    assert.match(device.external_id, /^ext:tilt-pi:tilt:[a-z]+$/);
    for (const feature of device.features) {
      assert.ok(feature.category in CORE_UNITS, `${feature.category} is not checked`);
      assert.ok(
        CORE_UNITS[feature.category].includes(feature.unit),
        `${feature.external_id}: ${feature.unit}`,
      );
      assert.equal(feature.read_only, true);
    }
  }
  assert.deepEqual(
    devices[0].features.map((f) => f.external_id.split(':').pop()),
    ['gravity', 'temperature'],
    'the feature keys are forever',
  );
  // The fake Gladys refuses what the host API refuses.
  await gladys.connect();
  await gladys.publishDiscoveredDevices(devices);
});
