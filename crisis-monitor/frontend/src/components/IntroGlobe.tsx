import { useEffect, useRef } from "react";
import { geoCircle, geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

/**
 * The opening globe (IntroOverlay): the Earth spins in from far away and slows to rest on Africa as it draws closer,
 * with an atmosphere, gold Africa, pulses rippling out from African cities, light running along arcs between them,
 * slowly turning rings and a satellite in orbit. When `leaving` turns true it rushes in towards the viewer while the
 * overlay opens onto the site. Drawn on one canvas; nothing here outlives the overlay.
 */

const AFRICA_IDS = new Set([
  "012", "024", "072", "108", "120", "132", "140", "148", "174", "178", "180", "204", "226", "231", "232", "262", "266", "270", "288", "324", "384",
  "404", "426", "430", "434", "450", "454", "466", "478", "480", "504", "508", "516", "562", "566", "624", "646", "678", "686", "690", "694", "706",
  "710", "716", "728", "729", "732", "748", "768", "788", "800", "818", "834", "854", "894",
]);

/** [lon, lat] of the cities the pulses ripple out from. */
const HUBS: [number, number][] = [
  [36.82, -1.29], // Nairobi
  [32.53, 15.5], // Khartoum
  [38.75, 9.03], // Addis Ababa
  [45.34, 2.04], // Mogadishu
  [3.38, 6.52], // Lagos
  [15.31, -4.32], // Kinshasa
  [-8.0, 12.64], // Bamako
  [31.24, 30.04], // Cairo
  [28.05, -26.2], // Johannesburg
  [-17.47, 14.72], // Dakar
  [31.58, 4.85], // Juba
  [15.04, 12.11], // N'Djamena
];
const ARCS: [number, number][] = [
  [0, 1], [0, 3], [0, 8], [1, 7], [2, 3], [4, 6], [4, 5], [5, 8], [6, 9], [1, 11], [10, 0], [11, 4],
];

/** Where the spin comes to rest: Africa, slightly north of the equator, a little tilted. */
const REST: [number, number, number] = [-18, -6, 0];
const START_LON = 150; // starts turned away (over the Americas and Pacific) and turns round to Africa

/** The globe's centre, as a share of the screen's height (IntroOverlay opens the screen from here). */
export const GLOBE_Y = 0.4;

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export default function IntroGlobe({ leaving, reduced }: { leaving: boolean; reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leavingAt = useRef<number | null>(null);
  if (leaving && leavingAt.current === null) leavingAt.current = performance.now();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let land: GeoPermissibleObjects | null = null;
    let africa: GeoPermissibleObjects | null = null;
    let borders: GeoPermissibleObjects | null = null;
    let stopped = false;
    void import("world-atlas/countries-110m.json").then((m) => {
      const topo = (m.default ?? m) as unknown as Topology;
      const all = feature(topo, topo.objects.countries as GeometryCollection);
      land = all;
      africa = { type: "FeatureCollection", features: all.features.filter((f) => AFRICA_IDS.has(String(f.id))) } as GeoPermissibleObjects;
      borders = africa;
    });

    // Stars: fixed positions, each with its own twinkle.
    const stars = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + 0.2, p: Math.random() * Math.PI * 2, s: 0.6 + Math.random() * 1.6 }));
    const graticule = geoGraticule10();
    const projection = geoOrthographic().clipAngle(90).precision(0.6);
    const path = geoPath(projection, ctx);
    const circle = geoCircle();
    const t0 = performance.now();
    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const frame = (now: number) => {
      if (stopped) return;
      const t = (now - t0) / 1000;
      const leaveT = leavingAt.current ? (now - leavingAt.current) / 1000 : 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // The globe sits a little above the middle; the welcome is below it.
      const cx = w / 2;
      const cy = h * GLOBE_Y;
      const base = Math.min(w, h);

      // The approach: from small and far to close over six seconds; leaving, it rushes in.
      const approach = reduced ? 1 : ease(t / 6.2);
      let radius = base * (0.11 + 0.135 * approach);
      if (leaveT > 0) radius *= 1 + Math.pow(leaveT * 1.6, 3) * 1.4;
      const fade = leaveT > 0 ? Math.max(0, 1 - leaveT / 1.6) : 1;

      // Spin: most of a turn, slowing steadily to rest on Africa as the globe draws close, then a gentle drift.
      const spin = reduced ? 0 : 1 - ease(t / 6.6);
      const lon = REST[0] - (START_LON + 180) * spin + (reduced ? 0 : Math.max(0, t - 6.6) * 1.4);
      const lat = REST[1] + (reduced ? 0 : 14 * spin);
      projection.scale(radius).translate([cx, cy]).rotate([lon, lat, REST[2]]);

      // Stars, parting slightly as the globe approaches.
      for (const s of stars) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
        const dx = (s.x - 0.5) * w * (1 + approach * 0.06 + leaveT * 0.5);
        const dy = (s.y - 0.5) * h * (1 + approach * 0.06 + leaveT * 0.5);
        ctx.globalAlpha = tw * 0.8 * fade;
        ctx.fillStyle = "#cfe3ff";
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = fade;

      // Sonar waves: rings leaving the globe's edge, one after another.
      if (!reduced) {
        for (let i = 0; i < 4; i++) {
          const ph = (t * 0.32 + i / 4) % 1;
          const rr = radius * (1.02 + ph * 1.25);
          ctx.strokeStyle = `rgba(212,175,55,${(1 - ph) * 0.28 * fade})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Atmosphere.
      const atm = ctx.createRadialGradient(cx, cy, radius * 0.92, cx, cy, radius * 1.32);
      atm.addColorStop(0, "rgba(45,212,191,0.38)");
      atm.addColorStop(0.35, "rgba(56,130,246,0.14)");
      atm.addColorStop(1, "rgba(56,130,246,0)");
      ctx.fillStyle = atm;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.32, 0, Math.PI * 2);
      ctx.fill();

      // Ocean, lit from the upper left.
      const ocean = ctx.createRadialGradient(cx - radius * 0.38, cy - radius * 0.42, radius * 0.05, cx, cy, radius);
      ocean.addColorStop(0, "#14365c");
      ocean.addColorStop(0.55, "#0a1d36");
      ocean.addColorStop(1, "#040b17");
      ctx.fillStyle = ocean;
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fill();

      // Graticule.
      ctx.strokeStyle = "rgba(120,170,255,0.09)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      path(graticule);
      ctx.stroke();

      // Land, then Africa in gold with a glowing coast.
      if (land) {
        ctx.fillStyle = "#16314f";
        ctx.beginPath();
        path(land);
        ctx.fill();
        ctx.strokeStyle = "rgba(140,190,255,0.18)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      if (africa) {
        const gold = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
        gold.addColorStop(0, "rgba(232,196,90,0.95)");
        gold.addColorStop(1, "rgba(176,128,32,0.9)");
        ctx.fillStyle = gold;
        ctx.beginPath();
        path(africa);
        ctx.fill();
        ctx.save();
        ctx.shadowColor = "rgba(255,214,102,0.85)";
        ctx.shadowBlur = 14;
        ctx.strokeStyle = "rgba(255,226,140,0.9)";
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();
        if (borders) {
          ctx.strokeStyle = "rgba(60,38,6,0.45)";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          path(borders);
          ctx.stroke();
        }
      }

      // Arcs between hubs with a light running along each.
      const centre: [number, number] = [-lon, -lat];
      ARCS.forEach(([a, b], i) => {
        const A = HUBS[a];
        const B = HUBS[b];
        ctx.strokeStyle = "rgba(94,234,212,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        path({ type: "LineString", coordinates: [A, B] });
        ctx.stroke();
        const k = (t * 0.45 + i * 0.17) % 1;
        const p = geoInterpolate(A, B)(k);
        if (geoDistance(p, centre) < Math.PI / 2) {
          const xy = projection(p);
          if (xy) {
            const g = ctx.createRadialGradient(xy[0], xy[1], 0, xy[0], xy[1], 6);
            g.addColorStop(0, "rgba(220,255,250,1)");
            g.addColorStop(1, "rgba(94,234,212,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(xy[0], xy[1], 6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // Pulses rippling out across the surface from each hub.
      HUBS.forEach((hub, i) => {
        for (let k = 0; k < 2; k++) {
          const ph = (t * 0.55 + i * 0.13 + k * 0.5) % 1;
          ctx.strokeStyle = `rgba(255,214,102,${(1 - ph) * 0.9})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          path(circle.center(hub).radius(0.4 + ph * 5.5)());
          ctx.stroke();
        }
        if (geoDistance(hub, centre) < Math.PI / 2) {
          const xy = projection(hub);
          if (xy) {
            ctx.fillStyle = "#fff6d6";
            ctx.beginPath();
            ctx.arc(xy[0], xy[1], 1.9, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // Night side and rim light, so it reads as a sphere.
      const shade = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, radius * 0.2, cx, cy, radius * 1.02);
      shade.addColorStop(0, "rgba(0,0,0,0)");
      shade.addColorStop(0.7, "rgba(2,6,14,0.18)");
      shade.addColorStop(1, "rgba(2,6,14,0.72)");
      ctx.fillStyle = shade;
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fill();
      ctx.strokeStyle = "rgba(125,211,252,0.45)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.stroke();

      // Rings turning round the globe at different speeds, and a satellite on a tilted orbit.
      if (!reduced) {
        const rings: [number, number, number[], string][] = [
          [1.42, 0.18, [2, 10], "rgba(125,211,252,0.35)"],
          [1.58, -0.11, [40, 14, 4, 14], "rgba(212,175,55,0.45)"],
          [1.76, 0.07, [1, 7], "rgba(94,234,212,0.3)"],
        ];
        rings.forEach(([f, speed, dash, colour]) => {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(t * speed);
          ctx.setLineDash(dash);
          ctx.strokeStyle = colour;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(0, 0, radius * f, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        });
        ctx.setLineDash([]);
        // Tick marks on the outer ring, like an instrument dial.
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-t * 0.05);
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          const r1 = radius * 1.9;
          const r2 = radius * (i % 6 === 0 ? 1.97 : 1.93);
          ctx.strokeStyle = i % 6 === 0 ? "rgba(212,175,55,0.55)" : "rgba(148,163,184,0.25)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
          ctx.stroke();
        }
        ctx.restore();
        // Satellite.
        const oa = t * 0.7;
        const ox = Math.cos(oa) * radius * 1.5;
        const oy = Math.sin(oa) * radius * 0.42;
        const tilt = -0.42;
        const sx = cx + ox * Math.cos(tilt) - oy * Math.sin(tilt);
        const sy = cy + ox * Math.sin(tilt) + oy * Math.cos(tilt);
        const behind = Math.sin(oa) < 0 && Math.hypot(sx - cx, sy - cy) < radius;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.strokeStyle = "rgba(125,211,252,0.18)";
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 1.5, radius * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        if (!behind) {
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 5);
          g.addColorStop(0, "rgba(255,255,255,0.95)");
          g.addColorStop(0.4, "rgba(186,230,253,0.7)");
          g.addColorStop(1, "rgba(125,211,252,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(sx, sy, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => {
      stopped = true;
      window.removeEventListener("resize", resize);
    };
  }, [reduced]);

  return <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />;
}
