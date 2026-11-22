// Model coordinates: +Z north and -X east. World coordinates use the reverse axes.
export const PALACE_SITE = {
  x: 175, y: 145, z: -692, scale: .56, verticalScale: .64,
  moat: { x0: -470.65, x1: 469.85, z0: -484.85, z1: 662.65, width: 52 },
  crossings: [
    { axis: 'z', side: 'south', at: 0, half: 27 },
    { axis: 'z', side: 'north', at: 0, half: 13 },
    { axis: 'x', side: 'east', at: -257, half: 13 },
    { axis: 'x', side: 'west', at: -260.6, half: 13 },
  ],
};
export const PALACE_WALKS = [
  { axis: 'x', start: -175, end: 175, at: PALACE_SITE.moat.z0 - 28, half: 4.4 },
  { axis: 'z', start: -375, end: -157, at: PALACE_SITE.moat.x0 - 25, half: 4.1 },
  { axis: 'z', start: -375, end: -157, at: PALACE_SITE.moat.x1 + 25, half: 4.1 },
];
export const MOAT_LEVEL = -1.45;
const { x: centerX, y: floorY, z: centerZ, scale, verticalScale, moat, crossings } = PALACE_SITE;
const smooth = t => { const a = Math.max(0, Math.min(1, t)); return a * a * (3 - 2 * a); };
const mix = (a, b, t) => a + (b - a) * t;

export function moatCutLocal(x, z) {
  const edge = Math.min(x - moat.x0, moat.x1 - x, z - moat.z0, moat.z1 - z);
  if (edge <= 0 || edge >= moat.width) return 0;
  const crossing = crossings.find(({ axis, side }) => axis === 'x'
    ? side === 'east' ? x < moat.x0 + moat.width : x > moat.x1 - moat.width
    : side === 'south' ? z < moat.z0 + moat.width : z > moat.z1 - moat.width);
  const transverse = crossing?.axis === 'x' ? z : x;
  const bank = crossing ? smooth((Math.abs(transverse - crossing.at) - crossing.half) / 6) : 1;
  return -4.4 * bank * smooth(Math.min(edge, moat.width - edge) / 7);
}

export function palacePavingAt(x, z) {
  x = (centerX - x) / scale;
  z = (centerZ - z) / scale;
  const garden = Math.abs(x) > 10 && Math.abs(x) < 61 && z > 439 && z < 526;
  const court = x >= -390 && x <= 390 && z >= -434 && z <= 560;
  const walk = PALACE_WALKS.some(({ axis, start, end, at, half }) => {
    const [along, across] = axis === 'x' ? [x, z] : [z, x];
    return along >= start && along <= end && Math.abs(across - at) <= half;
  });
  return walk || (court && !garden) || moatCutLocal(x, z) < 0 ||
    (Math.abs(x) < 29 && z > -491 && z < -427);
}

export function palaceGradeAt(x, z, y) {
  const localX = (centerX - x) / scale, localZ = (centerZ - z) / scale;
  const apronWidth = 32 + Math.max(0, moat.z0 - localZ) * .15;
  const lowZ = mix(moat.z0, -510, smooth((apronWidth + 22 - Math.abs(localX)) / 22));
  const horizontal = Math.max(moat.x0 - localX, localX - moat.x1, 0) * scale;
  const north = Math.max(localZ - moat.z1, 0) * scale;
  const south = Math.max(lowZ - localZ, 0) * scale;
  const northLimit = mix(13, 54, smooth((44 - Math.abs(localX)) / 25));
  if (horizontal >= 65 || north >= northLimit || south >= 65) return y;
  const blend = 1 - smooth(Math.hypot(horizontal / 65, north / northLimit, south / 65));
  // Preserve the existing eastern river and the western exploration pocket at the edge of the grade.
  const riverClearance = z < -356 ? 1 : smooth((-321 - z) / 35);
  const trailDistance = Math.hypot(x + 175.7, z + 459.7);
  const westWalk = PALACE_WALKS[2];
  const marketShoulder = smooth((34 - Math.abs(localX - westWalk.at)) / 27) *
    smooth((localZ - westWalk.start + 20) / 20) * smooth((westWalk.end + 20 - localZ) / 20);
  const trailClearance = Math.max(smooth((trailDistance - 47) / 42),
    marketShoulder * smooth((trailDistance - 51) / 17));
  return mix(y, floorY + moatCutLocal(localX, localZ) * verticalScale,
    blend * riverClearance * trailClearance);
}

export function applyPalaceGrade(meta, height) {
  const { n, cell, world } = meta, half = world / 2;
  const x0 = Math.max(0, Math.floor((centerX - 337 + half) / cell));
  const x1 = Math.min(n, Math.ceil((centerX + 337 + half) / cell));
  const z0 = Math.max(0, Math.floor((centerZ - 435 + half) / cell));
  const z1 = Math.min(n, Math.ceil((centerZ + 355 + half) / cell));
  for (let row = z0; row < z1; row++) {
    const z = (row + .5) * cell - half;
    for (let col = x0; col < x1; col++) {
      const i = row * n + col, x = (col + .5) * cell - half;
      height[i] = palaceGradeAt(x, z, height[i]);
    }
  }
}
