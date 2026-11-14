/* ============================================================
   GROUP B RALLY LEGENDS — game data
   ============================================================ */

export const STORAGE_KEY = 'gbr.settings.v1';
export const BEST_PREFIX = 'gbr.best.';

export const DEFAULT_SETTINGS = {
  quality: 'high',
  volume: 0.75,
  muted: false,
  voice: true,
  lookSensitivity: 1.0,
  shake: true,
  units: 'kph',
  weatherFx: true,
  showHints: true,
};

/* ---------- Cars ---------- */
/* power = bhp, weight = kg, grip = lateral grip coefficient (1.0 = decent) */
export const CARS = [
  {
    id: 'quattro',
    number: 1,
    name: 'AUDI QUATTRO S1 E2',
    short: 'QUATTRO S1',
    year: 1985,
    country: 'DEUTSCHLAND',
    layout: 'AWD',
    engine: '2.1L · 5-CYL TURBO',
    power: 476,
    weight: 1090,
    grip: 1.13,
    topSpeed: 232,
    brake: 1.04,
    tyre: 'PIRELLI GRAVEL',
    color: 0xece9dd,
    accent: 0xf4c31d,
    accent2: 0xc92f25,
    livery: 'quattro',
    style: {
      length: 4.42, width: 1.86, roof: 1.47, cabinRear: -1.22, cabinFront: 0.72,
      roofRear: -1.02, roofFront: 0.3, nose: 'boxy', wing: 'big', lights: 4,
      arch: 0.16, hoodVents: true, scoop: true,
    },
    blurb: 'The four-wheel-drive monster that broke the rally world. Heavy, planted, brutal.',
    audio: { cylinders: 5, f1: 0.55, rasp: 0.75, turbo: 1.0 },
  },
  {
    id: 'delta',
    number: 5,
    name: 'LANCIA DELTA S4',
    short: 'DELTA S4',
    year: 1985,
    country: 'ITALIA',
    layout: 'AWD',
    engine: '1.8L · 4-CYL TWINCHARGED',
    power: 480,
    weight: 890,
    grip: 1.09,
    topSpeed: 236,
    brake: 1.02,
    tyre: 'MARTINI GRAVEL',
    color: 0xeeeae0,
    accent: 0xd72b2f,
    accent2: 0x244e9b,
    livery: 'martini',
    style: {
      length: 4.0, width: 1.8, roof: 1.44, cabinRear: -1.14, cabinFront: 0.7,
      roofRear: -0.94, roofFront: 0.25, nose: 'round', wing: 'big', lights: 4,
      arch: 0.15, hoodVents: true, scoop: true,
    },
    blurb: 'Light, savagely fast and supercharged. A silhouette racer let loose in the forests.',
    audio: { cylinders: 4, f1: 0.6, rasp: 0.9, turbo: 1.1 },
  },
  {
    id: '205',
    number: 3,
    name: 'PEUGEOT 205 T16 EVO 2',
    short: '205 T16',
    year: 1985,
    country: 'FRANCE',
    layout: 'AWD',
    engine: '1.8L · 4-CYL TURBO',
    power: 499,
    weight: 910,
    grip: 1.16,
    topSpeed: 240,
    brake: 1.0,
    tyre: 'MICHELIN GRAVEL',
    color: 0x1e4a9c,
    accent: 0xf5c400,
    accent2: 0xe8e5d8,
    livery: 'peugeot',
    style: {
      length: 3.82, width: 1.78, roof: 1.4, cabinRear: -1.08, cabinFront: 0.66,
      roofRear: -0.9, roofFront: 0.2, nose: 'round', wing: 'big', lights: 4,
      arch: 0.17, hoodVents: true, scoop: true,
    },
    blurb: 'The most successful machine of the era. Compact, compliant and devastatingly quick.',
    audio: { cylinders: 4, f1: 0.62, rasp: 0.8, turbo: 1.15 },
  },
  {
    id: 'rs200',
    number: 8,
    name: 'FORD RS200',
    short: 'RS200',
    year: 1986,
    country: 'GREAT BRITAIN',
    layout: 'AWD',
    engine: '1.8L · 4-CYL TURBO',
    power: 450,
    weight: 1050,
    grip: 1.07,
    topSpeed: 228,
    brake: 1.0,
    tyre: 'GOODYEAR GRAVEL',
    color: 0xf0efe8,
    accent: 0x2257a8,
    accent2: 0xd2352d,
    livery: 'rs200',
    style: {
      length: 4.0, width: 1.86, roof: 1.38, cabinRear: -0.92, cabinFront: 0.86,
      roofRear: -0.64, roofFront: 0.5, nose: 'wedge', wing: 'big', lights: 4,
      arch: 0.16, hoodVents: true, scoop: true,
    },
    blurb: 'Mid-engined, beautifully balanced, and blessed with one of the great Group B shapes.',
    audio: { cylinders: 4, f1: 0.58, rasp: 0.85, turbo: 1.0 },
  },
  {
    id: '037',
    number: 4,
    name: 'LANCIA 037 RALLY',
    short: 'LANCIA 037',
    year: 1983,
    country: 'ITALIA',
    layout: 'RWD',
    engine: '2.0L · 4-CYL SUPERCHARGED',
    power: 325,
    weight: 960,
    grip: 0.98,
    topSpeed: 216,
    brake: 0.94,
    tyre: 'PIRELLI GRAVEL',
    color: 0xf2f0e6,
    accent: 0xd8272a,
    accent2: 0x274d94,
    livery: 'martini',
    style: {
      length: 4.1, width: 1.78, roof: 1.28, cabinRear: -0.98, cabinFront: 0.58,
      roofRear: -0.78, roofFront: 0.18, nose: 'wedge', wing: 'ducktail', lights: 4,
      arch: 0.14, hoodVents: false, scoop: false,
    },
    blurb: 'The last rear-drive champion. No turbo, no safety net — just balance and bravery.',
    audio: { cylinders: 4, f1: 0.72, rasp: 0.55, turbo: 0.25 },
  },
  {
    id: 'r5',
    number: 7,
    name: 'RENAULT 5 TURBO 2',
    short: 'R5 TURBO',
    year: 1984,
    country: 'FRANCE',
    layout: 'RWD',
    engine: '1.4L · 4-CYL TURBO',
    power: 350,
    weight: 970,
    grip: 1.01,
    topSpeed: 220,
    brake: 0.95,
    tyre: 'MICHELIN GRAVEL',
    color: 0xf0c400,
    accent: 0x171717,
    accent2: 0xd42b23,
    livery: 'r5',
    style: {
      length: 3.72, width: 1.78, roof: 1.36, cabinRear: -0.98, cabinFront: 0.62,
      roofRear: -0.82, roofFront: 0.16, nose: 'boxy', wing: 'ducktail', lights: 2,
      arch: 0.15, hoodVents: false, scoop: true,
    },
    blurb: 'A mid-engined pocket rocket with a short wheelbase and a taste for the hedgerows.',
    audio: { cylinders: 4, f1: 0.68, rasp: 0.8, turbo: 0.95 },
  },
];

