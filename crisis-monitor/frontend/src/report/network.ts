import type { DdResult } from "../api";
import { clip, nid } from "./kit";
import type { Block, GBasis, GEdge, GKind, GNode } from "./model";

type Graph = Extract<Block, { t: "graph" }>;

export const KIND_LABEL: Record<GKind, string> = { subject: "Subject", person: "Person", company: "Company / organisation", office: "Public office", party: "Party / body", risk: "Risk indicator" };
export const BASIS_LABEL: Record<GBasis, string> = { register: "Official register or list", reported: "Reported / reference entry", "name-match": "Name match, unconfirmed" };
const FILL: Record<GKind, string> = { subject: "#17365D", person: "#2F75B5", company: "#0F766E", office: "#6D28D9", party: "#B45309", risk: "#D92D20" };
const MARK: Record<GKind, string> = { subject: "", person: "P", company: "Co", office: "Of", party: "Pa", risk: "!" };
const ORDER: GKind[] = ["office", "party", "company", "person", "risk", "subject"];

// ── Building the graph from a screening ─────────────────────────────────

/** The people, bodies and risk records the screening ties to the subject, each with the basis for the link. */
export function buildNetwork(r: DdResult, name: string): Graph {
  const nodes: GNode[] = [{ id: "subject", label: name, kind: "subject" }];
  const edges: GEdge[] = [];
  const key = new Map<string, string>();
  const node = (kind: GKind, label: string): string => {
    const k = `${kind}:${label.toLowerCase()}`;
    if (!key.has(k)) {
      const id = `n${nodes.length}`;
      key.set(k, id);
      nodes.push({ id, label, kind });
    }
    return key.get(k)!;
  };
  const link = (to: string, label: string, basis: GBasis, from = "subject") => {
    if (!edges.some((e) => e.from === from && e.to === to && e.label === label)) edges.push({ from, to, label, basis });
  };
  const span = (a: string | null, b: string | null, now = "present") => [a, b ?? now].filter(Boolean).join("–");

  if (r.input.kind === "person") {
    const wd = r.office.hits.find((h) => h.isHuman && h.strength === "strong");
    const unambiguous = r.office.hits.filter((h) => h.isHuman && h.strength === "strong").length === 1 && !r.office.hits.some((h) => h.isHuman && h.strength === "possible");
    if (wd && unambiguous) {
      for (const p of wd.positions.slice(0, 5)) link(node("office", p.label), `held ${span(p.from, p.current ? null : p.to)}`.trim(), "reported");
      for (const e of wd.person?.employers.slice(0, 5) ?? []) link(node("company", e.label), `employer ${span(e.from, e.to)}`.trim(), "reported");
      for (const x of wd.person?.parties ?? []) link(node("party", x), "party", "reported");
      for (const x of wd.person?.memberships.slice(0, 3) ?? []) link(node("party", x), "member", "reported");
    }
    for (const h of r.companiesHouse.hits.filter((x) => x.kind === "officer" && x.strength === "strong").slice(0, 2)) link(node("company", `UK companies (${h.appointments ?? "?"} appointment${h.appointments === 1 ? "" : "s"})`), "officer", "register");
  } else {
    for (const g of r.gleif.hits.filter((x) => x.strength === "strong").slice(0, 1)) {
      if (g.ultimateParent) link(node("company", g.ultimateParent), "ultimate parent", "register");
      if (g.directParent) link(node("company", g.directParent), "direct parent", "register");
    }
    for (const h of r.companiesHouse.hits.filter((x) => x.kind === "company" && x.strength === "strong").slice(0, 1))
      for (const p of h.people.slice(0, 8)) link(node("person", p.name), `${p.resigned ? "former " : ""}${p.role}`, "register");
    const prof = r.office.hits.find((h) => !h.isHuman && h.profile && h.strength === "strong")?.profile;
    for (const l of prof?.leaders ?? []) {
      const m = /^(.*) \((.*)\)$/.exec(l);
      link(node("person", m ? m[1] : l), m ? m[2] : "leader", "reported");
    }
    for (const f of prof?.founders ?? []) link(node("person", f), "founder", "reported");
    for (const f of r.office.hits.filter((h) => !h.isHuman && h.strength === "strong").flatMap((h) => h.facts)) {
      const m = /^(Owned by|Parent organisation): (.*)$/.exec(f);
      if (m) link(node("company", m[2]), m[1] === "Owned by" ? "owner" : "parent", "reported");
    }
  }
  for (const h of r.offshore.hits.slice(0, 3)) link(node("risk", `Offshore Leaks: ${clip(h.name, 28)}`), "name match", "name-match");
  for (const h of r.sanctions.hits.slice(0, 3)) link(node("risk", `${h.list} list: ${clip(h.name, 26)}`), h.strength === "strong" ? "strong name match" : "possible name match", "name-match");
  for (const i of (r.media.hits[0]?.items ?? []).filter((x) => x.relevance === "about_subject" && x.severity !== "none" && x.severity !== "low").slice(0, 3))
    link(node("risk", clip(i.what || i.title, 44)), i.status === "none" ? "reported" : i.status, "reported");

  return { t: "graph", id: nid("g"), nodes, edges, caption: "Link analysis from the public-source screening. Solid lines come from official registers or lists, dashed lines from reports or reference entries, dotted lines are name matches not yet confirmed. A link shows a documented connection only, never wrongdoing." };
}

