import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, STORAGE_KEY, BEST_PREFIX, ENDLESS_PREFIX,
  loadSettings, saveSettings, sanitizeSettings, getBest, setBest,
  getEndlessBest, setEndlessBest, clearBests,
} from '../js/config.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

globalThis.localStorage = new MemoryStorage();

test('settings fall back to defaults when storage is empty', () => {
  localStorage.clear();
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('settings survive malformed JSON', () => {
  localStorage.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  localStorage.setItem(STORAGE_KEY, 'null');
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  localStorage.setItem(STORAGE_KEY, '[]');
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('settings are type- and range-validated', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    quality: 'ultra', volume: 99, muted: 'yes', voice: 1, lookSensitivity: -3,
    units: 'furlongs', weatherFx: 'true', showHints: null, weather: 'lava',
    timeOfDay: 42, camera: '<script>', headlights: 'on', shaders: 'disco',
  }));
  const s = loadSettings();
  assert.equal(s.quality, DEFAULT_SETTINGS.quality);
  assert.equal(s.volume, 1);
  assert.equal(s.muted, DEFAULT_SETTINGS.muted);
  assert.equal(s.voice, DEFAULT_SETTINGS.voice);
  assert.equal(s.lookSensitivity, 0.2);
  assert.equal(s.units, DEFAULT_SETTINGS.units);
  assert.equal(s.weatherFx, DEFAULT_SETTINGS.weatherFx);
  assert.equal(s.showHints, DEFAULT_SETTINGS.showHints);
  assert.equal(s.weather, DEFAULT_SETTINGS.weather);
  assert.equal(s.timeOfDay, DEFAULT_SETTINGS.timeOfDay);
  assert.equal(s.camera, DEFAULT_SETTINGS.camera);
  assert.equal(s.headlights, DEFAULT_SETTINGS.headlights);
  assert.equal(s.shaders, DEFAULT_SETTINGS.shaders);
});

test('valid settings are preserved and saveSettings sanitizes', () => {
  localStorage.clear();
  const saved = saveSettings({
    ...DEFAULT_SETTINGS, quality: 'low', camera: 'chase', weather: 'snow',
    timeOfDay: 'night', shaders: 'vivid', units: 'mph', volume: 2,
  });
  assert.equal(saved.volume, 1);
  assert.deepEqual(loadSettings(), saved);
  assert.equal(JSON.parse(localStorage.getItem(STORAGE_KEY)).quality, 'low');
});

test('sanitizeSettings never trusts arrays or primitives', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('high'), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings([]), DEFAULT_SETTINGS);
});

test('stage and endless records round-trip with validation', () => {
  localStorage.clear();
  assert.equal(setBest('kielder', 'quattro', 123.456), true);
  assert.equal(getBest('kielder', 'quattro'), 123.46);
  assert.equal(setBest('kielder', 'quattro', -1), false);
  assert.equal(setBest('kielder', 'quattro', Infinity), false);

  assert.equal(setEndlessBest('kielder', 'quattro', 9876.54), true);
  assert.equal(getEndlessBest('kielder', 'quattro'), 9876.5);
  assert.equal(setEndlessBest('kielder', 'quattro', 0), false);
});

test('corrupt or unreasonable records are ignored', () => {
  localStorage.clear();
  for (const raw of ['NaN', 'Infinity', '-4', '0', '999999999', '12abc']) {
    localStorage.setItem(BEST_PREFIX + 'kielder.quattro', raw);
    assert.equal(getBest('kielder', 'quattro'), null, `stage record ${raw}`);
    localStorage.setItem(ENDLESS_PREFIX + 'kielder.quattro', raw);
    assert.equal(getEndlessBest('kielder', 'quattro'), null, `endless record ${raw}`);
  }
});

test('clearBests removes only game records', () => {
  localStorage.setItem(BEST_PREFIX + 'a.b', '10');
  localStorage.setItem(ENDLESS_PREFIX + 'a.b', '20');
  localStorage.setItem('unrelated.key', 'keep');
  clearBests();
  assert.equal(localStorage.getItem(BEST_PREFIX + 'a.b'), null);
  assert.equal(localStorage.getItem(ENDLESS_PREFIX + 'a.b'), null);
  assert.equal(localStorage.getItem('unrelated.key'), 'keep');
});
