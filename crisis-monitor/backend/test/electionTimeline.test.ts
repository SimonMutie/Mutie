import { describe, it, expect } from "vitest";
import { detectElectionEvent } from "../src/lib/electionTimeline";

describe("election and transition headlines", () => {
  it("proposes Kenyan nominations and IEBC notices", () => {
    expect(detectElectionEvent("IEBC publishes timetable for Kenya's 2027 nominations")).toEqual({ countryCode: "KE", kind: "electoral_body" });
    expect(detectElectionEvent("Kenya opposition leader declares his candidacy for president")).toEqual({ countryCode: "KE", kind: "nomination" });
  });
  it("proposes South Sudan transition and resignation events", () => {
    expect(detectElectionEvent("South Sudan minister resigns amid election row")).toEqual({ countryCode: "SS", kind: "resignation" });
  });
  it("ignores headlines outside the two countries or without an event", () => {
    expect(detectElectionEvent("Nigeria election campaign enters final week")).toBeNull();
    expect(detectElectionEvent("Kenya's economy grows in third quarter")).toBeNull();
  });
});
