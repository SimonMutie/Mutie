import { describe, it, expect, beforeAll } from "vitest";
import { DOMParser as XmlDom } from "@xmldom/xmldom";
import { importGeoFiles, parseWkt, normalise } from "../../frontend/src/studio/importers";
import { circleRing, fmtArea, measure, fitLayerToSize, toKml } from "../../frontend/src/studio/geo";
import { patternId, patternSvg, hasPattern } from "../../frontend/src/studio/patterns";

beforeAll(() => {
  (globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDom;
});

const file = (name: string, text: string) => new File([text], name);

describe("importing map files", () => {
  it("reads GeoJSON, drops altitude and skips empty geometry", async () => {
    const r = await importGeoFiles([file("kampala.geojson", JSON.stringify({ type: "FeatureCollection", features: [
      { type: "Feature", properties: { name: "A" }, geometry: { type: "Point", coordinates: [32.58, 0.31, 1200] } },
      { type: "Feature", properties: {}, geometry: null },
    ] }))]);
    expect(r.fc.features).toHaveLength(1);
    expect(r.fc.features[0].geometry).toEqual({ type: "Point", coordinates: [32.58, 0.31] });
    expect(r.warnings[0]).toMatch(/1 feature/);
    expect(r.source).toBe("geojson");
  });
  it("reads a bare geometry and a TopoJSON file", async () => {
    expect((await importGeoFiles([file("p.json", JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }))])).counts).toEqual({ Polygon: 1 });
    const topo = { type: "Topology", arcs: [[[0, 0], [10, 0], [0, 10], [-10, 0], [0, -10]]], transform: { scale: [0.1, 0.1], translate: [30, 0] }, objects: { box: { type: "Polygon", arcs: [[0]] } } };
    const r = await importGeoFiles([file("t.topojson", JSON.stringify(topo))]);
    expect(r.source).toBe("topojson");
    expect(r.fc.features[0].geometry.type).toBe("Polygon");
  });
  it("reads KML and GPX", async () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Hotel</name><Point><coordinates>36.8,-1.28,0</coordinates></Point></Placemark><Placemark><name>Zone</name><Polygon><outerBoundaryIs><LinearRing><coordinates>36,-1 37,-1 37,0 36,-1</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
    const r = await importGeoFiles([file("a.kml", kml)]);
    expect(r.counts).toEqual({ Point: 1, Polygon: 1 });
    const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><name>T</name><trkseg><trkpt lat="1" lon="30"/><trkpt lat="1.5" lon="30.5"/></trkseg></trk></gpx>`;
    expect((await importGeoFiles([file("a.gpx", gpx)])).counts).toEqual({ LineString: 1 });
  });
  it("reads CSV with latitude and longitude, and WKT", async () => {
    const r = await importGeoFiles([file("sites.csv", 'name,lat,lon\n"Juba, airport",4.87,31.6\nBor,6.2,31.56\nbad,,\n')]);
    expect(r.fc.features).toHaveLength(2);
    expect(r.fc.features[0].properties).toEqual({ name: "Juba, airport" });
    const w = await importGeoFiles([file("a.wkt", "POLYGON((30 0, 31 0, 31 1, 30 0))\nPOINT(32 1)")]);
    expect(w.counts).toEqual({ Polygon: 1, Point: 1 });
    expect(parseWkt("MULTIPOLYGON(((0 0,1 0,1 1,0 0)),((2 2,3 2,3 3,2 2)))")).toMatchObject({ type: "MultiPolygon" });
  });
  it("refuses projected coordinates and unknown formats with a useful message", async () => {
    expect(() => normalise({ type: "Point", coordinates: [500000, 9000000] })).toThrow(/\.prj/);
    await expect(importGeoFiles([file("a.docx", "x")])).rejects.toThrow(/Supported/);
    await expect(importGeoFiles([file("a.csv", "name,value\na,1\n")])).rejects.toThrow(/latitude and longitude/);
  });
});

describe("geometry helpers", () => {
  it("measures a circle, formats areas, and stays under the size limit", () => {
    const ring = circleRing(32, 1, 1000);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const m = measure({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } });
    expect(m.areaM2! / (Math.PI * 1000 * 1000)).toBeGreaterThan(0.99);
    expect(m.areaM2! / (Math.PI * 1000 * 1000)).toBeLessThan(1.01);
    expect(fmtArea(3_140_000)).toBe("3.14 km²");
    const big = { type: "FeatureCollection" as const, features: Array.from({ length: 40 }, (_, i) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [Array.from({ length: 3000 }, (_, j) => [i + Math.cos(j / 20) * 0.4 + j * 1e-6, Math.sin(j / 20) * 0.4]).concat([[i + 0.4, 0]])] } })) };
    const fit = fitLayerToSize(big, 400_000);
    expect(fit.simplified).toBe(true);
    expect(fit.bytes).toBeLessThanOrEqual(400_000);
  });
  it("writes KML with colours and builds distinct fill patterns", () => {
    const k = toKml("Layer", [{ name: "Zone", geometry: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }, style: { color: "#ff0000", fillOpacity: 0.5 } }]);
    expect(k).toContain("<color>ff0000ff</color>");
    const spec = { key: "cross" as const, color: "#000000", size: 10, weight: 1.5, bg: "#ffcc00", bgOpacity: 0.3 };
    expect(patternId(spec)).not.toBe(patternId({ ...spec, key: "stripes-h" }));
    expect(patternSvg(spec).match(/<line/g)!.length).toBe(6);
    expect(hasPattern("solid")).toBe(false);
    expect(hasPattern("dots")).toBe(true);
  });
});

describe("shapefiles", () => {
  function pointShp(x: number, y: number): ArrayBuffer {
    const buf = new ArrayBuffer(128);
    const v = new DataView(buf);
    v.setInt32(0, 9994, false);
    v.setInt32(24, 64, false);
    v.setInt32(28, 1000, true);
    v.setInt32(32, 1, true);
    [x, y, x, y].forEach((n, i) => v.setFloat64(36 + i * 8, n, true));
    v.setInt32(100, 1, false);
    v.setInt32(104, 10, false);
    v.setInt32(108, 1, true);
    v.setFloat64(112, x, true);
    v.setFloat64(120, y, true);
    return buf;
  }
  it("reads a zipped shapefile and loose .shp/.prj files", async () => {
    const { default: JSZip } = await import("../../frontend/node_modules/jszip");
    const wgs = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
    const zip = new JSZip();
    zip.file("sites.shp", pointShp(31.6, 4.85));
    zip.file("sites.prj", wgs);
    const z = new File([await zip.generateAsync({ type: "arraybuffer" })], "sites.zip");
    const r = await importGeoFiles([z]);
    expect(r.source).toBe("shapefile");
    expect(r.fc.features[0].geometry).toMatchObject({ type: "Point", coordinates: [31.6, 4.85] });
    const loose = await importGeoFiles([new File([pointShp(30, 1)], "a.shp"), new File([wgs], "a.prj")]);
    const lc = (loose.fc.features[0].geometry as GeoJSON.Point).coordinates;
    expect(lc[0]).toBeCloseTo(30, 4);
    expect(lc[1]).toBeCloseTo(1, 4);
  });
});
