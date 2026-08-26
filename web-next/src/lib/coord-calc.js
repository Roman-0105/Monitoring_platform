// Пересчёт координат WGS-84 ↔ СК-42/Пулково-1942 ↔ местные (схема карьера).
// Порт математики из hydro-monitoring/ui-wpmap.js (_calcWgsToAll/_calcSk42ToWgs/_ddToDms).
const KA = 6378245.0;
const KB = 6356863.019;
const KE2 = (KA * KA - KB * KB) / (KA * KA);
export const CALC_ZONE = 12;   // зона карьера (lon ≈ 69°, L0 = 69°)
export const CALC_OFF = 5800000; // смещение северной координаты

export function wgsToAll(lat, lon) {
  const a = KA, e2 = KE2;
  const e4 = e2 * e2, e6 = e4 * e2;
  const latR = lat * Math.PI / 180;
  const lonR = lon * Math.PI / 180;
  const zone = Math.floor(lon / 6) + 1;
  const L0 = (zone * 6 - 3) * Math.PI / 180;
  const dL = lonR - L0;
  const sinL = Math.sin(latR), cosL = Math.cos(latR), tanL = Math.tan(latR);
  const t = tanL * tanL;
  const eta2 = e2 * cosL * cosL / (1 - e2);
  const N = a / Math.sqrt(1 - e2 * sinL * sinL);
  const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * latR
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * latR)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * latR)
    - (35 * e6 / 3072) * Math.sin(6 * latR));
  const sk42x = M
    + N * sinL * cosL * dL * dL / 2
    + N * sinL * Math.pow(cosL, 3) * (5 - t + 9 * eta2 + 4 * eta2 * eta2) * Math.pow(dL, 4) / 24
    + N * sinL * Math.pow(cosL, 5) * (61 - 58 * t + t * t) * Math.pow(dL, 6) / 720;
  const sk42yLocal = N * cosL * dL
    + N * Math.pow(cosL, 3) * (1 - t + eta2) * Math.pow(dL, 3) / 6
    + N * Math.pow(cosL, 5) * (5 - 18 * t + t * t + 14 * eta2 - 58 * t * eta2) * Math.pow(dL, 5) / 120;
  const sk42yFull = sk42yLocal + zone * 1000000 + 500000;

  return {
    zone,
    sk42x,
    sk42yFull,
    sk42yLocal,
    localX: parseFloat(sk42yLocal.toFixed(4)),
    localY: parseFloat((sk42x - CALC_OFF).toFixed(4)),
  };
}

export function sk42ToWgs(sk42x, sk42yLocal, zone) {
  const a = KA, e2 = KE2;
  let lat = sk42x / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  for (let i = 0; i < 10; i++) {
    const M = a * (
      (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * lat
      - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * lat)
      + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * lat)
      - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * lat)
    );
    lat += (sk42x - M) / (a * (1 - e2 * Math.sin(lat) * Math.sin(lat)));
  }
  const sinL = Math.sin(lat), cosL = Math.cos(lat), tanL = Math.tan(lat);
  const eta2 = e2 * cosL * cosL / (1 - e2);
  const N = a / Math.sqrt(1 - e2 * sinL * sinL);
  const t = tanL * tanL;
  const dL = sk42yLocal / (N * cosL)
    - Math.pow(sk42yLocal, 3) / (6 * Math.pow(N, 3) * cosL) * (1 + 2 * t + eta2)
    + Math.pow(sk42yLocal, 5) / (120 * Math.pow(N, 5) * cosL) * (5 + 28 * t + 24 * t * t);
  const L0 = (zone * 6 - 3) * Math.PI / 180;
  return {
    lat: parseFloat((lat * 180 / Math.PI).toFixed(7)),
    lon: parseFloat(((L0 + dL) * 180 / Math.PI).toFixed(7)),
  };
}

export function ddToDms(dd, isLat) {
  const sign = dd < 0 ? -1 : 1;
  const abs = Math.abs(dd);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d - m / 60) * 3600).toFixed(3);
  const hem = isLat ? (sign >= 0 ? 'N' : 'S') : (sign >= 0 ? 'E' : 'W');
  return `${hem} ${d}° ${m}' ${s}"`;
}

// Местные X/Y ← СК-42 (northing=sk42x, восточная полная с зоной)
export function localFromSk42(sk42x, sk42yFull, zone) {
  return { localX: sk42yFull - zone * 1e6 - 500000, localY: sk42x - CALC_OFF };
}
// СК-42 ← местные X/Y
export function sk42FromLocal(localX, localY, zone = CALC_ZONE) {
  return { sk42x: localY + CALC_OFF, sk42yFull: localX + zone * 1e6 + 500000 };
}
