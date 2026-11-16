/**
 * Ground height from the open Terrarium elevation tiles (Mapzen's blend of SRTM, GMTED2010 and ETOPO1, hosted as an
 * AWS open dataset; no key). Zoom 12 is about 30 to 38 m a pixel at these latitudes.
 */
const ZOOM = 12;
const SIZE = 256;
const tiles = new Map<string, Promise<ImageData | null>>();

function loadTile(x: number, y: number): Promise<ImageData | null> {
  const key = `${x}/${y}`;
  let hit = tiles.get(key);
  if (!hit) {
    hit = new Promise<ImageData | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = SIZE;
          canvas.height = SIZE;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0);
          resolve(ctx.getImageData(0, 0, SIZE, SIZE));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`;
    });
    tiles.set(key, hit);
    if (tiles.size > 200) tiles.delete(tiles.keys().next().value as string);
  }
  return hit;
}

/** Height in metres above sea level, or null when the tile cannot be read. */
export async function elevationAt(lat: number, lng: number): Promise<number | null> {
  const n = 2 ** ZOOM;
  const clamped = Math.max(-85, Math.min(85, lat));
  const fx = ((lng + 180) / 360) * n;
  const rad = (clamped * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const data = await loadTile(((tx % n) + n) % n, ty);
  if (!data) return null;
  const px = Math.min(SIZE - 1, Math.floor((fx - tx) * SIZE));
  const py = Math.min(SIZE - 1, Math.floor((fy - ty) * SIZE));
  const i = (py * SIZE + px) * 4;
  return data.data[i] * 256 + data.data[i + 1] + data.data[i + 2] / 256 - 32768;
}

const EARTH = 6_371_008.8;
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface ProfilePoint { lat: number; lng: number; dist: number; height: number | null }

/** Evenly spaced points along a path, each with its distance from the start. */
export function samplePath(path: { lat: number; lng: number }[], samples: number): { lat: number; lng: number; dist: number }[] {
  const legs = path.slice(1).map((p, i) => haversineM(path[i], p));
  const total = legs.reduce((a, b) => a + b, 0);
  if (path.length < 2 || total <= 0) return [];
  const out: { lat: number; lng: number; dist: number }[] = [];
  for (let s = 0; s <= samples; s++) {
    const target = (total * s) / samples;
    let run = 0, leg = 0;
    while (leg < legs.length - 1 && run + legs[leg] < target) run += legs[leg++];
    const t = legs[leg] > 0 ? Math.min(1, (target - run) / legs[leg]) : 0;
    out.push({ lat: path[leg].lat + (path[leg + 1].lat - path[leg].lat) * t, lng: path[leg].lng + (path[leg + 1].lng - path[leg].lng) * t, dist: target });
  }
  return out;
}

export async function elevationProfile(path: { lat: number; lng: number }[], samples = 96): Promise<ProfilePoint[]> {
  const pts = samplePath(path, samples);
  const heights = await Promise.all(pts.map((p) => elevationAt(p.lat, p.lng)));
  return pts.map((p, i) => ({ ...p, height: heights[i] }));
}

export interface SightResult {
  visible: boolean;
  /** Distance from the viewer to the first ground that blocks the view, in metres. */
  blockedAt: number | null;
  /** How far the blocking ground stands above the sight line, in metres. */
  blockedBy: number | null;
}

/**
 * Whether the far end of a profile can be seen from the near end. The viewer's eye is `eye` metres above the ground,
 * the target is the ground itself, and the Earth's curve is allowed for with standard refraction (k = 0.13).
 */
export function lineOfSight(profile: ProfilePoint[], eye = 2): SightResult | null {
  if (profile.length < 3 || profile.some((p) => p.height === null)) return null;
  const total = profile[profile.length - 1].dist;
  const from = (profile[0].height as number) + eye;
  const to = profile[profile.length - 1].height as number;
  const reff = EARTH / (1 - 0.13);
  for (let i = 1; i < profile.length - 1; i++) {
    const d = profile[i].dist;
    const sight = from + ((to - from) * d) / total;
    const ground = (profile[i].height as number) + (d * (total - d)) / (2 * reff);
    if (ground > sight) return { visible: false, blockedAt: d, blockedBy: ground - sight };
  }
  return { visible: true, blockedAt: null, blockedBy: null };
}
