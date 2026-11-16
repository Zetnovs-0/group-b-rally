/* ============================================================
   GROUP B RALLY LEGENDS — game data
   ============================================================ */

export const STORAGE_KEY = 'gbr.settings.v1';
export const BEST_PREFIX = 'gbr.best.';
export const ENDLESS_PREFIX = 'gbr.endless.';

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
  weather: 'auto',
  timeOfDay: 'auto',
  camera: 'cockpit',
  headlights: true,
  shaders: 'off',
};

/* ---------- Cars ---------- */
/* power = bhp, weight = kg, grip = lateral grip coefficient (1.0 = decent),
   frontWeight = static front-axle load share (0.5 = 50/50) */
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
    frontWeight: 0.58,
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
    frontWeight: 0.47,
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
    frontWeight: 0.45,
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
    frontWeight: 0.44,
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
    frontWeight: 0.54,
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
    frontWeight: 0.42,
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
  {
    id: 'yaris',
    number: 17,
    name: 'TOYOTA GR YARIS RALLY1',
    short: 'GR YARIS',
    year: 2024,
    country: 'JAPAN',
    series: 'RALLY1 HYBRID',
    layout: 'AWD',
    engine: '1.6L · 3-CYL TURBO HYBRID',
    power: 380,
    weight: 1230,
    frontWeight: 0.56,
    grip: 1.23,
    topSpeed: 205,
    brake: 1.13,
    tyre: 'PIRELLI P ZERO',
    color: 0xd8342d,
    accent: 0x141414,
    accent2: 0xe9e6d8,
    livery: 'modern',
    style: {
      length: 4.02, width: 1.82, roof: 1.45, cabinRear: -1.1, cabinFront: 0.72,
      roofRear: -0.86, roofFront: 0.34, nose: 'wedge', wing: 'big', lights: 4,
      arch: 0.17, hoodVents: true, scoop: true,
    },
    blurb: 'Modern Rally1 hardware. Huge grip, huge brakes and a hybrid punch out of slow corners.',
    audio: { cylinders: 3, f1: 0.64, rasp: 0.88, turbo: 1.2 },
  },
  {
    id: 'fabia',
    number: 22,
    name: 'SKODA FABIA RS RALLY2',
    short: 'FABIA R5',
    year: 2021,
    country: 'CZECHIA',
    series: 'RALLY2',
    layout: 'AWD',
    engine: '1.6L · 4-CYL TURBO',
    power: 289,
    weight: 1230,
    frontWeight: 0.55,
    grip: 1.2,
    topSpeed: 201,
    brake: 1.1,
    tyre: 'MICHELIN RALLY',
    color: 0x1f8a4c,
    accent: 0xe7e5d9,
    accent2: 0x111311,
    livery: 'modern',
    style: {
      length: 3.99, width: 1.82, roof: 1.42, cabinRear: -1.16, cabinFront: 0.78,
      roofRear: -0.9, roofFront: 0.4, nose: 'round', wing: 'big', lights: 4,
      arch: 0.16, hoodVents: true, scoop: true,
    },
    blurb: 'The customer rally benchmark. Friendly, fast and endlessly repeatable on asphalt.',
    audio: { cylinders: 4, f1: 0.6, rasp: 0.7, turbo: 1.05 },
  },
  {
    id: 'm3e30',
    number: 31,
    name: 'BMW M3 E30',
    short: 'M3 E30',
    year: 1987,
    country: 'DEUTSCHLAND',
    series: 'TOURING',
    layout: 'RWD',
    engine: '2.3L · 4-CYL NA',
    power: 235,
    weight: 1200,
    frontWeight: 0.52,
    grip: 1.06,
    topSpeed: 235,
    brake: 1.02,
    tyre: 'ROAD SLICK',
    color: 0xe9e7dc,
    accent: 0x2b5fa8,
    accent2: 0xc9302a,
    livery: 'classic',
    style: {
      length: 4.33, width: 1.68, roof: 1.37, cabinRear: -0.98, cabinFront: 0.64,
      roofRear: -0.76, roofFront: 0.22, nose: 'boxy', wing: 'ducktail', lights: 2,
      arch: 0.14, hoodVents: false, scoop: false,
    },
    blurb: 'A homologation touring car for the road. Linear power, rear drive and perfect balance.',
    audio: { cylinders: 4, f1: 0.78, rasp: 0.45, turbo: 0.1 },
  },
  {
    id: '911rs',
    number: 27,
    name: 'PORSCHE 911 CARRERA RS 2.7',
    short: '911 RS',
    year: 1973,
    country: 'DEUTSCHLAND',
    series: 'SPORTSCAR',
    layout: 'RWD',
    engine: '2.7L · 6-CYL FLAT',
    power: 210,
    weight: 975,
    frontWeight: 0.4,
    grip: 1.1,
    topSpeed: 245,
    brake: 1.03,
    tyre: 'CLASSIC SLICK',
    color: 0xf0c419,
    accent: 0x151515,
    accent2: 0xe9e5d6,
    livery: 'classic',
    style: {
      length: 4.11, width: 1.65, roof: 1.32, cabinRear: -0.86, cabinFront: 0.42,
      roofRear: -0.62, roofFront: 0.08, nose: 'round', wing: 'ducktail', lights: 2,
      arch: 0.16, hoodVents: false, scoop: false,
    },
    blurb: 'Light, rear-engined and alive. The throttle is both the steering and the threat.',
    audio: { cylinders: 6, f1: 0.82, rasp: 0.5, turbo: 0.05 },
  },
  {
    id: 'a110',
    number: 12,
    name: 'ALPINE A110 S',
    short: 'A110 S',
    year: 2021,
    country: 'FRANCE',
    series: 'SPORTSCAR',
    layout: 'RWD',
    engine: '1.8L · 4-CYL TURBO',
    power: 292,
    weight: 1114,
    frontWeight: 0.43,
    grip: 1.14,
    topSpeed: 260,
    brake: 1.1,
    tyre: 'MICHELIN PILOT',
    color: 0x2d6fbe,
    accent: 0xeeeeea,
    accent2: 0x16181a,
    livery: 'modern',
    style: {
      length: 4.18, width: 1.8, roof: 1.24, cabinRear: -0.92, cabinFront: 0.5,
      roofRear: -0.7, roofFront: 0.16, nose: 'round', wing: 'ducktail', lights: 2,
      arch: 0.14, hoodVents: true, scoop: false,
    },
    blurb: 'A modern featherweight. Wonderful steering, huge mid-corner grip and a willing turbo.',
    audio: { cylinders: 4, f1: 0.7, rasp: 0.62, turbo: 0.9 },
  },
  {
    id: 'evo',
    number: 9,
    name: 'MITSUBISHI LANCER EVO VI',
    short: 'EVO VI',
    year: 1999,
    country: 'JAPAN',
    series: 'GROUP A',
    layout: 'AWD',
    engine: '2.0L · 4-CYL TURBO',
    power: 280,
    weight: 1365,
    frontWeight: 0.59,
    grip: 1.16,
    topSpeed: 240,
    brake: 1.09,
    tyre: 'YOKOHAMA ADVAN',
    color: 0xe9e8df,
    accent: 0xc52f28,
    accent2: 0x1a1c1c,
    livery: 'classic',
    style: {
      length: 4.35, width: 1.77, roof: 1.42, cabinRear: -1.22, cabinFront: 0.7,
      roofRear: -0.98, roofFront: 0.3, nose: 'boxy', wing: 'big', lights: 2,
      arch: 0.16, hoodVents: true, scoop: true,
    },
    blurb: 'A rally legend turned road weapon. Heavy, planted and devastating across broken tarmac.',
    audio: { cylinders: 4, f1: 0.56, rasp: 0.72, turbo: 1.0 },
  },
  {
    id: 'escort',
    number: 14,
    name: 'FORD ESCORT RS1800 MK2',
    short: 'ESCORT RS',
    year: 1978,
    country: 'GREAT BRITAIN',
    series: 'GROUP 4',
    layout: 'RWD',
    engine: '1.8L · 4-CYL NA',
    power: 250,
    weight: 1000,
    frontWeight: 0.51,
    grip: 0.99,
    topSpeed: 210,
    brake: 0.96,
    tyre: 'GRAVEL',
    color: 0xe9e6d8,
    accent: 0x2355a2,
    accent2: 0xd4b23a,
    livery: 'classic',
    style: {
      length: 3.98, width: 1.64, roof: 1.35, cabinRear: -0.9, cabinFront: 0.58,
      roofRear: -0.7, roofFront: 0.2, nose: 'boxy', wing: 'ducktail', lights: 4,
      arch: 0.15, hoodVents: false, scoop: false,
    },
    blurb: 'The people\'s rally hero. Light, loud and demanding of clean, precise inputs.',
    audio: { cylinders: 4, f1: 0.86, rasp: 0.38, turbo: 0.05 },
  },
  {
    id: 'golfgti',
    number: 18,
    name: 'VW GOLF GTI 16V MK2',
    short: 'GOLF GTI',
    year: 1987,
    country: 'DEUTSCHLAND',
    series: 'HOT HATCH',
    layout: 'FWD',
    engine: '1.8L · 4-CYL 16V',
    power: 160,
    weight: 960,
    frontWeight: 0.62,
    grip: 1.0,
    topSpeed: 210,
    brake: 0.98,
    tyre: 'ROAD SPORT',
    color: 0xb7252b,
    accent: 0x141414,
    accent2: 0xe6e2d4,
    livery: 'classic',
    style: {
      length: 3.98, width: 1.68, roof: 1.4, cabinRear: -1.12, cabinFront: 0.74,
      roofRear: -0.88, roofFront: 0.32, nose: 'boxy', wing: 'ducktail', lights: 2,
      arch: 0.13, hoodVents: false, scoop: false,
    },
    blurb: 'Front drive, an eager 16-valve engine and lift-off oversteer on demand.',
    audio: { cylinders: 4, f1: 0.74, rasp: 0.55, turbo: 0.05 },
  },
];