// ── Drawing ─────────────────────────────────────────────────────────────

export const GRAPH_W = 960;
export const GRAPH_H = 700;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(label: string, per = 22): string[] {
  const words = label.split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + w).length <= per) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  if (lines.length > 2) {
    const two = [lines[0], lines.slice(1).join(" ")];
    two[1] = clip(two[1], per);
    return two;
  }
  return lines.map((l) => clip(l, per + 4));
}

/** Where each node sits: the subject in the centre, direct links on an inner ring grouped by kind, links of links on an outer ring beside their parent. */
export function layout(nodes: GNode[], edges: GEdge[]): Map<string, { x: number; y: number }> {
  const cx = GRAPH_W / 2, cy = 316;
  const pos = new Map<string, { x: number; y: number }>([["subject", { x: cx, y: cy }]]);
  const direct = new Set(edges.filter((e) => e.from === "subject" || e.to === "subject").map((e) => (e.from === "subject" ? e.to : e.from)));
  const ring1 = nodes.filter((n) => n.id !== "subject" && direct.has(n.id)).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.label.localeCompare(b.label));
  const ang = new Map<string, number>();
  ring1.forEach((n, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, ring1.length);
    const k = ring1.length > 10 && i % 2 ? 0.8 : 1;
    ang.set(n.id, a);
    pos.set(n.id, { x: cx + Math.cos(a) * 300 * k, y: cy + Math.sin(a) * 190 * k });
  });
  const ring2 = nodes.filter((n) => n.id !== "subject" && !direct.has(n.id));
  const kids = new Map<string, GNode[]>();
  const orphans: GNode[] = [];
  for (const n of ring2) {
    const e = edges.find((x) => (x.from === n.id && ang.has(x.to)) || (x.to === n.id && ang.has(x.from)));
    const parent = e ? (e.from === n.id ? e.to : e.from) : null;
    if (parent) kids.set(parent, [...(kids.get(parent) ?? []), n]);
    else orphans.push(n);
  }
  for (const [parent, list] of kids)
    list.forEach((n, j) => {
      const a = ang.get(parent)! + (j - (list.length - 1) / 2) * 0.2;
      pos.set(n.id, { x: cx + Math.cos(a) * 415, y: cy + Math.sin(a) * 275 });
    });
  orphans.forEach((n, j) => {
    const a = Math.PI / 2 + (j - (orphans.length - 1) / 2) * 0.35;
    pos.set(n.id, { x: cx + Math.cos(a) * 415, y: cy + Math.sin(a) * 275 });
  });
  return pos;
}

function shape(kind: GKind, x: number, y: number): string {
  const f = FILL[kind];
  const mark = MARK[kind];
  const txt = mark ? `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${esc(mark)}</text>` : "";
  if (kind === "subject") return `<circle cx="${x}" cy="${y}" r="38" fill="${f}" stroke="#2F75B5" stroke-width="5"/>`;
  if (kind === "company") return `<rect x="${x - 25}" y="${y - 18}" width="50" height="36" rx="8" fill="${f}"/>${txt}`;
  if (kind === "office") return `<polygon points="${x},${y - 25} ${x + 25},${y} ${x},${y + 25} ${x - 25},${y}" fill="${f}"/>${txt}`;
  if (kind === "party") return `<rect x="${x - 24}" y="${y - 15}" width="48" height="30" rx="15" fill="${f}"/>${txt}`;
  if (kind === "risk") return `<circle cx="${x}" cy="${y}" r="20" fill="#FDE3E1" stroke="${f}" stroke-width="3"/><text x="${x}" y="${y + 6}" text-anchor="middle" font-size="18" font-weight="800" fill="${f}">!</text>`;
  return `<circle cx="${x}" cy="${y}" r="21" fill="${f}"/>${txt}`;
}

