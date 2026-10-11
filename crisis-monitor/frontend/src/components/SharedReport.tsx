import { useEffect, useState } from "react";
import { publicReportApi, type SharedReportPayload } from "../api";
import MonthlyReport from "./MonthlyReport";
import "./Election.css";

/**
 * A monthly report opened from a share link. No sign-in: the report is read-only
 * and shows only what was published, with the same animated pages as the
 * platform. Downloads and live figures are not offered on a shared link.
 */
export default function SharedReport({ token }: { token: string }) {
  const [data, setData] = useState<SharedReportPayload | null | undefined>(undefined);
  useEffect(() => {
    publicReportApi.get(token).then(setData).catch(() => setData(null));
  }, [token]);
  if (data === undefined) return <p className="el-wrap" style={{ padding: "48px 16px", color: "var(--text-muted)" }}>Loading the report…</p>;
  if (data === null)
    return (
      <div className="el-wrap" style={{ padding: "48px 16px" }}>
        <h1 style={{ fontSize: 22 }}>This link is not active</h1>
        <p style={{ color: "var(--text-muted)" }}>The report may have been withdrawn or the link revoked. Ask your Afrilens contact for a current link.</p>
      </div>
    );
  return (
    <div className="el-page">
      <main className="el-wrap">
        <MonthlyReport country={data.country} isAdmin={false} share={{ token, data }} />
      </main>
    </div>
  );
}