/* ---------- Environments ---------- */
const ENV = {
  forest: {
    skyTop: 0x62839a,
    skyHorizon: 0xb8c4bc,
    skyBottom: 0x8f9e90,
    fog: 0x9aa99a,
    fogDensity: 0.0105,
    sunColor: 0xfff1cf,
    sunIntensity: 2.1,
    sunDir: [-0.38, 0.78, 0.3],
    hemiSky: 0xa9bcc8,
    hemiGround: 0x38412a,
    hemiIntensity: 1.0,
    exposure: 1.02,
    ground: 0x3f4a2c,
    groundDark: 0x28301c,
    dirt: 0x5b4c36,
    hill: 0x4c5c48,
    tree: 0x2d4026,
    treeAlt: 0x7b8a60,
    trunk: 0x4a3b2b,
    weather: 'none',
    rainWet: 0.0,
    road: 'gravel',
    surfaceName: 'LOOSE GRAVEL',
    surfaceGrip: 0.82,
    hint: 'Deep ruts. Loose marbles on the racing line.',
  },
  jungle: {
    skyTop: 0x46685b,
    skyHorizon: 0x93a37e,
    skyBottom: 0x5e6c4d,
    fog: 0x7e8d70,
    fogDensity: 0.0145,
    sunColor: 0xffefc4,
    sunIntensity: 1.7,
    sunDir: [0.18, 0.7, -0.35],
    hemiSky: 0x9eb28d,
    hemiGround: 0x202b18,
    hemiIntensity: 0.9,
    exposure: 1.0,
    ground: 0x2d3a20,
    groundDark: 0x1c2514,
    dirt: 0x4b3d26,
    hill: 0x394a33,
    tree: 0x294222,
    treeAlt: 0x63814a,
    trunk: 0x4c3e2a,
    weather: 'rain',
    rainWet: 0.35,
    road: 'mud',
    surfaceName: 'WET MUD',
    surfaceGrip: 0.68,
    hint: 'Standing water. The jungle bites back.',
  },
  snow: {
    skyTop: 0x7090b4,
    skyHorizon: 0xd3dfe8,
    skyBottom: 0xaebfce,
    fog: 0xc1cfdb,
    fogDensity: 0.0095,
    sunColor: 0xfff6e4,
    sunIntensity: 2.35,
    sunDir: [-0.25, 0.62, 0.42],
    hemiSky: 0xd6e4f2,
    hemiGround: 0x6f7c8a,
    hemiIntensity: 1.25,
    exposure: 1.05,
    ground: 0xdde6ee,
    groundDark: 0xb2c0cd,
    dirt: 0x9aa6b2,
    hill: 0xa7b8c8,
    tree: 0x24382b,
    treeAlt: 0x8ba28f,
    trunk: 0x4b3e30,
    weather: 'snow',
    rainWet: 0.0,
    road: 'snow',
    surfaceName: 'PACKED SNOW',
    surfaceGrip: 0.59,
    hint: 'Ice under the snow. Brake early, steer gently.',
  },
};

