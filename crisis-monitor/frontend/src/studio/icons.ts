import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Ambulance, Anchor, Banknote, BedDouble, Biohazard, Bomb, Building2, Bus, Cctv, Church, CircleAlert, Coffee, Container, Crosshair, Droplets, DoorOpen, Eye, Factory, Fence, Flag, Flame, Fuel, Gavel,
  GraduationCap, Handshake, Hospital, Hotel, House, Key, Landmark, Lock, MapPin, Milestone, Mountain, Package, Pickaxe, Pill, Plane, PlaneTakeoff, RadioTower, Radiation, Route, Satellite, School, Ship, ShieldHalf, Siren,
  Star, Stethoscope, Store, Swords, Tent, Train, Trees, Tractor, Truck, TriangleAlert, Users, Utensils, Warehouse, Waves, Wheat, Zap, Camera, Helicopter,
  type LucideIcon,
} from "lucide-react";

export interface IconDef { key: string; label: string; cat: string; icon: LucideIcon; color: string }

export const ICON_CATEGORIES = ["Transport", "Places to stay and eat", "Buildings", "Security", "Health and aid", "Infrastructure", "General"] as const;

const T = "#2563EB", S = "#0E7490", B = "#475569", X = "#B91C1C", H = "#047857", I = "#B45309", G = "#7C3AED";
export const ICONS: IconDef[] = [
  { key: "airport", label: "Airport", cat: "Transport", icon: Plane, color: T },
  { key: "airstrip", label: "Airstrip", cat: "Transport", icon: PlaneTakeoff, color: T },
  { key: "heliport", label: "Helipad", cat: "Transport", icon: Helicopter, color: T },
  { key: "port", label: "Port", cat: "Transport", icon: Anchor, color: S },
  { key: "ferry", label: "Ferry / boat", cat: "Transport", icon: Ship, color: S },
  { key: "train", label: "Railway", cat: "Transport", icon: Train, color: T },
  { key: "bus", label: "Bus station", cat: "Transport", icon: Bus, color: T },
  { key: "border", label: "Border crossing", cat: "Transport", icon: DoorOpen, color: I },
  { key: "checkpoint", label: "Checkpoint", cat: "Transport", icon: Fence, color: I },
  { key: "junction", label: "Road junction", cat: "Transport", icon: Milestone, color: B },
  { key: "route", label: "Route", cat: "Transport", icon: Route, color: B },
  { key: "truck", label: "Convoy / truck", cat: "Transport", icon: Truck, color: B },

  { key: "hotel", label: "Hotel", cat: "Places to stay and eat", icon: Hotel, color: G },
  { key: "guesthouse", label: "Guesthouse", cat: "Places to stay and eat", icon: BedDouble, color: G },
  { key: "restaurant", label: "Restaurant", cat: "Places to stay and eat", icon: Utensils, color: I },
  { key: "cafe", label: "Café", cat: "Places to stay and eat", icon: Coffee, color: I },
  { key: "market", label: "Market / shop", cat: "Places to stay and eat", icon: Store, color: I },

  { key: "office", label: "Office building", cat: "Buildings", icon: Building2, color: B },
  { key: "house", label: "Residence", cat: "Buildings", icon: House, color: B },
  { key: "government", label: "Government", cat: "Buildings", icon: Landmark, color: B },
  { key: "court", label: "Court", cat: "Buildings", icon: Gavel, color: B },
  { key: "prison", label: "Prison", cat: "Buildings", icon: Lock, color: X },
  { key: "bank", label: "Bank", cat: "Buildings", icon: Banknote, color: H },
  { key: "school", label: "School", cat: "Buildings", icon: School, color: G },
  { key: "university", label: "University", cat: "Buildings", icon: GraduationCap, color: G },
  { key: "church", label: "Place of worship", cat: "Buildings", icon: Church, color: G },
  { key: "warehouse", label: "Warehouse", cat: "Buildings", icon: Warehouse, color: B },
  { key: "factory", label: "Factory", cat: "Buildings", icon: Factory, color: B },

  { key: "police", label: "Police", cat: "Security", icon: Siren, color: T },
  { key: "military", label: "Military base", cat: "Security", icon: ShieldHalf, color: "#7C2D12" },
  { key: "clash", label: "Clash / frontline", cat: "Security", icon: Swords, color: X },
  { key: "explosion", label: "Explosion", cat: "Security", icon: Bomb, color: X },
  { key: "fire", label: "Fire", cat: "Security", icon: Flame, color: X },
  { key: "target", label: "Target", cat: "Security", icon: Crosshair, color: X },
  { key: "cctv", label: "Surveillance", cat: "Security", icon: Cctv, color: B },
  { key: "post", label: "Observation post", cat: "Security", icon: Eye, color: B },

  { key: "hospital", label: "Hospital", cat: "Health and aid", icon: Hospital, color: X },
  { key: "clinic", label: "Clinic", cat: "Health and aid", icon: Stethoscope, color: X },
  { key: "pharmacy", label: "Pharmacy", cat: "Health and aid", icon: Pill, color: H },
  { key: "ambulance", label: "Ambulance", cat: "Health and aid", icon: Ambulance, color: X },
  { key: "camp", label: "IDP / refugee camp", cat: "Health and aid", icon: Tent, color: I },
  { key: "food", label: "Food distribution", cat: "Health and aid", icon: Wheat, color: I },
  { key: "water", label: "Water point", cat: "Health and aid", icon: Droplets, color: S },
  { key: "aid", label: "Aid / supplies", cat: "Health and aid", icon: Package, color: I },
  { key: "ngo", label: "NGO / partner", cat: "Health and aid", icon: Handshake, color: H },

  { key: "power", label: "Power plant", cat: "Infrastructure", icon: Zap, color: I },
  { key: "dam", label: "Dam", cat: "Infrastructure", icon: Waves, color: S },
  { key: "oil", label: "Oil / fuel", cat: "Infrastructure", icon: Container, color: "#7C2D12" },
  { key: "fuel", label: "Fuel station", cat: "Infrastructure", icon: Fuel, color: I },
  { key: "mine", label: "Mine", cat: "Infrastructure", icon: Pickaxe, color: B },
  { key: "tower", label: "Telecom tower", cat: "Infrastructure", icon: RadioTower, color: T },
  { key: "satellite", label: "Satellite / ground station", cat: "Infrastructure", icon: Satellite, color: T },
  { key: "farm", label: "Farm", cat: "Infrastructure", icon: Tractor, color: H },
  { key: "forest", label: "Forest", cat: "Infrastructure", icon: Trees, color: H },
  { key: "mountain", label: "Mountain", cat: "Infrastructure", icon: Mountain, color: B },

  { key: "pin", label: "Pin", cat: "General", icon: MapPin, color: X },
  { key: "star", label: "Star", cat: "General", icon: Star, color: I },
  { key: "flag", label: "Flag", cat: "General", icon: Flag, color: X },
  { key: "warning", label: "Warning", cat: "General", icon: TriangleAlert, color: I },
  { key: "info", label: "Information", cat: "General", icon: CircleAlert, color: T },
  { key: "meeting", label: "Meeting point", cat: "General", icon: Users, color: G },
  { key: "camera", label: "Photo / camera", cat: "General", icon: Camera, color: B },
  { key: "key", label: "Key location", cat: "General", icon: Key, color: I },
  { key: "radiation", label: "Radiological", cat: "General", icon: Radiation, color: I },
  { key: "biohazard", label: "Biological hazard", cat: "General", icon: Biohazard, color: I },
];

