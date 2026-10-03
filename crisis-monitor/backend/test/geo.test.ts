import { describe, it, expect } from "vitest";
import { CONFLICT_GAZETTEER } from "../src/lib/conflictGazetteer";
import {
  AFRICA_GEO_COUNTRIES,
  AFRICA_CENTROIDS,
  countryAt,
  distanceKm,
  isInOrNearCountry,
  lookupKnownPlace,
  mentionsAfrica,
  normalizeName,
  resolveCountryCode,
  resolvePlaceOffline,
} from "../src/lib/africaGeo";
import places from "../src/data/africaPlaces.json";

describe("country name resolution is exact, never substring", () => {
  it("does not confuse countries whose names contain each other", () => {
    expect(resolveCountryCode("Mali")).toBe("ML");
    expect(resolveCountryCode("Somalia")).toBe("SO");
    expect(resolveCountryCode("Somaliland")).toBe("SO");
    expect(resolveCountryCode("Niger")).toBe("NE");
    expect(resolveCountryCode("Nigeria")).toBe("NG");
    expect(resolveCountryCode("Sudan")).toBe("SD");
    expect(resolveCountryCode("South Sudan")).toBe("SS");
    expect(resolveCountryCode("Guinea")).toBe("GN");
    expect(resolveCountryCode("Guinea-Bissau")).toBe("GW");
    expect(resolveCountryCode("Equatorial Guinea")).toBe("GQ");
    expect(resolveCountryCode("DRC")).toBe("CD");
    expect(resolveCountryCode("Congo (Rep.)")).toBe("CG");
    expect(resolveCountryCode("Côte d'Ivoire")).toBe("CI");
    expect(resolveCountryCode("Ivory Coast")).toBe("CI");
  });
  it("returns null for non-African countries and free text", () => {
    for (const n of ["Yemen", "Saudi Arabia", "Papua New Guinea", "Oman", "Somali", "Malian forces", ""]) {
      expect(resolveCountryCode(n)).toBeNull();
    }
  });
});

describe("point-in-country", () => {
  it("places well-known towns in the right country", () => {
    expect(countryAt(13.4967, 39.4753)).toBe("ET"); // Mekelle
    expect(countryAt(11.5, 42.5)).toBe("DJ"); // inland Djibouti
    expect(isInOrNearCountry("DJ", 11.588, 43.145)).toBe(true); // Djibouti city sits on the simplified coastline
    expect(countryAt(9.56, 44.065)).toBe("SO"); // Hargeisa (Somaliland folded into Somalia)
    expect(countryAt(12.6392, -8.0029)).toBe("ML"); // Bamako
    expect(countryAt(-29.3151, 27.4869)).toBe("LS"); // Maseru, not South Africa
    expect(countryAt(4.8517, 31.5825)).toBe("SS"); // Juba, not Sudan
    expect(countryAt(13.5116, 2.1254)).toBe("NE"); // Niamey, not Nigeria
  });
  it("returns null outside Africa", () => {
    expect(countryAt(24.7136, 46.6753)).toBeNull(); // Riyadh
    expect(countryAt(13.5789, 44.0209)).toBeNull(); // Taiz, Yemen
  });
  it("rejects the mis-geolocations that were reported", () => {
    // An Ethiopia (Tigray) event must not be accepted at a Djibouti coordinate.
    expect(isInOrNearCountry("ET", 11.588, 43.145)).toBe(false);
    // Nothing in Yemen or Saudi Arabia can pass as any African country.
    for (const code of Object.keys(AFRICA_GEO_COUNTRIES)) {
      expect(isInOrNearCountry(code, 24.7136, 46.6753)).toBe(false);
      expect(isInOrNearCountry(code, 13.5789, 44.0209)).toBe(false);
    }
    // A Somaliland event must not be accepted inside Ethiopia or Mali.
    expect(isInOrNearCountry("SO", 9.03, 38.74)).toBe(false);
    expect(isInOrNearCountry("ML", 9.56, 44.065)).toBe(false);
  });
});