/* ---------- Environments ---------- */
const ENV = {
  forest: {
    skyTop: 0x476b88,
    skyHorizon: 0xc6c9b1,
    skyBottom: 0x879277,
    fog: 0xa7b198,
    fogDensity: 0.0102,
    sunColor: 0xffebbd,
    sunIntensity: 2.25,
    sunDir: [-0.38, 0.78, 0.3],
    hemiSky: 0xb5c9d2,
    hemiGround: 0x2c3a1d,
    hemiIntensity: 1.04,
    exposure: 1.04,
    ground: 0x3d4d27,
    groundDark: 0x202a14,
    dirt: 0x715636,
    hill: 0x425b46,
    tree: 0x1e3a22,
    treeAlt: 0x8aa64e,
    trunk: 0x4a3a2a,
    rock: 0x73766a,
    moss: 0x728342,
    weather: 'none',
    defaultTime: 'day',
    rainWet: 0.04,
    road: 'gravel',
    surfaceName: 'LOOSE GRAVEL',
    surfaceGrip: 0.82,
    hint: 'Deep ruts, loose marbles on the racing line and a wall of pines off the verge.',
    terrain: { style: 'rolling', relief: 1.15, bank: 1.25, ditch: 0.2, edge: 6.2, cliff: 0.15, roughness: 0.9 },
    scatter: {
      mix: { pine: 0.62, birch: 0.22, oak: 0.16 },
      density: 1.05, edge: 6.0, scale: 1.0,
      fern: 0.55, grass: 0.85, bush: 0.34, flower: 0.2, reed: 0.0,
      fernColor: 0x8fae54, grassColor: 0x819b52, bushColor: 0x5a7444,
      flowerColor: 0xd9c15a, rockColor: 0x73766a, litter: 0x6b4e2c,
    },
  },
  jungle: {
    skyTop: 0x2d5c55,
    skyHorizon: 0x8ea77a,
    skyBottom: 0x455638,
    fog: 0x748d6d,
    fogDensity: 0.0158,
    sunColor: 0xffefb8,
    sunIntensity: 1.9,
    sunDir: [0.18, 0.7, -0.35],
    hemiSky: 0x9eb98d,
    hemiGround: 0x15210d,
    hemiIntensity: 0.96,
    exposure: 1.05,
    ground: 0x26371a,
    groundDark: 0x111d0b,
    dirt: 0x654a2b,
    hill: 0x2f4b2b,
    tree: 0x142e11,
    treeAlt: 0x72a63a,
    trunk: 0x473522,
    rock: 0x5e6654,
    moss: 0x70953d,
    weather: 'rain',
    defaultTime: 'day',
    rainWet: 0.38,
    road: 'mud',
    surfaceName: 'WET MUD',
    surfaceGrip: 0.68,
    hint: 'Standing water, roots and a green tunnel that closes overhead.',
    terrain: { style: 'ridge', relief: 1.8, bank: 2.0, ditch: 0.28, edge: 5.4, cliff: 0.45, roughness: 1.15 },
    scatter: {
      mix: { palm: 0.55, broad: 0.3, banana: 0.15 },
      density: 1.28, edge: 5.2, scale: 1.05,
      fern: 1.25, grass: 0.7, bush: 0.7, flower: 0.12, reed: 0.35,
      fernColor: 0x8fbe58, grassColor: 0x79a54c, bushColor: 0x4d7131,
      flowerColor: 0xd8674f, rockColor: 0x5f6756, litter: 0x4b3a21,
    },
  },
  snow: {
    skyTop: 0x5b86b7,
    skyHorizon: 0xe6eff6,
    skyBottom: 0xb8c8d5,
    fog: 0xcbdbe8,
    fogDensity: 0.0088,
    sunColor: 0xfff7e8,
    sunIntensity: 2.55,
    sunDir: [-0.25, 0.62, 0.42],
    hemiSky: 0xd9e9f7,
    hemiGround: 0x7d8b99,
    hemiIntensity: 1.35,
    exposure: 1.06,
    ground: 0xe7eff6,
    groundDark: 0xafc0cf,
    dirt: 0x8a99a8,
    hill: 0xb6c8d8,
    tree: 0x153027,
    treeAlt: 0x8aa594,
    trunk: 0x4b3f33,
    rock: 0x8e9eac,
    moss: 0x6d7c6f,
    weather: 'snow',
    defaultTime: 'night',
    aurora: true,
    rainWet: 0.0,
    road: 'snow',
    surfaceName: 'PACKED SNOW',
    surfaceGrip: 0.58,
    hint: 'Ice under the snow. Brake early, steer gently and use the banks.',
    terrain: { style: 'plain', relief: 0.38, bank: 0.9, ditch: 0.06, edge: 9.0, cliff: 0.0, roughness: 0.35 },
    scatter: {
      mix: { spruce: 0.72, birch: 0.28 },
      density: 0.48, edge: 10.5, scale: 0.95,
      fern: 0.0, grass: 0.22, bush: 0.08, flower: 0.0, reed: 0.0,
      fernColor: 0x6f8068, grassColor: 0xb5bfae, bushColor: 0x788969,
      flowerColor: 0xbfc9cd, rockColor: 0x95a5b2, litter: 0x6f7a76,
    },
  },
  japan: {
    skyTop: 0x3c6584,
    skyHorizon: 0xc3d2cf,
    skyBottom: 0x748a78,
    fog: 0x90a6a2,
    fogDensity: 0.0098,
    sunColor: 0xfff0c9,
    sunIntensity: 2.05,
    sunDir: [-0.42, 0.68, 0.34],
    hemiSky: 0xb7cdd0,
    hemiGround: 0x1b2414,
    hemiIntensity: 1.04,
    exposure: 1.04,
    ground: 0x2b3c1e,
    groundDark: 0x131e0e,
    dirt: 0x62533f,
    hill: 0x294b3b,
    tree: 0x0e2d1b,
    treeAlt: 0x3e6b3a,
    trunk: 0x3b2e23,
    rock: 0x5d625a,
    moss: 0x4f7032,
    weather: 'none',
    defaultTime: 'dawn',
    rainWet: 0.24,
    road: 'asphalt',
    surfaceName: 'DAMP ASPHALT',
    surfaceGrip: 0.91,
    hint: 'Narrow asphalt, moss on the apex, cedar walls and a long way down.',
    terrain: { style: 'mountain', relief: 3.0, bank: 2.4, ditch: 0.12, edge: 5.0, cliff: 1.0, roughness: 1.4 },
    scatter: {
      mix: { cedar: 0.7, pine: 0.12, broad: 0.18 },
      density: 1.12, edge: 5.2, scale: 1.0,
      fern: 0.75, grass: 0.35, bush: 0.5, flower: 0.08, reed: 0.0,
      fernColor: 0x719c48, grassColor: 0x76934c, bushColor: 0x45663a,
      flowerColor: 0xc6a66b, rockColor: 0x62685c, litter: 0x57462e,
    },
  },
  russia: {
    skyTop: 0x6f9cbc,
    skyHorizon: 0xe2e6d8,
    skyBottom: 0x98aa8e,
    fog: 0xb7c5b3,
    fogDensity: 0.0105,
    sunColor: 0xf4eccd,
    sunIntensity: 1.7,
    sunDir: [0.3, 0.66, 0.44],
    hemiSky: 0xbfd1d1,
    hemiGround: 0x2d381d,
    hemiIntensity: 1.06,
    exposure: 1.03,
    ground: 0x566a32,
    groundDark: 0x33451e,
    dirt: 0x8b7952,
    hill: 0x4c6546,
    tree: 0x1a3820,
    treeAlt: 0xb6c45c,
    trunk: 0xd9d6c8,
    rock: 0x797c6e,
    moss: 0x6f8343,
    weather: 'none',
    defaultTime: 'day',
    rainWet: 0.08,
    road: 'broken',
    surfaceName: 'BROKEN ASPHALT',
    surfaceGrip: 0.84,
    hint: 'Cracked asphalt, wide birch alleys and blind crests. Stay flat out.',
    terrain: { style: 'plain', relief: 0.85, bank: 0.8, ditch: 0.16, edge: 8.2, cliff: 0.05, roughness: 0.5 },
    scatter: {
      mix: { spruce: 0.18, birch: 0.7, pine: 0.12 },
      density: 0.8, edge: 8.8, scale: 0.94,
      fern: 0.2, grass: 0.8, bush: 0.45, flower: 0.25, reed: 0.12,
      fernColor: 0x7e9b52, grassColor: 0x94a75e, bushColor: 0x5b7746,
      flowerColor: 0xe0d06a, rockColor: 0x7a7d70, litter: 0x7c6540,
    },
  },
  safari: {
    skyTop: 0x6095c1,
    skyHorizon: 0xf1d59f,
    skyBottom: 0xc49a5e,
    fog: 0xd7b986,
    fogDensity: 0.0082,
    sunColor: 0xffe3ad,
    sunIntensity: 2.7,
    sunDir: [0.46, 0.7, -0.28],
    hemiSky: 0xced8d5,
    hemiGround: 0x5c3c20,
    hemiIntensity: 1.12,
    exposure: 1.06,
    ground: 0x9b7a3d,
    groundDark: 0x684d26,
    dirt: 0xb96c2f,
    hill: 0x8f6c3a,
    tree: 0x35471e,
    treeAlt: 0x9c9a55,
    trunk: 0x5b4126,
    rock: 0x9e8765,
    moss: 0x8d8545,
    weather: 'none',
    defaultTime: 'dusk',
    rainWet: 0.0,
    road: 'dirt',
    surfaceName: 'RED DIRT',
    surfaceGrip: 0.75,
    hint: 'Loose red earth, long crests and dust hanging in the sun.',
    terrain: { style: 'plain', relief: 1.0, bank: 0.75, ditch: 0.2, edge: 10.0, cliff: 0.08, roughness: 0.55 },
    scatter: {
      mix: { acacia: 0.55, baobab: 0.15, broad: 0.3 },
      density: 0.36, edge: 12.0, scale: 1.08,
      fern: 0.0, grass: 1.1, bush: 0.55, flower: 0.18, reed: 0.08,
      fernColor: 0x8e9554, grassColor: 0xb5a061, bushColor: 0x6c7139,
      flowerColor: 0xe2b64d, rockColor: 0x9d8563, litter: 0x8b5b2b,
    },
  },
  coast: {
    skyTop: 0x3d7ba8,
    skyHorizon: 0xf0d6a8,
    skyBottom: 0xb89d72,
    fog: 0xd8c49f,
    fogDensity: 0.0074,
    sunColor: 0xfff1c9,
    sunIntensity: 2.62,
    sunDir: [-0.5, 0.56, 0.38],
    hemiSky: 0xcfe4ea,
    hemiGround: 0x57482b,
    hemiIntensity: 1.12,
    exposure: 1.05,
    ground: 0x7d7b43,
    groundDark: 0x4b4a24,
    dirt: 0x9b8353,
    hill: 0x6d7d56,
    tree: 0x2c4524,
    treeAlt: 0x94a960,
    trunk: 0x5a4630,
    rock: 0x8f8873,
    moss: 0x8b8b4a,
    weather: 'none',
    defaultTime: 'day',
    rainWet: 0.04,
    road: 'asphalt',
    surfaceName: 'COAST ASPHALT',
    surfaceGrip: 0.94,
    hint: 'Warm coastal tarmac, tight walls and a long drop to the sea. Commit, but stay off the paint.',
    terrain: { style: 'mountain', relief: 2.5, bank: 1.95, ditch: 0.1, edge: 5.2, cliff: 0.7, roughness: 1.2 },
    scatter: {
      mix: { pine: 0.44, broad: 0.41, birch: 0.15 },
      density: 0.72, edge: 7.6, scale: 0.92,
      fern: 0.42, grass: 0.8, bush: 0.62, flower: 0.28, reed: 0.05,
      fernColor: 0x8ca856, grassColor: 0xa3a763, bushColor: 0x637542,
      flowerColor: 0xd9b45c, rockColor: 0x948d75, litter: 0x7b6540,
    },
  },
  alpine: {
    skyTop: 0x326394,
    skyHorizon: 0xdceaf5,
    skyBottom: 0xa9bccb,
    fog: 0xc7d7e3,
    fogDensity: 0.0082,
    sunColor: 0xfff7e6,
    sunIntensity: 2.55,
    sunDir: [-0.32, 0.68, 0.42],
    hemiSky: 0xd8e8f4,
    hemiGround: 0x50604b,
    hemiIntensity: 1.22,
    exposure: 1.04,
    ground: 0x6b7c4c,
    groundDark: 0x3f4e30,
    dirt: 0x8b7f64,
    hill: 0x718370,
    tree: 0x1a3928,
    treeAlt: 0x9ab380,
    trunk: 0x4d3d2e,
    rock: 0x8c8f89,
    moss: 0x748352,
    weather: 'none',
    defaultTime: 'dawn',
    rainWet: 0.08,
    road: 'asphalt',
    surfaceName: 'ALPINE ASPHALT',
    surfaceGrip: 0.93,
    hint: 'Cold mountain asphalt. Blind hairpins, stone walls and no margin at the summit.',
    terrain: { style: 'mountain', relief: 3.8, bank: 2.6, ditch: 0.12, edge: 5.6, cliff: 1.05, roughness: 1.45 },
    scatter: {
      mix: { spruce: 0.66, pine: 0.18, birch: 0.16 },
      density: 0.72, edge: 9.2, scale: 0.94,
      fern: 0.28, grass: 0.72, bush: 0.36, flower: 0.16, reed: 0.0,
      fernColor: 0x7f9d51, grassColor: 0x93a466, bushColor: 0x536b42,
      flowerColor: 0xd8c86c, rockColor: 0x8d9089, litter: 0x6e5c3c,
    },
  },
  eifel: {
    skyTop: 0x4d7088,
    skyHorizon: 0xc5cfc4,
    skyBottom: 0x788976,
    fog: 0xa8b8ad,
    fogDensity: 0.0102,
    sunColor: 0xffedc2,
    sunIntensity: 2.18,
    sunDir: [-0.36, 0.74, 0.28],
    hemiSky: 0xbcd2d2,
    hemiGround: 0x2f3e28,
    hemiIntensity: 1.03,
    exposure: 1.03,
    ground: 0x4d6034,
    groundDark: 0x29391f,
    dirt: 0x77694d,
    hill: 0x445c43,
    tree: 0x17341e,
    treeAlt: 0x8aa758,
    trunk: 0x4c3b2b,
    rock: 0x797d70,
    moss: 0x708844,
    weather: 'overcast',
    defaultTime: 'day',
    rainWet: 0.16,
    road: 'asphalt',
    surfaceName: 'FOREST TARMAC',
    surfaceGrip: 0.92,
    hint: 'Damp forest tarmac under a oak canopy. Fast blind crests and damp patches in the shade.',
    terrain: { style: 'rolling', relief: 1.4, bank: 1.25, ditch: 0.22, edge: 6.4, cliff: 0.2, roughness: 0.95 },
    scatter: {
      mix: { oak: 0.48, pine: 0.28, birch: 0.24 },
      density: 1.08, edge: 6.2, scale: 0.98,
      fern: 0.7, grass: 0.92, bush: 0.45, flower: 0.16, reed: 0.0,
      fernColor: 0x8aa852, grassColor: 0x849c58, bushColor: 0x587043,
      flowerColor: 0xd0bd64, rockColor: 0x7b7e70, litter: 0x6c5331,
    },
  },
  tuscany: {
    skyTop: 0x5d8fb8,
    skyHorizon: 0xf4e0b8,
    skyBottom: 0xc3ab78,
    fog: 0xe0cfaa,
    fogDensity: 0.0084,
    sunColor: 0xffeec4,
    sunIntensity: 2.55,
    sunDir: [0.42, 0.6, 0.3],
    hemiSky: 0xd9dfd7,
    hemiGround: 0x59472c,
    hemiIntensity: 1.1,
    exposure: 1.05,
    ground: 0x9a8c51,
    groundDark: 0x665b33,
    dirt: 0xb19161,
    hill: 0x887c52,
    tree: 0x33482a,
    treeAlt: 0x9ea65d,
    trunk: 0x5f4a31,
    rock: 0xa39578,
    moss: 0x8a8d4b,
    weather: 'none',
    defaultTime: 'dusk',
    rainWet: 0.03,
    road: 'asphalt',
    surfaceName: 'HILL TARMAC',
    surfaceGrip: 0.92,
    hint: 'Sun-bleached hill tarmac through cypress avenues. Long sweeps, cambered apexes and gravel dust.',
    terrain: { style: 'rolling', relief: 1.55, bank: 1.1, ditch: 0.18, edge: 7.0, cliff: 0.12, roughness: 0.8 },
    scatter: {
      mix: { cedar: 0.4, oak: 0.4, pine: 0.2 },
      density: 0.66, edge: 8.4, scale: 0.98,
      fern: 0.3, grass: 1.0, bush: 0.42, flower: 0.3, reed: 0.04,
      fernColor: 0x8a9e50, grassColor: 0xb3a35e, bushColor: 0x6c7441,
      flowerColor: 0xe0b84f, rockColor: 0xa29476, litter: 0x8b6d3c,
    },
  },
};

