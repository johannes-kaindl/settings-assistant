import { describe, expect, it } from "vitest";
import { isSecretPath, isSecretValue, redact, REDACTED } from "../src/core/secrets";
import type { Json } from "../src/core/types";

// Gemessen 2026-10-03 über 75 data.json in Pallas und Arbeit (nur Namen): echte Treffer …
const SECRET_STRINGS = ["apiKey", "apiToken", "apiAuthToken", "mcpToken", "syncToken", "email", "taskboneAPIkey", "secretId", "password", "dbPassword", "credentials", "sessionCookie", "x-api-key"];
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
  it.each(["authorization", "authorize", "oauth"])("%s with text is secret", (name) => {
    expect(isSecretValue(name, "x")).toBe(true);
  });
  it.each(["author", "authorUrl", "authors"])("%s with text stays free", (name) => {
    expect(isSecretValue(name, "x")).toBe(false);
  });
  it("nested authorization header is secret and redacted", () => {
    expect(isSecretPath({ headers: { authorization: "Bearer x" } }, ["headers", "authorization"])).toBe(true);
    const r = redact({ headers: { authorization: "Bearer x", accept: "json" } });
    expect(r.value).toEqual({ headers: { authorization: REDACTED, accept: "json" } });
    expect(r.redacted).toEqual(["headers.authorization"]);
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

describe("redact with own __proto__ key", () => {
  it("keeps a parsed __proto__ key as data", () => {
    const v = JSON.parse('{"__proto__":{"token":"t"},"a":1}') as Json;
    const r = redact(v);
    expect(Object.keys(r.value as object)).toContain("__proto__");
    expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype);
  });
});