/* ---------- Stages ---------- */
export const STAGES = [
  {
    id: 'kielder',
    ss: 'SS01',
    name: 'KIELDER',
    subtitle: 'NORTHUMBERLAND · ENGLAND',
    biome: 'forest',
    width: 7.0,
    baseGrip: ENV.forest.surfaceGrip,
    difficulty: 2,
    difficultyLabel: 'FAST · TECHNICAL',
    targetSpeed: 22.0,
    seed: 1187,
    env: ENV.forest,
    blurb: 'Blind crests under a pine canopy. A classic British forest opener.',
    route: [
      [0, 0, 0], [30, -82, 2], [2, -162, 4.5], [-68, -212, 3], [-144, -188, 6],
      [-178, -110, 4], [-140, -40, 1], [-72, -8, 0], [-30, 52, 2.5], [-70, 122, 5],
      [-40, 202, 3], [42, 232, 6], [112, 192, 4], [142, 112, 1.5], [202, 62, 3],
      [282, 82, 6], [332, 162, 8], [312, 252, 5], [242, 302, 4], [252, 382, 7],
      [332, 422, 9], [414, 382, 6],
    ],
  },
  {
    id: 'kurukuru',
    ss: 'SS02',
    name: 'KURU-KURU',
    subtitle: 'CENTRAL AMERICA · JUNGLE',
    biome: 'jungle',
    width: 6.4,
    baseGrip: ENV.jungle.surfaceGrip,
    difficulty: 3,
    difficultyLabel: 'TIGHT · TREACHEROUS',
    targetSpeed: 17.35,
    seed: 2084,
    env: ENV.jungle,
    blurb: 'A green tunnel of mud, roots and standing water. Concentration is everything.',
    route: [
      [0, 0, 0], [0, -68, 1], [56, -102, 3], [112, -70, 5], [120, 0, 4],
      [84, 54, 2], [24, 42, 0], [-6, 90, 1], [20, 152, 3], [92, 172, 2],
      [142, 132, 0], [196, 150, 1], [212, 222, 4], [170, 282, 6], [104, 292, 5],
      [80, 352, 3], [126, 412, 5], [202, 424, 8], [258, 382, 7], [312, 414, 5],
      [330, 484, 3], [286, 544, 4], [216, 542, 6], [180, 598, 8], [228, 654, 6],
      [302, 662, 4], [356, 620, 5],
    ],
  },
  {
    id: 'rovaniemi',
    ss: 'SS03',
    name: 'ROVANIEMI',
    subtitle: 'LAPLAND · FINLAND',
    biome: 'snow',
    width: 8.0,
    baseGrip: ENV.snow.surfaceGrip,
    difficulty: 3,
    difficultyLabel: 'FLAT OUT · ICE',
    targetSpeed: 20.3,
    seed: 3316,
    env: ENV.snow,
    blurb: 'Sweeping snow banks and glare ice. Commit early, and let the quattro pull you out.',
    route: [
      [0, 0, 0], [28, -132, 3], [108, -192, 7], [200, -162, 10], [250, -82, 8],
      [330, -70, 5], [382, -152, 2], [452, -132, 4], [470, -30, 8], [428, 62, 11],
      [470, 152, 9], [562, 182, 6], [622, 112, 3], [682, 52, 5], [742, 132, 9],
      [722, 242, 12], [650, 302, 10], [682, 392, 7], [772, 432, 5], [846, 382, 8],
    ],
  },
];

export const BIOME_LABEL = {
  forest: 'FOREST',
  jungle: 'JUNGLE',
  snow: 'SNOW',
};

export function getCar(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}
export function getStage(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}

export function carDerived(car) {
  const powerPct = Math.min(100, (car.power / 520) * 100);
  const weightPct = Math.min(100, Math.max(0, (1250 - car.weight) / 400 * 100));
  const gripPct = Math.min(100, (car.grip / 1.2) * 100);
  const agility = Math.min(100, ((car.power / car.weight) / 0.53) * 100);
  return { powerPct, weightPct, gripPct, agility };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* storage unavailable */ }
}

export function getBest(stageId, carId) {
  try {
    const v = localStorage.getItem(BEST_PREFIX + stageId + '.' + carId);
    return v ? parseFloat(v) : null;
  } catch {
    return null;
  }
}

export function setBest(stageId, carId, time) {
  try {
    localStorage.setItem(BEST_PREFIX + stageId + '.' + carId, String(time.toFixed(2)));
  } catch { /* ignore */ }
}

export function clearBests() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(BEST_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
