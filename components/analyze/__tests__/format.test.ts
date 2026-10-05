import { describe, expect, it } from "vitest";
import { formatLoss, formatPawns, moveLabel, sideOfUser, splitExplanation } from "../format";

describe("splitExplanation", () => {
  it("waits while the header line is still streaming", () => {
    expect(splitExplanation('{"theme": "fo', false)).toEqual({ theme: null, body: "", pending: true });
  });

  it("splits header and prose", () => {
    const r = splitExplanation('{"theme":"fork"}\nThe knight attacks both rooks.', false);
    expect(r.theme).toBe("fork");
    expect(r.body).toBe("The knight attacks both rooks.");
    expect(r.pending).toBe(false);
  });

  it("tolerates code fences and junk around the JSON", () => {
    const r = splitExplanation('```json\nHeader: {"theme": "pin"} ok\n```\nYour bishop was pinned.', true);
    expect(r.theme).toBe("pin");
    expect(r.body).toBe("Your bishop was pinned.");
  });

  it("falls back to plain text when there is no header", () => {
    const r = splitExplanation("You hung the queen.\nBetter was Nf3.", true);
    expect(r.theme).toBeNull();
    expect(r.body).toBe("You hung the queen.\nBetter was Nf3.");
  });

  it("does not wait forever on prose without a newline", () => {
    expect(splitExplanation("You hung", false)).toEqual({ theme: null, body: "You hung", pending: false });
  });

  it("handles a header-only final buffer and broken JSON", () => {
    expect(splitExplanation('{"theme":"fork"}', true)).toEqual({ theme: "fork", body: "", pending: false });
    expect(splitExplanation('{"theme": fork}\nText', true).theme).toBeNull();
  });
});

describe("formatting", () => {
  it("labels moves with annotation by loss", () => {
    expect(moveLabel({ moveNumber: 23, side: "black", san: "Qxb2", cpLoss: 450 })).toBe("23... Qxb2??");
    expect(moveLabel({ moveNumber: 7, side: "white", san: "Nf3", cpLoss: 120 })).toBe("7. Nf3?");
  });

  it("formats pawns and mates", () => {
    expect(formatPawns(1.24)).toBe("+1.2");
    expect(formatPawns(-3)).toBe("−3.0");
    expect(formatPawns(0)).toBe("0.0");
    expect(formatPawns(100)).toBe("#+");
    expect(formatPawns(-100)).toBe("#−");
    expect(formatLoss(345)).toBe("−3.5");
  });

  it("finds the user's side case-insensitively", () => {
    expect(sideOfUser("Hikaru", "hikaru", "x")).toBe("white");
    expect(sideOfUser("x", "hikaru", "X")).toBe("black");
    expect(sideOfUser("nobody", "a", "b")).toBeUndefined();
  });
});
