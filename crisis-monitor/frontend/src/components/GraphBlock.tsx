import { useMemo } from "react";
import { BASIS_LABEL, KIND_LABEL, graphSvg } from "../report/network";
import type { Block, GBasis, GKind } from "../report/model";

type Graph = Extract<Block, { t: "graph" }>;
const KINDS = Object.keys(KIND_LABEL).filter((k) => k !== "subject") as GKind[];
const BASES = Object.keys(BASIS_LABEL) as GBasis[];

const field: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "5px 7px", fontSize: 12.5, fontFamily: "var(--font-body)", minWidth: 0 };
const mini: React.CSSProperties = { fontSize: 12, padding: "3px 8px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer" };

/** The link-analysis diagram with its editor: add or remove people, companies and links, and set how well each link is evidenced. */
export default function GraphBlock({ b, onChange }: { b: Graph; onChange: (fn: (g: Graph) => Graph) => void }) {
  const svg = useMemo(() => graphSvg(b), [b.nodes, b.edges]);
  const label = (id: string) => b.nodes.find((n) => n.id === id)?.label ?? id;
  const addNode = () => onChange((g) => ({ ...g, nodes: [...g.nodes, { id: `x${Date.now().toString(36)}`, label: "New person or company", kind: "person" }] }));
  const addEdge = () =>
    onChange((g) => ({ ...g, edges: [...g.edges, { from: "subject", to: g.nodes[g.nodes.length - 1]?.id ?? "subject", label: "associate", basis: "reported" }] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ border: "1px solid var(--border-soft)", borderRadius: 8, overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: svg.replace(/ width="\d+" height="\d+"/, ' style="width:100%;height:auto;display:block"') }} />
      <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{b.caption}</div>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>Edit the diagram ({b.nodes.length - 1} connected, {b.edges.length} links)</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>People and organisations</div>
          {b.nodes.map((n) => (
            <div key={n.id} style={{ display: "flex", gap: 6 }}>
              <input value={n.label} onChange={(e) => onChange((g) => ({ ...g, nodes: g.nodes.map((x) => (x.id === n.id ? { ...x, label: e.target.value } : x)) }))} style={{ ...field, flex: 1 }} aria-label="Name" />
              {n.kind === "subject" ? (
                <span style={{ ...field, border: "none", color: "var(--text-faint)" }}>Subject</span>
              ) : (
                <>
                  <select value={n.kind} onChange={(e) => onChange((g) => ({ ...g, nodes: g.nodes.map((x) => (x.id === n.id ? { ...x, kind: e.target.value as GKind } : x)) }))} style={field} aria-label="Type">
                    {KINDS.map((k) => (
                      <option key={k} value={k}>{KIND_LABEL[k]}</option>
                    ))}
                  </select>
                  <button type="button" style={mini} aria-label={`Remove ${n.label}`} onClick={() => onChange((g) => ({ ...g, nodes: g.nodes.filter((x) => x.id !== n.id), edges: g.edges.filter((e) => e.from !== n.id && e.to !== n.id) }))}>×</button>
                </>
              )}
            </div>
          ))}
          <div><button type="button" style={mini} onClick={addNode}>+ Add person or organisation</button></div>
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginTop: 6 }}>Links</div>
          {b.edges.map((e, i) => {
            const set = (patch: Partial<typeof e>) => onChange((g) => ({ ...g, edges: g.edges.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
            return (
              <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select value={e.from} onChange={(ev) => set({ from: ev.target.value })} style={{ ...field, maxWidth: 170 }} aria-label="From">
                  {b.nodes.map((n) => (
                    <option key={n.id} value={n.id}>{label(n.id)}</option>
                  ))}
                </select>
                <input value={e.label} onChange={(ev) => set({ label: ev.target.value })} style={{ ...field, width: 130 }} aria-label="Relationship" />
                <select value={e.to} onChange={(ev) => set({ to: ev.target.value })} style={{ ...field, maxWidth: 170 }} aria-label="To">
                  {b.nodes.map((n) => (
                    <option key={n.id} value={n.id}>{label(n.id)}</option>
                  ))}
                </select>
                <select value={e.basis} onChange={(ev) => set({ basis: ev.target.value as GBasis })} style={field} aria-label="Evidence basis">
                  {BASES.map((x) => (
                    <option key={x} value={x}>{BASIS_LABEL[x]}</option>
                  ))}
                </select>
                <button type="button" style={mini} aria-label="Remove link" onClick={() => onChange((g) => ({ ...g, edges: g.edges.filter((_, j) => j !== i) }))}>×</button>
              </div>
            );
          })}
          <div><button type="button" style={mini} onClick={addEdge}>+ Add link</button></div>
        </div>
      </details>
    </div>
  );
}