/* ---------- Time of day & weather ---------- */
/* The base palettes above define a stage's identity. These presets grade the
   palette and the lighting so any stage can be driven at dawn, dusk, in a
   storm, at night, etc. without authoring a second set of assets. */
export const TIME_MODES = [
  { id: 'auto', label: 'AUTO' },
  { id: 'dawn', label: 'DAWN' },
  { id: 'day', label: 'DAY' },
  { id: 'dusk', label: 'DUSK' },
  { id: 'night', label: 'NIGHT' },
];

export const WEATHER_MODES = [
  { id: 'auto', label: 'AUTO' },
  { id: 'clear', label: 'CLEAR' },
  { id: 'overcast', label: 'OVERCAST' },
  { id: 'rain', label: 'RAIN' },
  { id: 'storm', label: 'STORM' },
  { id: 'snow', label: 'SNOW' },
  { id: 'fog', label: 'FOG' },
];

export const CAMERA_MODES = [
  { id: 'cockpit', label: 'COCKPIT', fov: 75 },
  { id: 'bonnet', label: 'BONNET', fov: 78 },
  { id: 'chase', label: 'CHASE', fov: 68 },
  { id: 'bumper', label: 'BUMPER', fov: 84 },
];

const TIME_PRESETS = {
  day: {
    sunIntensity: 1, hemiIntensity: 1, exposure: 1, fogMul: 1,
    stars: 0, headlights: 0, horizonGlow: 0.18, sunScale: 1,
  },
  dawn: {
    sunDir: [-0.58, 0.19, 0.4], sunColor: 0xffb078, sunIntensity: 0.52,
    hemiIntensity: 0.72, exposure: 0.94, fogMul: 1.45,
    tint: 0xffb488, tintAmt: 0.3, skyDim: 1.02,
    fogTint: 0xe2ac86, fogTintAmt: 0.42,
    stars: 0.09, headlights: 0.55, horizonGlow: 1.1, glow: 0xffb478, sunScale: 1.25,
  },
  dusk: {
    sunDir: [0.62, 0.16, -0.5], sunColor: 0xff8a54, sunIntensity: 0.5,
    hemiIntensity: 0.62, exposure: 0.92, fogMul: 1.5,
    tint: 0xd9785a, tintAmt: 0.34, skyDim: 0.92,
    fogTint: 0xb97a68, fogTintAmt: 0.46,
    stars: 0.28, headlights: 0.75, horizonGlow: 1.2, glow: 0xff7f4d, sunScale: 1.3,
  },
  night: {
    sunDir: [-0.34, 0.5, 0.44], sunColor: 0x9fb9e6, sunIntensity: 0.17,
    hemiIntensity: 0.24, exposure: 0.9, fogMul: 1.35,
    tint: 0x12203a, tintAmt: 0.84, skyDim: 1.0,
    fogTint: 0x0c1725, fogTintAmt: 0.88,
    stars: 1, headlights: 1, horizonGlow: 0.3, glow: 0x8fb4e0, sunScale: 0.4, moon: true,
  },
};