export const iconDef = (key: string | undefined): IconDef => ICONS.find((i) => i.key === key) ?? ICONS.find((i) => i.key === "pin")!;

const cache = new Map<string, string>();
/** The icon's drawing as an inline SVG string, in the given colour. */
export function iconSvg(key: string | undefined, color = "#fff", size = 18): string {
  const k = `${key}|${color}|${size}`;
  let v = cache.get(k);
  if (!v) {
    v = renderToStaticMarkup(createElement(iconDef(key).icon, { size, color, strokeWidth: 2.2 }));
    cache.set(k, v);
  }
  return v;
}

/** HTML for a marker on the map: a coloured round badge with the icon, a pointer and an optional label. */
export function markerHtml(opts: { icon?: string; color?: string; size?: number; label?: string; selected?: boolean }): string {
  const size = opts.size ?? 36;
  const color = opts.color ?? iconDef(opts.icon).color;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div class="studio-pin${opts.selected ? " is-selected" : ""}" style="--c:${color};--s:${size}px"><div class="studio-pin__badge">${iconSvg(opts.icon, "#fff", Math.round(size * 0.52))}</div><div class="studio-pin__tip"></div>${opts.label ? `<div class="studio-pin__label">${esc(opts.label)}</div>` : ""}</div>`;
}