/** The diagram as an SVG string: shared by the editor, the PDF and the Word export. */
export function graphSvg(g: Pick<Graph, "nodes" | "edges">): string {
  const pos = layout(g.nodes, g.edges);
  const font = `font-family="Calibri, Carlito, Arial, sans-serif"`;
  const dash = (b: GBasis) => (b === "register" ? "" : b === "reported" ? `stroke-dasharray="8 5"` : `stroke-dasharray="2 5" stroke-linecap="round"`);
  const edgeSvg = g.edges
    .map((e) => {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) return "";
      const col = e.basis === "register" ? "#17365D" : e.basis === "reported" ? "#5B7FA6" : "#D92D20";
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${col}" stroke-width="${e.basis === "register" ? 2.4 : 1.8}" ${dash(e.basis)} opacity="0.85"/>`;
    })
    .join("");
  const labelSvg = g.edges
    .map((e) => {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b || !e.label) return "";
      const t = e.from === "subject" || e.to === "subject" ? 0.58 : 0.5;
      const x = a.x + (b.x - a.x) * (e.from === "subject" ? t : 1 - t);
      const y = a.y + (b.y - a.y) * (e.from === "subject" ? t : 1 - t);
      const txtl = esc(clip(e.label, 30));
      return `<text x="${x}" y="${y - 3}" text-anchor="middle" font-size="11" fill="#F7F9FB" stroke="#F7F9FB" stroke-width="5" stroke-linejoin="round" ${font}>${txtl}</text><text x="${x}" y="${y - 3}" text-anchor="middle" font-size="11" fill="#475467" ${font}>${txtl}</text>`;
    })
    .join("");
  const nodeSvg = g.nodes
    .map((n) => {
      const p = pos.get(n.id);
      if (!p) return "";
      const lines = wrap(n.label, n.kind === "subject" ? 26 : 22);
      const dy = n.kind === "subject" ? 58 : 37;
      const fs = n.kind === "subject" ? 15 : 12;
      const fw = n.kind === "subject" ? 700 : 600;
      const spans = lines.map((l, i) => `<tspan x="${p.x}" y="${p.y + dy + i * 14}">${esc(l)}</tspan>`).join("");
      return `<g>${shape(n.kind, p.x, p.y)}<text text-anchor="middle" font-size="${fs}" font-weight="${fw}" fill="#F7F9FB" stroke="#F7F9FB" stroke-width="5" stroke-linejoin="round" ${font}>${spans}</text><text text-anchor="middle" font-size="${fs}" font-weight="${fw}" fill="#1F2933" ${font}>${spans}</text></g>`;
    })
    .join("");
  const kinds = [...new Set(g.nodes.map((n) => n.kind))].filter((k) => k !== "subject");
  const bases = [...new Set(g.edges.map((e) => e.basis))];
  let lx = 24;
  const legendKinds = kinds
    .map((k) => {
      const s = `<g transform="translate(${lx},0)"><rect x="0" y="-9" width="14" height="14" rx="3" fill="${FILL[k]}"/><text x="20" y="3" font-size="11" fill="#475467" ${font}>${esc(KIND_LABEL[k])}</text></g>`;
      lx += 34 + KIND_LABEL[k].length * 6;
      return s;
    })
    .join("");
  let bx = 24;
  const legendBases = bases
    .map((b) => {
      const col = b === "register" ? "#17365D" : b === "reported" ? "#5B7FA6" : "#D92D20";
      const s = `<g transform="translate(${bx},0)"><line x1="0" y1="-2" x2="30" y2="-2" stroke="${col}" stroke-width="2.4" ${dash(b)}/><text x="38" y="2" font-size="11" fill="#475467" ${font}>${esc(BASIS_LABEL[b])}</text></g>`;
      bx += 52 + BASIS_LABEL[b].length * 6;
      return s;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRAPH_W} ${GRAPH_H}" width="${GRAPH_W}" height="${GRAPH_H}" role="img" aria-label="Link analysis diagram"><rect width="${GRAPH_W}" height="${GRAPH_H}" rx="10" fill="#F7F9FB" stroke="#D0D7E2"/><ellipse cx="${GRAPH_W / 2}" cy="316" rx="300" ry="190" fill="none" stroke="#D0D7E2" stroke-dasharray="3 6"/><ellipse cx="${GRAPH_W / 2}" cy="316" rx="415" ry="275" fill="none" stroke="#E4E9F0" stroke-dasharray="3 6"/>${edgeSvg}${labelSvg}${nodeSvg}<g transform="translate(0,${GRAPH_H - 46})">${legendKinds}</g><g transform="translate(0,${GRAPH_H - 22})">${legendBases}</g></svg>`;
}

/** The diagram as a PNG data URL, for the Word file. Browser only; returns null where there is no canvas. */
export async function graphPng(g: Pick<Graph, "nodes" | "edges">): Promise<string | null> {
  if (typeof document === "undefined") return null;
  try {
    const svg = graphSvg(g);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = GRAPH_W * 2;
    canvas.height = GRAPH_H * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, GRAPH_W, GRAPH_H);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** The links as table rows, so the evidence behind the diagram is readable and exportable. */
export function linkRows(g: Pick<Graph, "nodes" | "edges">): string[][] {
  const label = (id: string) => g.nodes.find((n) => n.id === id)?.label ?? id;
  return g.edges.map((e) => [label(e.from), e.label, label(e.to), BASIS_LABEL[e.basis]]);
}