const WEATHER_PRESETS = {
  clear: {
    label: 'CLEAR', precip: 'none', intensity: 0,
    skyDim: 1, desat: 0, fogMul: 0.82, sunMul: 1.04, hemiMul: 1,
    exposure: 1.03, gripMul: 1.03, wetness: 0, cloud: 0.06, wind: 0.15,
  },
  overcast: {
    label: 'OVERCAST', precip: 'none', intensity: 0,
    skyDim: 0.8, desat: 0.38, fogMul: 1.35, sunMul: 0.42, hemiMul: 0.92,
    exposure: 0.97, gripMul: 0.97, wetness: 0.12, cloud: 0.85, wind: 0.4,
  },
  rain: {
    label: 'RAIN', precip: 'rain', intensity: 1,
    skyDim: 0.58, desat: 0.55, fogMul: 1.85, sunMul: 0.14, hemiMul: 0.8,
    exposure: 0.92, gripMul: 0.84, wetness: 0.68, cloud: 1, wind: 0.9,
    wipers: true, headlights: 0.14,
  },
  storm: {
    label: 'STORM', precip: 'rain', intensity: 1.45,
    skyDim: 0.44, desat: 0.7, fogMul: 2.3, sunMul: 0.06, hemiMul: 0.66,
    exposure: 0.85, gripMul: 0.75, wetness: 0.92, cloud: 1, wind: 1.6,
    wipers: true, headlights: 0.3, lightning: true,
  },
  snow: {
    label: 'SNOW', precip: 'snow', intensity: 1,
    skyDim: 0.88, desat: 0.4, fogMul: 2.0, sunMul: 0.34, hemiMul: 0.95,
    exposure: 1.0, gripMul: 0.86, wetness: 0.24, cloud: 0.95, wind: 0.8,
    wipers: true, headlights: 0.12,
  },
  fog: {
    label: 'FOG', precip: 'none', intensity: 0,
    skyDim: 0.8, desat: 0.55, fogMul: 4.6, sunMul: 0.3, hemiMul: 0.85,
    exposure: 0.98, gripMul: 0.9, wetness: 0.4, cloud: 0.3, wind: 0.1,
    headlights: 0.22, fogBanks: true,
  },
};

