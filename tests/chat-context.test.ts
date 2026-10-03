// tests/chat-context.test.ts
import { describe, expect, it } from "vitest";
import { buildContext, extractProfileBlocks, suggestPlugins } from "../src/core/chat-context";

const installed = [{ id: "koda-agent", name: "Koda" }, { id: "vault-rag", name: "Vault RAG" }, { id: "x", name: "X" }];

describe("chat-context", () => {
  it("suggests plugins by name or id, case-insensitive, ignoring very short names", () => {
    expect(suggestPlugins("Koda soll mit kleinerem Kontext arbeiten", installed)).toEqual(["koda-agent"]);
    expect(suggestPlugins("vault rag reindex", installed)).toEqual(["vault-rag"]);
    expect(suggestPlugins("x marks the spot", installed)).toEqual([]);
  });
  it("never sends secrets and reports what was redacted", () => {
    const c = buildContext({ installed, selected: [{ id: "koda-agent", text: '{"apiKey":"sk-123","maxRounds":50}' }] });
    expect(c.context).not.toContain("sk-123");
    expect(c.context).toContain('"maxRounds": 50');
    expect(c.context).toContain("🔒");
    expect(c.redacted).toEqual(["plugins.koda-agent.apiKey"]);
  });
  it("lists every installed plugin and marks unreadable files", () => {
    const c = buildContext({ installed, selected: [{ id: "vault-rag", text: "{oops" }] });
    expect(c.context).toContain("- koda-agent: Koda");
    expect(c.unreadable).toEqual(["vault-rag"]);
  });
  it("extracts settings-profile blocks, tolerating text around and several blocks", () => {
    const F = "`".repeat(3); // kein wörtlicher Zaun im Quelltext — er würde den Markdown-Codeblock dieses Plans beenden
    const answer = `Sure.\n${F}settings-profile\n{"version":1,"plugins":{"koda-agent":{"maxRounds":20}}}\n${F}\nAnd:\n${F}settings-profile\n{bad\n${F}`;
    const blocks = extractProfileBlocks(answer);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.result.ok).toBe(true);
    expect(blocks[1]!.result.ok).toBe(false);
  });
  it("no block → empty list", () => {
    expect(extractProfileBlocks("Nothing to change.")).toEqual([]);
  });
});
