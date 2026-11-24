// tests/redact-values.test.ts
import { describe, expect, it } from "vitest";
import { redactValues } from "../src/core/redact-values";
import { buildContext } from "../src/core/chat-context";
import { redactedProfileJson } from "../src/core/profile-note";
import type { SettingsProfile } from "../src/core/types";

// Ein Geheimnis in einem Feld, dessen NAME nicht geheim klingt (Beschreibung, Notiz, Vorlage): nur das Muster findet es.
const LEAKS = { note: "key_sk-proj-abc123def456ghi789", other: "my_AKIAABCDEFGHIJKLMNOP x_Bearer abcdef0123456789", nested: { list: ["ok", "sk-ant-abcdefghijklmnop"] } };
const SECRETS = ["abc123def456ghi789", "ABCDEFGHIJKLMNOP", "abcdef0123456789", "abcdefghijklmnop"];

describe("redactValues", () => {
  it("schwärzt Muster-Geheimnisse in Feldern mit unverfänglichem Namen und meldet den Pfad", () => {
    const r = redactValues(LEAKS);
    const all = JSON.stringify(r.value);
    for (const s of SECRETS) expect(all).not.toContain(s);
    expect(r.redacted.sort()).toEqual(["nested.list.1", "note", "other"]);
  });

  it("bewahrt Feldnamen-Schwärzung und gewöhnliche Texte", () => {
    const r = redactValues({ apiKey: "geheim", name: "task-abc123def456ghi789", n: 3 });
    expect(r.value).toEqual({ apiKey: "🔒", name: "task-abc123def456ghi789", n: 3 });
    expect(r.redacted).toEqual(["apiKey"]);
  });
});

describe("Wege zum Modell und in die Notiz", () => {
  it("buildContext schickt kein Muster-Geheimnis an das Modell", () => {
    const c = buildContext({ installed: [{ id: "p", name: "P" }], selected: [{ id: "p", text: JSON.stringify(LEAKS) }] });
    for (const s of SECRETS) expect(c.context).not.toContain(s);
    expect(c.redacted).toContain("plugins.p.note");
  });

  it("die Profilnotiz trägt kein Muster-Geheimnis", () => {
    const profile = { version: 1, entries: [{ target: { kind: "plugin", id: "p" }, values: LEAKS }], notes: {} } as unknown as SettingsProfile;
    const r = redactedProfileJson(profile);
    for (const s of SECRETS) expect(r.text).not.toContain(s);
  });
});
