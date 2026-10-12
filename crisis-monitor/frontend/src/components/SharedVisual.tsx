import { useEffect, useState } from "react";
import { visualsApi } from "../api";

/** A single published visual, opened by its link (/visual/<token>). Nothing else from the app is shown. */
export default function SharedVisual({ token }: { token: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof visualsApi.get>> | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    visualsApi
      .get(token)
      .then((d) => alive && setData(d))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <main style={{ minHeight: "100vh", background: "#f4f6fa", color: "#0f172a", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {missing && <p>This link is not active.</p>}
        {!missing && !data && <p>Loading…</p>}
        {data && (
          <>
            {data.kicker && <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#0f766e" }}>{data.kicker}</p>}
            <h1 style={{ margin: "6px 0 4px", fontSize: 24 }}>{data.title}</h1>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>Afrilens Consulting · shared {new Date(data.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
            {data.kind === "gif" ? (
              <img src={data.content} alt={data.title} style={{ display: "block", width: "100%", height: "auto", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }} />
            ) : (
              // Scripts are blocked (sandbox with no permissions), so only the visual's own motion runs.
              <div style={{ overflowX: "auto", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <iframe
                  title={data.title}
                  srcDoc={data.content}
                  sandbox=""
                  style={{ display: "block", border: 0, width: data.width, maxWidth: "none", height: Math.max(300, data.height) }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
