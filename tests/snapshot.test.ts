import { describe, expect, it } from "vitest";
import { hashText, restoreDecision, snapshotDirName } from "../src/core/snapshot";

describe("snapshot", () => {
  it("hashText is stable and length-prefixed", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc").startsWith("3-")).toBe(true);
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });
  it("snapshotDirName is filesystem-safe and sortable", () => {
    expect(snapshotDirName("2026-10-03T14:05:12.345Z")).toBe("2026-10-03T14-05-12");
  });
  it("restore when the file still holds what we wrote", () => {
    expect(restoreDecision({ path: "p", existed: true, afterHash: hashText("new") }, "new")).toBe("restore");
  });
  it("changed when someone edited it since", () => {
    expect(restoreDecision({ path: "p", existed: true, afterHash: hashText("new") }, "edited")).toBe("changed");
  });
  it("unverified when the run never finished its manifest", () => {
    expect(restoreDecision({ path: "p", existed: true, afterHash: null }, "x")).toBe("unverified");
  });
  it("a file we created and that is gone again needs nothing", () => {
    expect(restoreDecision({ path: "p", existed: false, afterHash: hashText("x") }, null)).toBe("restore");
  });
  it("a file that existed before and is gone now counts as changed", () => {
    expect(restoreDecision({ path: "p", existed: true, afterHash: hashText("x") }, null)).toBe("changed");
  });
});
