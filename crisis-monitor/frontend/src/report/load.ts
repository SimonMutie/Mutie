import { api, type DdCase } from "../api";
import type { Report } from "./model";
import { buildReport } from "./template";

/** The case's saved report with the analyst's edits, or a fresh one built from the screening. */
export async function reportFor(c: DdCase): Promise<Report> {
  try {
    const saved = await api.getDdReport(c.id);
    if (saved.report) return saved.report;
  } catch {
    /* fall through to a fresh build */
  }
  return buildReport(c);
}
