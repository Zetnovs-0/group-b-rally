/* ============================================================
   SURFACE MODEL
   One place for how each road/off-road/hazard surface behaves.
   Track grip remains the base value (biome + hazard); these
   profiles add the feel: longitudinal capacity, rolling drag,
   braking authority, body bump, dust/loose material and audio.
   ============================================================ */

export const SURFACE_PROFILES = Object.freeze({
  asphalt: {
    key: 'asphalt', label: 'ASPHALT',
    grip: 1.04, longGrip: 1.06, rolling: 0.018, brake: 1.05,
    bump: 0.28, loose: 0.08, audioTone: 1250, audioGain: 0.95,
  },
  broken: {
    key: 'broken', label: 'BROKEN ASPHALT',
    grip: 0.96, longGrip: 0.96, rolling: 0.028, brake: 0.97,
    bump: 0.85, loose: 0.28, audioTone: 1120, audioGain: 1.08,
  },
  gravel: {
    key: 'gravel', label: 'GRAVEL',
    grip: 0.90, longGrip: 0.88, rolling: 0.038, brake: 0.90,
    bump: 1.05, loose: 0.65, audioTone: 1000, audioGain: 1.20,
  },
  dirt: {
    key: 'dirt', label: 'DIRT',
    grip: 0.82, longGrip: 0.78, rolling: 0.052, brake: 0.84,
    bump: 1.20, loose: 0.82, audioTone: 760, audioGain: 1.28,
  },
  mud: {
    key: 'mud', label: 'MUD',
    grip: 0.72, longGrip: 0.62, rolling: 0.068, brake: 0.74,
    bump: 0.95, loose: 1.00, audioTone: 380, audioGain: 1.35,
  },
  snow: {
    key: 'snow', label: 'SNOW',
    grip: 0.78, longGrip: 0.70, rolling: 0.032, brake: 0.78,
    bump: 0.55, loose: 0.80, audioTone: 520, audioGain: 1.12,
  },
  ice: {
    key: 'ice', label: 'ICE',
    grip: 0.48, longGrip: 0.32, rolling: 0.012, brake: 0.45,
    bump: 0.15, loose: 0.90, audioTone: 900, audioGain: 0.75,
  },
  loose: {
    key: 'loose', label: 'LOOSE GRAVEL',
    grip: 0.84, longGrip: 0.80, rolling: 0.050, brake: 0.84,
    bump: 1.15, loose: 0.92, audioTone: 1020, audioGain: 1.24,
  },
  water: {
    key: 'water', label: 'WATER',
    grip: 0.60, longGrip: 0.46, rolling: 0.090, brake: 0.60,
    bump: 0.40, loose: 0.90, audioTone: 600, audioGain: 1.45,
  },
  wet: {
    key: 'wet', label: 'WET',
    grip: 0.90, longGrip: 0.84, rolling: 0.024, brake: 0.86,
    bump: 0.40, loose: 0.32, audioTone: 1200, audioGain: 1.08,
  },
  moss: {
    key: 'moss', label: 'MOSS / LEAVES',
    grip: 0.78, longGrip: 0.72, rolling: 0.032, brake: 0.80,
    bump: 0.70, loose: 0.35, audioTone: 980, audioGain: 1.10,
  },
  ruts: {
    key: 'ruts', label: 'RUTS',
    grip: 0.86, longGrip: 0.82, rolling: 0.058, brake: 0.88,
    bump: 1.70, loose: 0.50, audioTone: 900, audioGain: 1.28,
  },
  roots: {
    key: 'roots', label: 'ROOTS',
    grip: 0.74, longGrip: 0.66, rolling: 0.068, brake: 0.78,
    bump: 1.80, loose: 0.55, audioTone: 850, audioGain: 1.32,
  },
  rocks: {
    key: 'rocks', label: 'ROCKS',
    grip: 0.82, longGrip: 0.76, rolling: 0.078, brake: 0.82,
    bump: 1.80, loose: 0.45, audioTone: 800, audioGain: 1.38,
  },
  sand: {
    key: 'sand', label: 'SAND',
    grip: 0.74, longGrip: 0.62, rolling: 0.080, brake: 0.76,
    bump: 1.20, loose: 1.00, audioTone: 700, audioGain: 1.35,
  },
  fesh: {
    key: 'fesh', label: 'FESH-FESH',
    grip: 0.64, longGrip: 0.52, rolling: 0.095, brake: 0.64,
    bump: 1.20, loose: 1.00, audioTone: 650, audioGain: 1.40,
  },
  pavement: {
    key: 'pavement', label: 'PAVEMENT',
    grip: 0.94, longGrip: 0.92, rolling: 0.028, brake: 0.94,
    bump: 0.70, loose: 0.12, audioTone: 1180, audioGain: 1.02,
  },
  offroad: {
    key: 'offroad', label: 'OFF STAGE',
    grip: 0.70, longGrip: 0.64, rolling: 0.082, brake: 0.78,
    bump: 1.50, loose: 0.90, audioTone: 900, audioGain: 1.30,
  },
});

const ALIASES = Object.freeze({
  tarmac: 'asphalt',
  broken_asphalt: 'broken',
  wet_tarmac: 'wet',
  side_road_asphalt: 'asphalt',
  side_road_gravel: 'gravel',
  packed_snow: 'snow',
  packed_snow_side_road: 'snow',
  black_ice: 'ice',
  deep_snow: 'snow',
  deep_mud: 'mud',
  wet_mud: 'mud',
  loose_gravel: 'loose',
  red_dirt: 'dirt',
  deep_ruts: 'ruts',
  wet_leaves: 'moss',
  roadworks: 'ruts',
  fesh_fesh: 'fesh',
  off_stage: 'offroad',
  verge: 'offroad',
  grass: 'offroad',
});

/** Resolve a short key, an authored surface name or a hazard label. */
export function normalizeSurface(value) {
  if (typeof value !== 'string' || !value.trim()) return 'gravel';
  const raw = value.trim().toLowerCase();
  const direct = raw.replace(/[^a-z0-9]+/g, '_');
  if (SURFACE_PROFILES[direct]) return direct;
  if (ALIASES[direct]) return ALIASES[direct];

  // Fall back to the most specific word in the display name. Order matters:
  // "black ice" must not be caught by a generic road match.
  if (raw.includes('ice')) return 'ice';
  if (raw.includes('snow')) return 'snow';
  if (raw.includes('fesh')) return 'fesh';
  if (raw.includes('mud')) return 'mud';
  if (raw.includes('water')) return 'water';
  if (raw.includes('sand')) return 'sand';
  if (raw.includes('rock')) return 'rocks';
  if (raw.includes('root')) return 'roots';
  if (raw.includes('rut')) return 'ruts';
  if (raw.includes('moss') || raw.includes('leaves')) return 'moss';
  if (raw.includes('wet')) return 'wet';
  if (raw.includes('dirt')) return 'dirt';
  if (raw.includes('broken')) return 'broken';
  if (raw.includes('pavement') || raw.includes('kerb') || raw.includes('sidewalk')) return 'pavement';
  if (raw.includes('verge') || raw.includes('off stage') || raw.includes('grass')) return 'offroad';
  if (raw.includes('loose')) return 'loose';
  if (raw.includes('asphalt') || raw.includes('tarmac')) return 'asphalt';
  if (raw.includes('gravel')) return 'gravel';
  return 'gravel';
}

export function surfaceProfile(value) {
  return SURFACE_PROFILES[normalizeSurface(value)] || SURFACE_PROFILES.gravel;
}
