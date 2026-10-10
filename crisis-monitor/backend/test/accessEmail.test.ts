import { describe, it, expect } from "vitest";
import { accessReplyEmail, ACCESS_INBOX } from "../src/lib/accessEmail";

describe("access reply email", () => {
  it("greets by first name, is signed correctly and escapes what was typed", () => {
    const m = accessReplyEmail('<b>Amina</b> "Hassan"');
    expect(m.html).not.toContain("<b>Amina");
    expect(m.text).toContain("Dear <b>Amina</b>,");
    for (const part of ["Simon Mutie", "Managing Director, Afrilens Consulting", "Nairobi, Kenya", "+254 716 770 354", "simon.mutie@afrilensconsulting.com"]) {
      expect(m.html).toContain(part);
      expect(m.text).toContain(part);
    }
    expect(m.text).toContain("as soon as possible");
    expect(m.replyTo).toBe("simon.mutie@afrilensconsulting.com");
    expect(ACCESS_INBOX).toBe("info@afrilensconsulting.com");
  });
});