const AUTO_WEATHER = { none: 'clear', rain: 'rain', snow: 'snow', overcast: 'overcast' };

function rgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}
function toHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}
export function mixHex(a, b, t) {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
export function shadeHex(c, k) {
  const [r, g, b] = rgb(c);
  return toHex(r * k, g * k, b * k);
}
function desatHex(c, amt) {
  if (!amt) return c;
  const [r, g, b] = rgb(c);
  const l = r * 0.299 + g * 0.587 + b * 0.114;
  return toHex(r + (l - r) * amt, g + (l - g) * amt, b + (l - b) * amt);
}

/* Returns a self-contained environment for a run, plus the resolved condition
   descriptors used by the UI and the effects layer. */
export function resolveConditions(stage, weatherId = 'auto', timeId = 'auto') {
  const base = stage.env;
  const weatherKey = weatherId === 'auto'
    ? (AUTO_WEATHER[base.weather] || 'clear')
    : (WEATHER_PRESETS[weatherId] ? weatherId : 'clear');
  const timeKey = timeId === 'auto'
    ? (TIME_PRESETS[base.defaultTime] ? base.defaultTime : 'day')
    : (TIME_PRESETS[timeId] ? timeId : 'day');
  const baseW = WEATHER_PRESETS[weatherKey];
  // 'AUTO' keeps the stage's authored look: the base palette already encodes
  // its weather, so only the extra effects (precip, wind, wipers) are added.
  const w = weatherId === 'auto'
    ? {
      ...baseW,
      skyDim: 1,
      desat: 0,
      fogMul: 1,
      sunMul: 1,
      hemiMul: 1,
      exposure: 1,
      gripMul: 1,
      wetness: base.rainWet || 0,
      headlights: 0,
      lightning: false,
    }
    : baseW;
  const t = TIME_PRESETS[timeKey];

  const grade = (c) => {
    let col = shadeHex(desatHex(c, w.desat), w.skyDim);
    if (t.tint) col = mixHex(col, t.tint, t.tintAmt);
    if (t.skyDim && t.skyDim !== 1) col = shadeHex(col, t.skyDim);
    return col;
  };
  const gradeFog = (c) => {
    let col = shadeHex(desatHex(c, w.desat), w.skyDim);
    if (t.fogTint) col = mixHex(col, t.fogTint, t.fogTintAmt);
    return col;
  };

  const env = { ...base };
  env.skyTop = grade(base.skyTop);
  env.skyHorizon = grade(base.skyHorizon);
  env.skyBottom = grade(base.skyBottom);
  env.fog = gradeFog(base.fog);
  env.fogDensity = Math.min(0.075, base.fogDensity * t.fogMul * w.fogMul);
  env.ground = grade(base.ground);
  env.groundDark = grade(base.groundDark);
  env.dirt = grade(base.dirt);
  env.hill = grade(base.hill);
  env.tree = grade(base.tree);
  env.treeAlt = grade(base.treeAlt);
  env.trunk = grade(base.trunk);
  env.hemiSky = grade(base.hemiSky);
  env.hemiGround = grade(base.hemiGround);
  env.sunColor = t.sunColor != null ? t.sunColor : base.sunColor;
  env.sunIntensity = base.sunIntensity * (t.sunIntensity ?? 1) * (w.sunMul ?? 1);
  env.hemiIntensity = base.hemiIntensity * (t.hemiIntensity ?? 1) * (w.hemiMul ?? 1);
  env.exposure = base.exposure * (t.exposure ?? 1) * (w.exposure ?? 1);
  env.sunDir = (t.sunDir || base.sunDir).slice();
  env.weather = w.precip;
  env.weatherLabel = w.label;
  env.weatherIntensity = w.intensity;
  env.lightning = !!w.lightning;
  env.stars = (t.stars ?? 0) * Math.max(0, 1 - (w.cloud || 0));
  env.clouds = Math.max(base.clouds || 0, w.cloud || 0);
  env.horizonGlow = t.horizonGlow ?? 0;
  env.glowColor = t.glow || base.skyHorizon;
  env.moon = !!t.moon && (w.cloud || 0) < 0.7;
  env.sunScale = t.sunScale ?? 1;
  env.headlights = Math.max(t.headlights || 0, w.headlights || 0);
  env.wipers = !!w.wipers;
  env.wetness = Math.max(base.rainWet || 0, w.wetness || 0);
  env.wind = w.wind ?? 0.2;
  env.fogBanks = !!w.fogBanks;
  env.timeLabel = timeKey.toUpperCase();
  if (weatherKey === 'snow') env.surfaceName = 'SNOW-COVERED';
  else if (env.wetness > 0.4) {
    if (base.road === 'tarmac' || base.road === 'asphalt') env.surfaceName = 'WET ASPHALT';
    else if (base.road === 'broken') env.surfaceName = 'WET BROKEN ASPHALT';
    else if (!/^WET /.test(base.surfaceName)) env.surfaceName = `WET ${base.surfaceName}`;
  } else env.surfaceName = base.surfaceName;

  return {
    env,
    weather: weatherKey,
    time: timeKey,
    weatherLabel: w.label,
    timeLabel: timeKey.toUpperCase(),
    gripMul: w.gripMul,
    label: `${w.label} · ${timeKey.toUpperCase()}`,
  };
}

/* ---------- Stages ---------- */
export const STAGES = [
  {
    id: 'kielder',
    ss: 'SS01',
    name: 'KIELDER',
    cardName: 'KIELDER',
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
    cardName: 'KURU-KURU',
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
    cardName: 'ROVANIEMI',
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
  {
    id: 'honshu',
    ss: 'SS04',
    name: 'HONSHU TOUGE',
    cardName: 'HONSHU',
    subtitle: 'KANTO · JAPAN',
    biome: 'japan',
    width: 5.9,
    baseGrip: ENV.japan.surfaceGrip,
    difficulty: 3,
    difficultyLabel: 'NARROW · MOUNTAIN',
    targetSpeed: 17.6,
    seed: 4421,
    env: ENV.japan,
    hazardCount: 6,
    tyre: 'WET ASPHALT',
    blurb: 'A cedar-lined mountain pass. Tight switchbacks, wet asphalt and a long way down.',
    route: [
      [0, 0, 0], [8, -56, 3], [44, -98, 8], [98, -88, 13], [124, -38, 17],
      [110, 18, 21], [64, 52, 24], [24, 82, 27], [8, 136, 30], [36, 186, 33],
      [94, 210, 36], [154, 194, 39], [182, 144, 42], [168, 88, 45], [188, 36, 48],
      [244, 16, 51], [296, 40, 53], [316, 96, 56], [288, 146, 59], [314, 202, 62],
      [374, 224, 65], [436, 202, 66],
    ],
  },
  {
    id: 'ural',
    ss: 'SS05',
    name: 'URAL TAIGA',
    cardName: 'URAL',
    subtitle: 'PERM KRAI · RUSSIA',
    biome: 'russia',
    width: 7.6,
    baseGrip: ENV.russia.surfaceGrip,
    difficulty: 2,
    difficultyLabel: 'FLAT OUT · CRESTS',
    targetSpeed: 22.8,
    seed: 5713,
    env: ENV.russia,
    hazardCount: 5,
    tyre: 'BROKEN ASPHALT',
    blurb: 'Birch alleys, cracked asphalt and blind crests. Fast, flowing and brutally simple.',
    route: [
      [0, 0, 0], [34, -92, 2], [116, -148, 4], [200, -128, 7], [252, -62, 9],
      [326, -30, 11], [398, -72, 13], [468, -136, 16], [548, -114, 18], [598, -44, 20],
      [664, 4, 22], [738, -24, 25], [782, -94, 27], [852, -124, 29], [928, -88, 32],
      [986, -24, 34], [1044, 12, 36], [1112, -18, 38], [1176, -82, 41], [1252, -106, 43],
    ],
  },
  {
    id: 'rift',
    ss: 'SS06',
    name: 'GREAT RIFT',
    cardName: 'RIFT',
    subtitle: 'RIFT VALLEY · KENYA',
    biome: 'safari',
    width: 8.4,
    baseGrip: ENV.safari.surfaceGrip,
    difficulty: 2,
    difficultyLabel: 'WIDE OPEN · DUST',
    targetSpeed: 23.6,
    seed: 6809,
    env: ENV.safari,
    hazardCount: 6,
    tyre: 'DIRT',
    blurb: 'A red-earth safari trail. Huge crests, acacia shade and dust hanging in the sun.',
    route: [
      [0, 0, 0], [58, -98, 3], [146, -150, 7], [248, -140, 12], [330, -82, 16],
      [422, -60, 20], [502, -112, 24], [594, -152, 27], [692, -124, 30], [786, -54, 33],
      [874, -32, 36], [966, -82, 39], [1054, -124, 42], [1148, -104, 45], [1234, -44, 48],
    ],
  },
  {
    id: 'riviera',
    ss: 'SS07',
    name: 'RIVIERA CORNICHE',
    cardName: 'RIVIERA',
    subtitle: 'LIGURIAN COAST · ITALY',
    biome: 'coast',
    width: 6.6,
    baseGrip: ENV.coast.surfaceGrip,
    difficulty: 3,
    difficultyLabel: 'TIGHT · EXPOSED',
    targetSpeed: 19.4,
    seed: 7351,
    env: ENV.coast,
    hazardCount: 5,
    tyre: 'COAST ASPHALT',
    blurb: 'A warm tarmac corniche carved into the cliffs. Walls on one side, sea air on the other.',
    route: [
      [0, 0, 0], [42, -74, 4], [116, -104, 8], [182, -76, 13], [216, -8, 17],
      [192, 64, 21], [126, 98, 24], [58, 86, 27], [12, 124, 30], [28, 196, 34],
      [96, 228, 37], [172, 208, 40], [222, 152, 43], [290, 132, 47], [352, 164, 50],
      [378, 236, 54], [344, 304, 58], [276, 330, 61], [214, 306, 64], [188, 356, 68],
      [234, 416, 72], [310, 430, 75], [382, 404, 78],
    ],
  },
  {
    id: 'alpine',
    ss: 'SS08',
    name: 'COL DE L\'ISERAN',
    cardName: 'ALPINE',
    subtitle: 'SAVOIE · FRANCE',
    biome: 'alpine',
    width: 6.3,
    baseGrip: ENV.alpine.surfaceGrip,
    difficulty: 3,
    difficultyLabel: 'HAIRPINS · ALTITUDE',
    targetSpeed: 18.2,
    seed: 8127,
    env: ENV.alpine,
    hazardCount: 6,
    tyre: 'ALPINE ASPHALT',
    blurb: 'A high alpine ascent. Cold asphalt, stone parapets and switchbacks stacked into the mountain.',
    route: [
      [0, 0, 0], [16, -62, 6], [58, -112, 12], [124, -132, 18], [186, -108, 24],
      [218, -48, 30], [198, 16, 36], [144, 52, 42], [96, 40, 48], [62, 82, 54],
      [78, 148, 60], [132, 188, 66], [198, 184, 72], [246, 142, 78], [300, 148, 84],
      [338, 204, 90], [322, 272, 96], [268, 312, 102], [206, 302, 108], [166, 346, 114],
      [196, 410, 120], [262, 440, 126], [332, 424, 132],
    ],
  },
  {
    id: 'eifel',
    ss: 'SS09',
    name: 'EIFEL RING',
    cardName: 'EIFEL',
    subtitle: 'NÜRBURG · GERMANY',
    biome: 'eifel',
    width: 7.0,
    baseGrip: ENV.eifel.surfaceGrip,
    difficulty: 2,
    difficultyLabel: 'FAST · FLOWING',
    targetSpeed: 21.6,
    seed: 9243,
    env: ENV.eifel,
    hazardCount: 5,
    tyre: 'FOREST TARMAC',
    blurb: 'A cathedral of damp forest tarmac. Long fourth-gear crests and blind, off-camber entries.',
    route: [
      [0, 0, 0], [36, -96, 3], [110, -148, 7], [192, -140, 11], [256, -88, 15],
      [318, -40, 18], [388, -56, 21], [444, -116, 24], [518, -138, 28], [592, -104, 31],
      [646, -42, 34], [720, -14, 38], [792, -52, 41], [850, -116, 45], [926, -140, 48],
      [1002, -108, 52], [1060, -46, 55], [1134, -20, 58], [1206, -58, 62], [1270, -120, 66],
      [1344, -146, 70],
    ],
  },
  {
    id: 'tuscany',
    ss: 'SS10',
    name: 'TOSCANA STRADA',
    cardName: 'TOSCANA',
    subtitle: 'CHIANTI · ITALY',
    biome: 'tuscany',
    width: 6.8,
    baseGrip: ENV.tuscany.surfaceGrip,
    difficulty: 2,
    difficultyLabel: 'SWEEPS · CAMBER',
    targetSpeed: 20.8,
    seed: 10319,
    env: ENV.tuscany,
    hazardCount: 5,
    tyre: 'HILL TARMAC',
    blurb: 'Sunlit hill tarmac between cypress and stone farms. Flowing, fast and beautiful at dusk.',
    route: [
      [0, 0, 0], [48, -88, 4], [128, -128, 8], [210, -108, 12], [268, -52, 16],
      [338, -36, 20], [404, -78, 24], [470, -134, 28], [550, -130, 32], [614, -76, 36],
      [686, -52, 40], [760, -88, 44], [824, -146, 48], [902, -154, 52], [972, -108, 56],
      [1042, -70, 60], [1114, -92, 64], [1178, -148, 68], [1254, -166, 72], [1328, -122, 76],
      [1396, -76, 80],
    ],
  },
];

export const BIOME_LABEL = {
  forest: 'FOREST',
  jungle: 'JUNGLE',
  snow: 'SNOW',
  japan: 'TOUGE',
  russia: 'TAIGA',
  safari: 'SAFARI',
  coast: 'COAST',
  alpine: 'ALPINE',
  eifel: 'EIFEL',
  tuscany: 'TUSCANY',
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

export function getEndlessBest(stageId, carId) {
  try {
    const v = localStorage.getItem(ENDLESS_PREFIX + stageId + '.' + carId);
    return v ? parseFloat(v) : null;
  } catch {
    return null;
  }
}

export function setEndlessBest(stageId, carId, metres) {
  try {
    localStorage.setItem(ENDLESS_PREFIX + stageId + '.' + carId, String(metres.toFixed(1)));
  } catch { /* ignore */ }
}

export function clearBests() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(BEST_PREFIX) || k.startsWith(ENDLESS_PREFIX))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
