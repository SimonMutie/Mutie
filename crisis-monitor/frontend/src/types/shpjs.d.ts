declare module "shpjs" {
  type Result = GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[];
  /** Parses a zipped shapefile (.zip containing .shp/.dbf/.prj/etc) or a raw
   *  .shp ArrayBuffer into GeoJSON. Returns a Feature/FeatureCollection, or an
   *  array of FeatureCollections when the zip contains multiple layers. */
  export default function shp(buffer: ArrayBuffer): Promise<Result>;
  export function parseShp(shp: ArrayBuffer, prj?: string | false): GeoJSON.Geometry[];
  export function parseDbf(dbf: ArrayBuffer, cpg?: string): Record<string, unknown>[];
  export function combine(parts: [GeoJSON.Geometry[], Record<string, unknown>[] | undefined]): GeoJSON.FeatureCollection;
}
