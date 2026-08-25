declare module "shpjs" {
  /** Parses a zipped shapefile (.zip containing .shp/.dbf/.prj/etc) or a raw
   *  .shp ArrayBuffer into GeoJSON. Returns a Feature/FeatureCollection, or an
   *  array of FeatureCollections when the zip contains multiple layers. */
  export default function shp(buffer: ArrayBuffer): Promise<GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[]>;
}