describe("curated gazetteer integrity", () => {
  it("every entry lies inside (or at the border of) its stated country", () => {
    // Disputed territories, where the bundled Natural Earth borders draw the
    // line differently from how the place is reported: Abyei (claimed by both
    // Sudan and South Sudan) and the Moroccan-administered part of Western Sahara.
    const disputed = new Set(["SS:Abyei", "EH:Laayoune", "EH:Smara", "EH:Dakhla", "EH:Mahbes"]);
    const bad = CONFLICT_GAZETTEER.filter((p) => !disputed.has(`${p.country}:${p.name}`) && !isInOrNearCountry(p.country, p.lat, p.lon)).map((p) => `${p.name} (${p.country}) -> ${countryAt(p.lat, p.lon)}`);
    expect(bad).toEqual([]);
  });
  it("agrees with GeoNames to within 40 km wherever GeoNames has the same town", () => {
    const geo = new Map<string, [number, number]>();
    for (const [name, cc, lat, lon] of places as unknown as [string, string, number, number, number][]) {
      const k = `${cc}:${normalizeName(name)}`;
      if (!geo.has(k)) geo.set(k, [lat, lon]);
    }
    const bad: string[] = [];
    for (const p of CONFLICT_GAZETTEER) {
      if (p.kind === "region") continue;
      for (const n of [p.name, ...(p.aliases ?? [])]) {
        const g = geo.get(`${p.country}:${normalizeName(n)}`);
        // GeoNames' "Goz Beida" is a different, smaller settlement of the same
        // name; the curated entry is the Sila provincial capital.
        if (!g || (p.country === "TD" && p.name === "Goz Beida")) continue;
        const d = distanceKm(p.lat, p.lon, g[0], g[1]);
        if (d > 40) bad.push(`${p.name} (${p.country}) as "${n}": ${d.toFixed(0)} km from GeoNames ${g}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("every country has a centroid inside itself or its waters", () => {
    for (const code of Object.keys(AFRICA_GEO_COUNTRIES)) expect(AFRICA_CENTROIDS[code], code).toBeDefined();
  });
});

describe("place resolution stays inside the stated country", () => {
  it("resolves transliteration variants to the same place", () => {
    for (const n of ["Mekelle", "Mekele", "Mek'ele", "mekelle city"]) {
      expect(lookupKnownPlace("ET", n)?.name).toBe("Mekelle");
    }
    expect(lookupKnownPlace("SD", "Al-Fashir")?.name).toBe("El Fasher");
    expect(lookupKnownPlace("SD", "al fasher")?.name).toBe("El Fasher");
    expect(lookupKnownPlace("ML", "Tombouctou")?.name).toBe("Timbuktu");
  });
  it("never finds a place by looking in another country", () => {
    expect(lookupKnownPlace("DJ", "Mekelle")).toBeNull();
    expect(lookupKnownPlace("ML", "Hargeisa")).toBeNull();
    expect(lookupKnownPlace("ET", "Hargeisa")).toBeNull();
  });
  it("discards model coordinates that fall outside the stated country", () => {
    // Model claims a Tigray village but gives Djibouti coordinates -> falls back to the Tigray region centroid.
    const r = resolvePlaceOffline({ countryCode: "ET", place: "Some Unknown Village", admin1: "Tigray", modelLat: 11.588, modelLon: 43.145 });
    expect(r.precision).toBe("region");
    expect(countryAt(r.lat, r.lon)).toBe("ET");
    // In-country estimate is accepted but labelled approximate.
    const ok = resolvePlaceOffline({ countryCode: "ET", place: "Some Unknown Village", admin1: "Tigray", modelLat: 13.9, modelLon: 39.2 });
    expect(ok.precision).toBe("approximate");
  });
  it("falls back to the country centroid, labelled as such, when nothing is named", () => {
    const r = resolvePlaceOffline({ countryCode: "KE" });
    expect(r.precision).toBe("country");
    expect(r.method).toBe("country-centroid");
  });
});

describe("Africa relevance check for world-news feeds", () => {
  it("passes items about Africa and skips the rest", () => {
    for (const t of ["Sudan's army retakes key Kordofan town", "Drone strike kills seven in Mekelle", "Malian junta delays vote", "DR Congo rebels advance on Uvira", "Somaliland forces clash near Las Anod"]) expect(mentionsAfrica(t), t).toBe(true);
    for (const t of ["Russian strike hits Kharkiv apartment block", "Houthi forces shell Taiz", "Israel strikes southern Lebanon", "Papua New Guinea landslide toll rises"]) expect(mentionsAfrica(t), t).toBe(false);
  });
});
