import { describe, expect, it } from "vitest";
import { isSecretPath, isSecretValue, redact, REDACTED } from "../src/core/secrets";

// Gemessen 2026-10-03 über 75 data.json in Pallas und Arbeit (nur Namen): echte Treffer …
const SECRET_STRINGS = ["apiKey", "apiToken", "apiAuthToken", "mcpToken", "syncToken", "email", "taskboneAPIkey", "secretId"];
// … und harmlose Zahlenfelder, die ein reiner Teilstring-Abgleich trifft (Config Sync tut das).
const HARMLESS_NUMBERS = ["contextWindowTokens", "maxTokens", "llmMaxTokens", "maxOutputTokens", "freezeTokens", "smartApplyMaxTokens", "aiDefaultMaxResponseTokens", "streakFreezeTokensPerMonth"];

describe("secrets", () => {
  it.each(SECRET_STRINGS)("%s with a non-empty string is secret", (name) => {
    expect(isSecretValue(name, "x")).toBe(true);
  });
  it.each(HARMLESS_NUMBERS)("%s with a number is never secret", (name) => {
    expect(isSecretValue(name, 128000)).toBe(false);
  });
  it("booleans, null and empty strings are never secret", () => {
    expect(isSecretValue("migrateProviderApiKeysToSecretStorage", true)).toBe(false);
    expect(isSecretValue("apiKey", null)).toBe(false);
    expect(isSecretValue("apiKey", "")).toBe(false);
  });
  it("objects and lists under a secret name are secret as a whole", () => {
    expect(isSecretValue("hostSecrets", { "git.example": "abc" })).toBe(true);
    expect(isSecretValue("googleCalendarSyncTokens", {})).toBe(true);
    expect(isSecretValue("tokens", ["a"])).toBe(true);
  });
  it("author is not auth", () => {
    expect(isSecretValue("authorUrl", "https://x")).toBe(false);
    expect(isSecretValue("oauthClient", "x")).toBe(true);
  });
  it("isSecretPath: a secret ancestor makes the whole path secret", () => {
    const root = { hostSecrets: { "git.example": "abc" }, llm: { apiKey: "k", model: "m" } };
    expect(isSecretPath(root, ["hostSecrets", "git.example"])).toBe(true);
    expect(isSecretPath(root, ["llm", "apiKey"])).toBe(true);
    expect(isSecretPath(root, ["llm", "model"])).toBe(false);
  });
  it("redact: replaces secrets deep, reports paths, leaves numbers", () => {
    const r = redact({ apiKey: "sk-1", maxTokens: 4096, endpoints: [{ url: "u", secretId: "s" }], hostSecrets: { h: "p" } });
    expect(r.value).toEqual({ apiKey: REDACTED, maxTokens: 4096, endpoints: [{ url: "u", secretId: REDACTED }], hostSecrets: REDACTED });
    expect(r.redacted).toEqual(["apiKey", "endpoints.0.secretId", "hostSecrets"]);
  });
  it("redact does not mutate its input", () => {
    const input = { apiKey: "sk-1" };
    redact(input);
    expect(input.apiKey).toBe("sk-1");
  });
});
