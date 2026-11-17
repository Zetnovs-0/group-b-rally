import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SURFACE_PROFILES, normalizeSurface, surfaceProfile,
} from '../js/surfaces.js';

test('surface keys resolve directly', () => {
  for (const key of Object.keys(SURFACE_PROFILES)) {
    assert.equal(normalizeSurface(key), key);
    assert.equal(surfaceProfile(key).key, key);
  }
});

test('authored surface and hazard names resolve to profiles', () => {
  const cases = {
    ASPHALT: 'asphalt',
    TARMAC: 'asphalt',
    'DAMP ASPHALT': 'asphalt',
    'BROKEN ASPHALT': 'broken',
    'LOOSE GRAVEL': 'loose',
    'SIDE ROAD GRAVEL': 'gravel',
    'PACKED SNOW': 'snow',
    'BLACK ICE': 'ice',
    'DEEP MUD': 'mud',
    'WET MUD': 'mud',
    WATER: 'water',
    'RED DIRT': 'dirt',
    'DEEP RUTS': 'ruts',
    'WET LEAVES': 'moss',
    'FESH-FESH': 'fesh',
    ROCKS: 'rocks',
    'CITY ASPHALT': 'asphalt',
    VERGE: 'offroad',
    'OFF STAGE': 'offroad',
    pavement: 'pavement',
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(normalizeSurface(input), expected, input);
  }
});

test('unknown or empty surfaces fall back to gravel', () => {
  assert.equal(normalizeSurface(''), 'gravel');
  assert.equal(normalizeSurface(null), 'gravel');
  assert.equal(normalizeSurface('mystery surface'), 'gravel');
});

test('every profile has the physics and audio fields', () => {
  for (const [key, p] of Object.entries(SURFACE_PROFILES)) {
    assert.equal(p.key, key);
    for (const field of ['grip', 'longGrip', 'rolling', 'brake', 'bump', 'loose', 'audioTone', 'audioGain']) {
      assert.equal(typeof p[field], 'number', `${key}.${field}`);
      assert.ok(Number.isFinite(p[field]), `${key}.${field} finite`);
    }
  }
});

test('asphalt and loose surfaces have deliberately different grip', () => {
  assert.ok(surfaceProfile('asphalt').grip > surfaceProfile('gravel').grip);
  assert.ok(surfaceProfile('gravel').grip > surfaceProfile('mud').grip);
  assert.ok(surfaceProfile('mud').grip > surfaceProfile('ice').grip);
  assert.ok(surfaceProfile('asphalt').rolling < surfaceProfile('mud').rolling);
});
