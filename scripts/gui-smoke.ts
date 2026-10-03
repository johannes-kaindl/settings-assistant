/**
 * GUI-Smoke — faehrt die Pruefpunkte P1-P15 gegen ein LAUFENDES Obsidian (CORE-TEST-02 b).
 *
 * Gemessen wird die SACHE: Dateiinhalt auf Platte (`sa-probe/data.json`, `hotkeys.json`, Schnappschuss-
 * Manifest), Dialogtext, Notice — nicht die Existenz eines Elements. Das Testplugin `sa-probe`
 * (`fixtures/plugins/sa-probe/`) hat zwei Eigenheiten, an denen der Schreibweg haengt: es korrigiert
 * `clamp > 100` beim Laden und speichert beim Abschalten, wenn `saveOnUnload` gesetzt ist.
 *
 * Bilanz in vier Zustaenden (CORE-TEST-19): gruen · rot · uebersprungen · nichts gemessen. Nenner sind
 * ALLE Pruefpunkte des Treibers (`PUNKTE`); ein Punkt, der nie aufgezeichnet wurde, zaehlt als
 * „nichts gemessen" — nie als gruen.
 *
 * ## Lauf (Zweitinstanz, eigenes Profil, eigener Port; der Treiber startet und beendet sie selbst)
 *
 *   echo "$STAGING_VAULTS_DIR"                                      # muss gesetzt sein (~/.zshenv)
 *   npm run build
 *   lsof -nP -iTCP:9361 -sTCP:LISTEN                                # Port frei?
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label settings-assistant --intent "GUI-Smoke :9361" --exclusive focus --port 9361 --ttl 300
 *   npm run smoke:gui -- --launch --port 9361
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 *
 * `--launch` baut den Vault aus `fixtures/vault/` (VOR jedem Lauf, Zustand aus Abbruechen darf nicht
 * ueberleben), deployt den Repo-Build und `sa-probe`, kopiert die aktuelle `.asar` der regulaeren
 * Instanz ins Profil, startet einen FRISCHEN Prozess, bestaetigt den Vertrauensdialog, schaltet den
 * Restricted Mode ab, misst und beendet NUR den eigenen Prozess ueber seine PID. Das Profil ist
 * `/tmp/obs-test-settings-assistant`; haelt dort eine fremde Instanz das Profil, weicht der Treiber auf
 * `<profil>-w1` aus (nie beenden). Ohne `--launch` haengt sich der Treiber an eine bereits laufende
 * Instanz auf `--port` (Vault muss dann schon gebaut und geoeffnet sein: `--setup`).
 *
 * Der erste Lauf nach Profilanlage ist ein Aufwaermlauf und zaehlt nicht. Die regulaere Instanz auf 9222
 * wird nicht angefasst. Gemessen wird im eigenen Staging-Vault (`stagingVaultDir()`), nie im
 * Arbeits-Vault; der Ort steht in obsidian-plugins/AGENTS.md § Staging-Vaults.
 *
 * Typen: `tsconfig.scripts.json` (im `gate` ueber `npm run typecheck:scripts`).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd } from "node:process";

import { Cdp, attachTo, clearNotices, closeExtraLeaves, notices, openExisting, pollUntil, reopenNote, requireVisible } from "../../tools/obsidian-cdp/cdp.js";
import { buildVault, requireEigenerBuild, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "settings-assistant";
const PLUGIN_ID = "settings-assistant";
const PROBE_ID = "sa-probe";
const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "fixtures/vault");
const PROBE_FIXTURE = join(REPO_ROOT, "fixtures/plugins", PROBE_ID);
const DEFAULT_PORT = 9361;
const PROFILE_BASE = "/tmp/obs-test-settings-assistant";
const OBSIDIAN_BIN = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const FAKE_MODEL = "smoke-model";
const FAKE_ENDPOINT_KEY = "sk-FAKE-SMOKE";
const PROBE_API_KEY = "sk-FAKE-PROBE";
const PROBE_DATA = "/plugins/sa-probe/data.json";
const SNAP_ROOT = "/plugins/settings-assistant/snapshots";

// ---------------------------------------------------------------------------------------------
// Bilanz: vier Zustaende, Nenner = alle Punkte
// ---------------------------------------------------------------------------------------------

const PUNKTE = [
  "P1 Codeblock rendert die Pruefzeile mit Ist- und Soll-Wert",
  "P2 Anwenden: Dialog nennt den Neustart, data.json geschrieben, Plugin neu geladen",
  "P3 Vom Plugin korrigierter Wert wird als korrigiert gemeldet",
  "P4 Zwischenzeitlich geaenderte Datei wird nicht ueberschrieben",
  "P5 Schluessel apiKey: Zeile „secret“ ohne Wert, Knopf „Open settings“",
  "P6 Abschnitt des eigenen Plugins ist nur lesbar",
  "P7 Schnappschuss zurueckholen: Stand davor, geaenderte Datei nicht angehakt",
  "P8 Chat: Antwort mit Block, Anwenden mit chat:-Herkunft, Sent context ohne Schluessel",
  "P9 Hotkeys: Belegung wirkt (hotkeys.json und hotkeyManager)",
  "P10 API: planProfile liefert Zeilen, applyProfile oeffnet den eigenen Dialog",
  "P11 Schluessel authorization: Zeile „secret“ ohne Wert",
  "P12 Chat-Antwort mit Markdown-Bild erzeugt kein img und keinen Request",
  "P13 Hilfe-Zeile ist die erste Zeile, Schnappschuss-Liste zeigt genau einen Eintrag",
  "P14 Befehl „Undo last apply“ stellt den Stand davor wieder her",
  "P15 Schluesselbund: Klartext-Schluessel der lokalen Endpunkt-Liste wandert aus der data.json, Header bleibt, Zeile zeigt „saved“",
] as const;
type PunktName = (typeof PUNKTE)[number];
const pn = (prefix: string): PunktName => {
  const hit = PUNKTE.find((p) => p.startsWith(`${prefix} `));
  if (!hit) throw new Error(`Unbekannter Punkt ${prefix}`);
  return hit;
};

type Zustand = "gruen" | "rot" | "uebersprungen" | "nichts-gemessen";
interface Check { name: string; zustand: Zustand; detail: string }
const checks = new Map<string, Check>();
function put(name: string, zustand: Zustand, detail: string, marker: string): void {
  if (checks.has(name)) return; // der erste Eintrag zaehlt (ein Aufraeumfehler danach aendert nichts)
  checks.set(name, { name, zustand, detail });
  console.log(`  ${marker} ${name} — ${detail}`);
}
const record = (name: PunktName, passed: boolean, detail: string): void => { put(name, passed ? "gruen" : "rot", detail, passed ? "✓" : "✗"); };
const skipped = (name: PunktName, reason: string): void => { put(name, "uebersprungen", `uebersprungen: ${reason}`, "·"); };
const unmeasured = (name: PunktName, reason: string): void => { put(name, "nichts-gemessen", `NICHTS GEMESSEN: ${reason}`, "?"); };

/** Der Gegenstand des Punkts wurde nicht erreicht (Vorbedingung fehlt) — „nichts gemessen", nicht rot. */
class Vorbedingung extends Error {}

async function punkt(name: PunktName, fn: () => Promise<void>): Promise<void> {
  console.log(`\n${name}`);
  try { await fn(); } catch (e) {
    unmeasured(name, e instanceof Vorbedingung ? e.message : `Abbruch im Treiber: ${(e as Error).message}`);
  }
  if (!checks.has(name)) unmeasured(name, "der Punkt hat nichts aufgezeichnet");
}

const q = (s: string): string => JSON.stringify(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Fake-LLM-Endpunkt (lokal; streamt eine feste Antwort mit settings-profile-Block und Markdown-Bild)
// ---------------------------------------------------------------------------------------------

const CHAT_PROFILE = { version: 1, plugins: { [PROBE_ID]: { maxRounds: 33 } }, notes: { [`plugins.${PROBE_ID}.maxRounds`]: "Fewer rounds are faster." } };
const CHAT_ANSWER = [
  "Sure, lowering the round limit.",
  "",
  "![x](https://example.invalid/leak.png?q=abc)",
  "",
  "```settings-profile",
  JSON.stringify(CHAT_PROFILE),
  "```",
].join("\n");

interface FakeEndpoint { url: string; close: () => Promise<void>; bodies: string[]; auth: string[] }
async function startFakeEndpoint(): Promise<FakeEndpoint> {
  const bodies: string[] = [];
  const auth: string[] = [];
  const server: Server = createServer((req, res) => {
    // Der Renderer laeuft unter app://obsidian.md — ohne CORS-Header sieht der Server nie eine Anfrage.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.url?.includes("/v1/models") === true) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: FAKE_MODEL, object: "model" }] }));
      return;
    }
    if (req.method === "POST" && req.url?.includes("/v1/chat/completions") === true) {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
      req.on("end", () => {
        bodies.push(body);
        auth.push(String(req.headers.authorization ?? ""));
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const half = Math.floor(CHAT_ANSWER.length / 2);
        for (const part of [CHAT_ANSWER.slice(0, half), CHAT_ANSWER.slice(half)]) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part }, finish_reason: null }], model: FAKE_MODEL })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], model: FAKE_MODEL })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, bodies, auth, close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }) };
}

// ---------------------------------------------------------------------------------------------
// Vault bauen, Instanz starten
// ---------------------------------------------------------------------------------------------

function setupVault(): string {
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: FIXTURE_DIR, pluginId: PLUGIN_ID });
  console.log(`Staging-Vault gebaut: ${vaultDir}`);
  for (const l of log) console.log(`  · ${l}`);
  // `buildVault` raeumt nur data.json. Schnappschuesse und Test-Plugin ueberleben sonst jeden Abbruch:
  // P13 zaehlt „genau einen Eintrag", und sa-probe traegt seinen Zustand in data.json.
  rmSync(join(vaultDir, ".obsidian/plugins", PLUGIN_ID, "snapshots"), { recursive: true, force: true });
  const probeDir = join(vaultDir, ".obsidian/plugins", PROBE_ID);
  rmSync(probeDir, { recursive: true, force: true });
  mkdirSync(probeDir, { recursive: true });
  for (const f of ["manifest.json", "main.js"]) copyFileSync(join(PROBE_FIXTURE, f), join(probeDir, f));
  writeFileSync(join(probeDir, "data.json"), JSON.stringify({ maxRounds: 50, clamp: 10, saveOnUnload: false, apiKey: PROBE_API_KEY }, null, 2));
  console.log(`  · ${PROBE_ID} nach .obsidian/plugins/${PROBE_ID}/ deployt`);
  return vaultDir;
}

function pgrepProfile(ud: string): string {
  try { return execFileSync("pgrep", ["-f", `user-data-dir=${ud}`], { encoding: "utf8" }).trim(); } catch { return ""; }
}
function portHalten(port: number): boolean {
  try { return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== ""; } catch { return false; }
}

function neuesteAsar(): string | null {
  const dir = join(homedir(), "Library/Application Support/obsidian");
  const dateien = readdirSync(dir).filter((f) => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(f));
  dateien.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const letzte = dateien[dateien.length - 1];
  return letzte ? join(dir, letzte) : null;
}

interface Instanz { child: ChildProcess; ud: string }
function startInstanz(vaultDir: string, port: number): Instanz {
  if (portHalten(port)) throw new Error(`Port ${port} ist belegt — anderen waehlen (nichts beendet).`);
  let ud = PROFILE_BASE;
  if (pgrepProfile(ud) !== "") ud = `${PROFILE_BASE}-w1`;
  if (pgrepProfile(ud) !== "") throw new Error(`Auch ${ud} wird von einer fremden Instanz gehalten — Abbruch (nichts beendet).`);
  mkdirSync(ud, { recursive: true });
  // Obsidian liest obsidian.json nur beim Start; ein alter Eintrag wuerde einen fremden Vault oeffnen.
  writeFileSync(join(ud, "obsidian.json"), JSON.stringify({ vaults: { [REPO_NAME]: { path: vaultDir, ts: Date.now(), open: true } }, language: "en" }));
  // Die gebuendelte Version kann unter der minAppVersion liegen — dann laedt ein Plugin still nicht.
  for (const f of readdirSync(ud)) if (/^obsidian-.*\.asar$/.test(f)) rmSync(join(ud, f));
  const asar = neuesteAsar();
  if (asar) copyFileSync(asar, join(ud, asar.split("/").pop() ?? "obsidian.asar"));
  else console.warn("WARNUNG: keine obsidian-*.asar im regulaeren Profil — es laeuft die gebuendelte Version.");
  const child = spawn(OBSIDIAN_BIN, [`--user-data-dir=${ud}`, `--remote-debugging-port=${port}`, "-AppleLanguages", "(en)"], { stdio: "ignore" });
  console.log(`Zweitinstanz gestartet: PID ${child.pid ?? "?"}, Profil ${ud}, Port ${port}, ${asar ? asar.split("/").pop() : "gebuendelt"}`);
  return { child, ud };
}

async function stopInstanz(inst: Instanz): Promise<void> {
  const exited = new Promise<void>((resolve) => { inst.child.once("exit", () => { resolve(); }); });
  if (inst.child.exitCode === null) inst.child.kill("SIGTERM");
  await Promise.race([exited, sleep(8000)]);
  if (inst.child.exitCode === null && inst.child.signalCode === null) { inst.child.kill("SIGKILL"); await Promise.race([exited, sleep(4000)]); }
  await sleep(500);
  const rest = pgrepProfile(inst.ud);
  console.log(`Zweitinstanz beendet (PID ${inst.child.pid ?? "?"}); verbleibende Prozesse im Profil: ${rest === "" ? "keine" : rest.replace(/\n/g, ",")}`);
}

async function warteAufFenster(port: number, timeoutMs: number): Promise<Cdp> {
  const bis = Date.now() + timeoutMs;
  let letzter = "";
  while (Date.now() < bis) {
    try {
      const cdp = await attachTo("workspace", port, REPO_NAME);
      if (cdp) return cdp;
    } catch (e) { letzter = (e as Error).message; }
    await sleep(1000);
  }
  throw new Error(`Kein Obsidian-Fenster fuer Vault "${REPO_NAME}" auf Port ${port} nach ${Math.round(timeoutMs / 1000)} s. ${letzter}`);
}

/** Vertrauensdialog (frisches Profil), Restricted Mode, beide Plugins laden, Pop-outs schliessen. */
async function bereiteVor(cdp: Cdp): Promise<string> {
  const log: string[] = [];
  const vertraut = await pollUntil<{ ok: boolean }>(cdp, `
    const btn = Array.from(document.querySelectorAll(".modal-container button")).find((b) => /trust|vertrau/i.test(b.textContent || ""));
    if (btn) { btn.click(); return { ok: true }; }
    return document.querySelector(".workspace") && app.plugins && app.plugins.manifests && app.plugins.manifests[${q(PLUGIN_ID)}] && !document.querySelector(".modal-container") ? { ok: false } : null;
  `, 20_000, 500);
  log.push(vertraut?.ok === true ? "Vertrauensdialog bestaetigt" : "kein Vertrauensdialog");
  await sleep(800);
  const r = await cdp.evaluate<{ s: string }>(`
    try {
      if (app.plugins.setEnable) await app.plugins.setEnable(true);
      for (const id of [${q(PROBE_ID)}, ${q(PLUGIN_ID)}]) {
        if (!app.plugins.plugins[id]) await app.plugins.enablePluginAndSave(id);
      }
      await new Promise((r) => setTimeout(r, 1500));
      return { s: [${q(PROBE_ID)}, ${q(PLUGIN_ID)}].map((id) => id + ":" + (app.plugins.plugins[id] ? "geladen" : "FEHLT")).join(" ") };
    } catch (e) { return { s: "Fehler: " + (e && e.message ? e.message : String(e)) }; }
  `);
  log.push(r.s);
  return log.join("; ");
}

// ---------------------------------------------------------------------------------------------
// Renderer-Helfer
// ---------------------------------------------------------------------------------------------

/** sa-probe-Zustand setzen: ausschalten → data.json schreiben → einschalten (onunload darf den Stand nicht ueberschreiben). */
async function resetProbe(cdp: Cdp, over: Record<string, unknown> = {}): Promise<void> {
  const data = { maxRounds: 50, clamp: 10, saveOnUnload: false, apiKey: PROBE_API_KEY, ...over };
  const r = await cdp.evaluate<{ ok: boolean; stand: string }>(`
    const id = ${q(PROBE_ID)};
    const path = app.vault.configDir + ${q(PROBE_DATA)};
    if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
    await app.vault.adapter.write(path, ${q(JSON.stringify(data, null, 2))});
    await app.plugins.enablePlugin(id);
    await new Promise((r) => setTimeout(r, 400));
    const p = app.plugins.plugins[id];
    return { ok: !!p, stand: p ? JSON.stringify(p.settings) : "" };
  `);
  if (!r.ok) throw new Vorbedingung(`sa-probe laesst sich nicht neu laden (Stand ${r.stand})`);
}

async function leseProbe(cdp: Cdp): Promise<Record<string, unknown> | null> {
  const r = await cdp.evaluate<{ t: string | null }>(`
    const path = app.vault.configDir + ${q(PROBE_DATA)};
    return { t: (await app.vault.adapter.exists(path)) ? await app.vault.adapter.read(path) : null };
  `);
  return r.t === null ? null : (JSON.parse(r.t) as Record<string, unknown>);
}
async function leseProbeText(cdp: Cdp): Promise<string> {
  return (await cdp.evaluate<{ t: string }>(`return { t: await app.vault.adapter.read(app.vault.configDir + ${q(PROBE_DATA)}) };`)).t;
}

async function schliesseDialoge(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    for (const b of document.querySelectorAll(".modal-container .modal-close-button")) b.click();
    await new Promise((r) => setTimeout(r, 200));
    for (const n of document.querySelectorAll(".notice")) n.remove();
    return { ok: true };
  `).catch(() => undefined);
}

/** Eine Notiz im Lesemodus oeffnen und auf den gerenderten Profil-Block warten. */
async function oeffneNotiz(cdp: Cdp, name: string): Promise<void> {
  const ok = await openExisting(cdp, `${name}.md`, "preview");
  if (!ok) throw new Vorbedingung(`Notiz ${name}.md fehlt im Vault`);
  // Dieselbe Notiz im selben Blatt rendert den Block NICHT neu: ein Block aus einem frueheren Punkt zeigt sonst
  // den Ist-Stand von damals (gemessen: „already set“ nach P2, Anwenden gesperrt). Darum schliessen und neu oeffnen.
  await reopenNote(cdp, `${name}.md`, "preview");
  const da = await pollUntil<{ ok: boolean }>(cdp, `
    const leaf = document.querySelector(".workspace-leaf.mod-active .markdown-reading-view");
    return leaf && leaf.querySelector(".sa-profile .sa-rows, .sa-profile .sa-empty, .sa-profile-error") ? { ok: true } : null;
  `, 10_000, 250);
  if (!da) throw new Vorbedingung(`Profil-Block in ${name}.md wurde nicht gerendert (kein .sa-profile)`);
}

interface Zeile { cls: string; path: string; status: string; values: string | null; note: string | null; openBtn: string | null }
async function leseZeilen(cdp: Cdp, root = `document.querySelector(".workspace-leaf.mod-active .markdown-reading-view")`): Promise<{ rows: Zeile[]; text: string; applyText: string | null; applyDisabled: boolean | null }> {
  return cdp.evaluate(`
    const root = ${root};
    if (!root) return { rows: [], text: "", applyText: null, applyDisabled: null };
    const rows = Array.from(root.querySelectorAll(".sa-row")).map((r) => ({
      cls: r.className,
      path: r.querySelector(".sa-row-path")?.textContent?.trim() ?? "",
      status: r.querySelector(".sa-row-status")?.textContent?.trim() ?? "",
      values: r.querySelector(".sa-row-values")?.textContent?.trim() ?? null,
      note: r.querySelector(".sa-row-note")?.textContent?.trim() ?? null,
      openBtn: r.querySelector(".sa-row-open")?.textContent?.trim() ?? null,
    }));
    const btn = root.querySelector(".sa-apply");
    return { rows, text: root.querySelector(".sa-profile")?.textContent ?? "", applyText: btn ? btn.textContent.trim() : null, applyDisabled: btn ? btn.disabled : null };
  `);
}

interface DialogInfo { title: string; text: string; reload: string | null; ctaText: string | null; ctaDisabled: boolean | null; boxes: Array<{ aria: string; checked: boolean }>; desc: string[] }
async function warteAufDialog(cdps: Cdp[], timeoutMs = 8000): Promise<{ cdp: Cdp; info: DialogInfo } | null> {
  const bis = Date.now() + timeoutMs;
  while (Date.now() < bis) {
    for (const cdp of cdps) {
      const info = await cdp.evaluate<DialogInfo | null>(`
        const m = document.querySelector(".modal-container .modal");
        if (!m) return null;
        const cta = m.querySelector(".modal-button-container button.mod-cta");
        return {
          title: m.querySelector(".modal-title")?.textContent?.trim() ?? "",
          text: m.textContent ?? "",
          reload: m.querySelector(".sa-group-reload")?.textContent?.trim() ?? null,
          ctaText: cta ? cta.textContent.trim() : null,
          ctaDisabled: cta ? cta.disabled : null,
          // Der native Toggle (Zurueckholen-Dialog) setzt is-enabled am Container, nicht immer checked am Input.
          boxes: Array.from(m.querySelectorAll("input[type=checkbox]")).map((b) => ({ aria: b.getAttribute("aria-label") ?? "", checked: b.checked || !!b.closest(".checkbox-container.is-enabled") })),
          desc: Array.from(m.querySelectorAll(".setting-item-description")).map((d) => d.textContent.trim()),
        };
      `).catch(() => null);
      if (info) return { cdp, info };
    }
    await sleep(200);
  }
  return null;
}
async function dialogKlick(cdp: Cdp, was: "cta" | "cancel" | "tick"): Promise<void> {
  await cdp.evaluate(`
    const m = document.querySelector(".modal-container .modal");
    if (!m) return { ok: false };
    if (${q(was)} === "tick") { for (const b of m.querySelectorAll("input[type=checkbox]")) { if (!b.checked) b.click(); } }
    else {
      const btns = Array.from(m.querySelectorAll(".modal-button-container button"));
      const b = ${q(was)} === "cta" ? btns.find((x) => x.classList.contains("mod-cta")) : btns.find((x) => !x.classList.contains("mod-cta"));
      if (b) b.click();
    }
    return { ok: true };
  `);
}
async function dialogWeg(cdp: Cdp, timeoutMs = 5000): Promise<boolean> {
  return (await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".modal-container .modal") ? null : { ok: true };`, timeoutMs, 200)) !== null;
}

/** Wartet, bis die Notice den Text traegt; liefert alle Notices (sie verschwinden nach wenigen Sekunden). */
async function warteAufNotice(cdp: Cdp, teil: string, timeoutMs = 8000): Promise<string | null> {
  const bis = Date.now() + timeoutMs;
  while (Date.now() < bis) {
    const n = await notices(cdp).catch(() => "");
    if (n.includes(teil)) return n;
    await sleep(150);
  }
  return null;
}

async function klickeAnwenden(cdp: Cdp, selector = `.workspace-leaf.mod-active .markdown-reading-view .sa-apply`): Promise<void> {
  const ok = await cdp.evaluate<{ ok: boolean }>(`const b = document.querySelector(${q(selector)}); if (!b || b.disabled) return { ok: false }; b.click(); return { ok: true };`);
  if (!ok.ok) throw new Vorbedingung(`Anwenden-Knopf (${selector}) fehlt oder ist gesperrt`);
}

async function neuesterSchnappschuss(cdp: Cdp): Promise<{ dir: string; origin: string; files: string[] } | null> {
  return cdp.evaluate(`
    const root = app.vault.configDir + ${q(SNAP_ROOT)};
    if (!(await app.vault.adapter.exists(root))) return null;
    const l = await app.vault.adapter.list(root);
    const all = [];
    for (const f of l.folders) {
      try { const m = JSON.parse(await app.vault.adapter.read(f + "/manifest.json")); all.push({ dir: f.slice(root.length + 1), at: m.at, origin: m.origin, files: m.files.map((x) => x.path) }); } catch (e) {}
    }
    all.sort((a, b) => (a.at < b.at ? 1 : -1));
    return all[0] ?? null;
  `);
}
async function zaehleSchnappschuesse(cdp: Cdp): Promise<number> {
  return (await cdp.evaluate<{ n: number }>(`
    const root = app.vault.configDir + ${q(SNAP_ROOT)};
    if (!(await app.vault.adapter.exists(root))) return { n: 0 };
    return { n: (await app.vault.adapter.list(root)).folders.length };
  `)).n;
}

// --- Einstellungen: Modal (< 1.13) oder eigenes Fenster (>= 1.13) -------------------------------

interface SettingsStelle { cdp: Cdp; eigenesFenster: boolean }
async function warteAufGeschlosseneSettings(port: number, timeoutMs = 3000): Promise<void> {
  const bis = Date.now() + timeoutMs;
  for (;;) {
    try {
      const liste = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())) as Array<{ type: string; url: string; title: string }>;
      if (!liste.some((t) => t.type === "page" && t.url === "about:blank" && t.title.includes(REPO_NAME))) return;
    } catch { return; }
    if (Date.now() > bis) return;
    await sleep(200);
  }
}
async function openSettings(cdp: Cdp, port: number): Promise<SettingsStelle> {
  await cdp.evaluate(`app.setting.close(); return { ok: true };`).catch(() => undefined);
  await warteAufGeschlosseneSettings(port);
  await cdp.evaluate(`
    app.setting.open();
    await new Promise((r) => setTimeout(r, 500));
    app.setting.openTabById(${q(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 1000));
    return { ok: true };
  `);
  const alsModal = await cdp.evaluate<boolean>(`return Boolean(document.querySelector(".modal.mod-settings"));`);
  let stelle: SettingsStelle;
  if (alsModal) stelle = { cdp, eigenesFenster: false };
  else {
    const fenster = await attachTo("settings", port, REPO_NAME);
    if (!fenster) throw new Vorbedingung("Kein Einstellungen-Fenster/Modal gefunden");
    stelle = { cdp: fenster, eigenesFenster: true };
    await requireVisible(fenster).catch(() => undefined);
  }
  await pollUntil<{ ok: boolean }>(stelle.cdp, `return document.body.textContent && document.body.textContent.includes("Settings Assistant") ? { ok: true } : null;`, 6000, 200);
  return stelle;
}
function closeSettings(cdp: Cdp, stelle: SettingsStelle | null): void {
  if (!stelle) return;
  if (stelle.eigenesFenster) stelle.cdp.close();
  void cdp.evaluate(`app.setting.close(); return { ok: true };`).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------
// Pruefpunkte
// ---------------------------------------------------------------------------------------------

interface Ctx { cdp: Cdp; port: number; fake: FakeEndpoint }

async function pruefeGrundlage(c: Ctx): Promise<boolean> {
  const g = await c.cdp.evaluate<{ sa: boolean; probe: boolean; ver: string }>(`
    return { sa: Boolean(app.plugins.plugins[${q(PLUGIN_ID)}]), probe: Boolean(app.plugins.plugins[${q(PROBE_ID)}]), ver: (typeof require === "function" ? (require("electron").remote?.app?.getVersion?.() ?? "") : "") + " / lang=" + (window.moment ? window.moment.locale() : "?") };
  `);
  console.log(`Grundlage: settings-assistant ${g.sa ? "geladen" : "FEHLT"}, sa-probe ${g.probe ? "geladen" : "FEHLT"} (${g.ver})`);
  return g.sa && g.probe;
}

async function p1(c: Ctx): Promise<void> {
  await resetProbe(c.cdp);
  await oeffneNotiz(c.cdp, "Profile demo");
  const z = await leseZeilen(c.cdp);
  const r = z.rows[0];
  const ok = z.rows.length === 1 && r !== undefined && r.path === "maxRounds" && r.cls.includes("is-change") && r.values === "50 → 20" && r.status === "will change" && (r.note ?? "").includes("Fewer rounds finish faster.");
  record(pn("P1"), ok, r ? `${z.rows.length} Zeile(n): ${r.path} · ${r.status} · ${r.values} · ${r.note} · Knopf „${z.applyText}“` : "keine Zeile");
}

async function p2(c: Ctx): Promise<void> {
  await resetProbe(c.cdp);
  await oeffneNotiz(c.cdp, "Profile demo");
  await c.cdp.evaluate(`window.__saProbeVorher = app.plugins.plugins[${q(PROBE_ID)}]; return { ok: true };`);
  const vorherText = await leseProbeText(c.cdp);
  await clearNotices(c.cdp);
  await klickeAnwenden(c.cdp);
  const dlg = await warteAufDialog([c.cdp]);
  if (!dlg) { record(pn("P2"), false, "der Anwenden-Dialog oeffnet sich nicht"); return; }
  const dialogOk = dlg.info.title === "Apply settings" && dlg.info.reload === "sa-probe will be reloaded — open views close." && dlg.info.ctaText === "Apply 1 change";
  await dialogKlick(c.cdp, "cta");
  const n = await warteAufNotice(c.cdp, "Settings applied");
  const daten = await leseProbe(c.cdp);
  const nach = await c.cdp.evaluate<{ neu: boolean; geladen: boolean; rounds: unknown }>(`
    const p = app.plugins.plugins[${q(PROBE_ID)}];
    return { neu: !!p && p !== window.__saProbeVorher, geladen: !!p, rounds: p ? p.settings.maxRounds : null };
  `);
  const geschrieben = daten?.maxRounds === 20 && daten.clamp === 10 && daten.apiKey === PROBE_API_KEY && daten.saveOnUnload === false;
  const snap = await neuesterSchnappschuss(c.cdp);
  record(pn("P2"), dialogOk && geschrieben && nach.neu && nach.rounds === 20 && n !== null && n.includes("written"),
    `Dialog „${dlg.info.title}“ / „${dlg.info.reload}“ / „${dlg.info.ctaText}“ · data.json maxRounds=${String(daten?.maxRounds)} (Rest erhalten: ${String(daten?.clamp === 10 && daten.apiKey === PROBE_API_KEY)}) · neue Instanz ${String(nach.neu)}, im Speicher ${String(nach.rounds)} · Notice ${n === null ? "FEHLT" : `„${n.split("\n").slice(0, 2).join(" | ")}“`} · Schnappschuss ${snap?.origin ?? "keiner"} (vorher ${vorherText.includes('"maxRounds": 50') ? "50" : "?"})`);
}

async function p13(c: Ctx): Promise<void> {
  let stelle: SettingsStelle | null = null;
  try {
    stelle = await openSettings(c.cdp, c.port);
    const hilfe = await stelle.cdp.evaluate<{ name: string; knoepfe: number; icon: string | null } | null>(`
      const erste = document.querySelector(".setting-item");
      if (!erste) return null;
      return { name: erste.querySelector(".setting-item-name")?.textContent?.trim() ?? "", knoepfe: erste.querySelectorAll("button").length, icon: erste.querySelector(".extra-setting-button")?.getAttribute("aria-label") ?? null };
    `);
    if ((await pollUntil<{ ok: boolean }>(stelle.cdp, `return document.querySelector(".okit-vlist-row") ? { ok: true } : null;`, 5000, 250)) === null) throw new Vorbedingung("die Schnappschuss-Liste hat nach 5 s keine Zeile");
    await sleep(700);
    const zeilen = await stelle.cdp.evaluate<{ n: number; meta: string[] }>(`
      const rows = Array.from(document.querySelectorAll(".okit-vlist-row"));
      return { n: rows.length, meta: rows.map((r) => r.querySelector(".okit-vlist-meta")?.textContent ?? "") };
    `);
    const helpOk = hilfe !== null && hilfe.name === "Help" && hilfe.knoepfe === 1 && hilfe.icon === "Report an issue";
    record(pn("P13"), helpOk && zeilen.n === 1,
      `erste Zeile „${hilfe?.name ?? "?"}“, Text-Knoepfe ${hilfe?.knoepfe ?? "?"}, Icon „${hilfe?.icon ?? "keiner"}“ · Schnappschuss-Zeilen ${zeilen.n} (${zeilen.meta.join(" ; ")}) · ${stelle.eigenesFenster ? "eigenes Settings-Fenster" : "Settings-Modal"}`);
  } finally { closeSettings(c.cdp, stelle); }
}

/** Eine Zeile der Schnappschuss-Liste (Index 0 = neuester) anklicken und den Restore-Dialog abwarten. */
async function oeffneRestore(c: Ctx, stelle: SettingsStelle): Promise<{ cdp: Cdp; info: DialogInfo } | null> {
  const k = await stelle.cdp.evaluate<{ ok: boolean }>(`const r = document.querySelector(".okit-vlist-row"); if (!r) return { ok: false }; r.click(); return { ok: true };`);
  if (!k.ok) throw new Vorbedingung("keine Zeile in der Schnappschuss-Liste");
  return warteAufDialog(stelle.eigenesFenster ? [c.cdp, stelle.cdp] : [c.cdp]);
}

async function p7(c: Ctx): Promise<void> {
  // Teil 1: unveraendert seit dem Anwenden → angehakt, Stand davor kommt zurueck.
  await resetProbe(c.cdp);
  const vorherText = await leseProbeText(c.cdp);
  await oeffneNotiz(c.cdp, "Profile demo");
  await klickeAnwenden(c.cdp);
  const d1 = await warteAufDialog([c.cdp]);
  if (!d1) throw new Vorbedingung("Anwenden-Dialog oeffnet sich nicht (Vorlauf von P7)");
  await dialogKlick(c.cdp, "cta");
  if (!(await dialogWeg(c.cdp))) throw new Vorbedingung("der Anwenden-Dialog schliesst sich im Vorlauf nicht");
  await warteAufNotice(c.cdp, "Settings applied");
  await sleep(500);
  if ((await leseProbe(c.cdp))?.maxRounds !== 20) throw new Vorbedingung("der Vorlauf hat maxRounds nicht auf 20 gesetzt");
  await clearNotices(c.cdp);
  let stelle: SettingsStelle | null = null;
  try {
    stelle = await openSettings(c.cdp, c.port);
    if ((await pollUntil<{ ok: boolean }>(stelle.cdp, `return document.querySelector(".okit-vlist-row") ? { ok: true } : null;`, 5000, 250)) === null) throw new Vorbedingung("die Schnappschuss-Liste hat nach 5 s keine Zeile");
    const dlg = await oeffneRestore(c, stelle);
    if (!dlg) { record(pn("P7"), false, "Klick auf den Schnappschuss oeffnet keinen Zurueckholen-Dialog"); return; }
    const i1 = dlg.info;
    const teil1Dialog = i1.title === "Restore snapshot" && i1.desc.some((d) => d === "unchanged since the apply — will be restored") && i1.boxes.length === 1 && i1.boxes[0]?.checked === true && i1.ctaText === "Restore 1 file";
    await dialogKlick(dlg.cdp, "cta");
    const n1 = await warteAufNotice(c.cdp, "Snapshot restored") ?? await warteAufNotice(dlg.cdp, "Snapshot restored", 500);
    const zu1 = await dialogWeg(dlg.cdp);
    const nach1 = await leseProbeText(c.cdp);
    const teil1Datei = nach1 === vorherText && zu1;

    // Teil 2: nach einer Handaenderung → „changed since“, nicht angehakt, nichts wird ueberschrieben.
    closeSettings(c.cdp, stelle);
    stelle = null;
    await resetProbe(c.cdp);
    await oeffneNotiz(c.cdp, "Profile demo");
    await klickeAnwenden(c.cdp);
    const d2 = await warteAufDialog([c.cdp]);
    if (!d2) throw new Vorbedingung("Anwenden-Dialog (Teil 2) oeffnet sich nicht");
    await dialogKlick(c.cdp, "cta");
    if (!(await dialogWeg(c.cdp))) throw new Vorbedingung("der Anwenden-Dialog schliesst sich im Vorlauf (Teil 2) nicht");
    await sleep(800);
    await c.cdp.evaluate(`
      const path = app.vault.configDir + ${q(PROBE_DATA)};
      const o = JSON.parse(await app.vault.adapter.read(path)); o.maxRounds = 77;
      await app.vault.adapter.write(path, JSON.stringify(o, null, 2));
      return { ok: true };
    `);
    const handText = await leseProbeText(c.cdp);
    if (!handText.includes('"maxRounds": 77')) throw new Vorbedingung("die Handaenderung (77) ist nicht in der Datei angekommen");
    stelle = await openSettings(c.cdp, c.port);
    if ((await pollUntil<{ ok: boolean }>(stelle.cdp, `return document.querySelector(".okit-vlist-row") ? { ok: true } : null;`, 5000, 250)) === null) throw new Vorbedingung("die Schnappschuss-Liste hat nach 5 s keine Zeile");
    const dlg2 = await oeffneRestore(c, stelle);
    if (!dlg2) { record(pn("P7"), false, `Teil 1 ${teil1Dialog && teil1Datei ? "ok" : "rot"}; Teil 2: Zurueckholen-Dialog oeffnet sich nicht`); return; }
    const i2 = dlg2.info;
    const teil2Dialog = i2.desc.some((d) => d.startsWith("changed since — not selected")) && i2.boxes.length === 1 && i2.boxes[0]?.checked === false && i2.ctaDisabled === true;
    await dialogKlick(dlg2.cdp, "cancel");
    const zu2 = await dialogWeg(dlg2.cdp);
    const teil2Datei = (await leseProbeText(c.cdp)) === handText && zu2;
    record(pn("P7"), teil1Dialog && teil1Datei && teil2Dialog && teil2Datei,
      `Teil 1: Dialog „${i1.title}“ / „${i1.desc.join(" | ")}“ / angehakt ${String(i1.boxes[0]?.checked)} / „${i1.ctaText}“, Notice ${n1 === null ? "FEHLT" : "da"}, Datei byte-gleich zum Stand davor: ${String(teil1Datei)} · Teil 2: „${i2.desc.join(" | ")}“, angehakt ${String(i2.boxes[0]?.checked)}, Knopf gesperrt ${String(i2.ctaDisabled)}, Datei (77) unveraendert: ${String(teil2Datei)}`);
  } finally { closeSettings(c.cdp, stelle); }
}

async function p3(c: Ctx): Promise<void> {
  await resetProbe(c.cdp);
  await oeffneNotiz(c.cdp, "Profile clamp");
  await clearNotices(c.cdp);
  await klickeAnwenden(c.cdp);
  const dlg = await warteAufDialog([c.cdp]);
  if (!dlg) { record(pn("P3"), false, "der Anwenden-Dialog oeffnet sich nicht"); return; }
  await dialogKlick(c.cdp, "cta");
  const n = await warteAufNotice(c.cdp, "corrected by the plugin");
  const daten = await leseProbe(c.cdp);
  record(pn("P3"), n !== null && n.includes("corrected by the plugin: 100") && daten?.clamp === 100,
    `Notice ${n === null ? "FEHLT" : `„${n.split("\n").filter((l) => l.includes("corrected")).join(" | ")}“`} · data.json clamp=${String(daten?.clamp)} (Soll des Profils: 500, vom Plugin begrenzt)`);
}

async function p4(c: Ctx): Promise<void> {
  // saveOnUnload ist erst nach dem Neuladen im Speicher von sa-probe wirksam (resetProbe laedt neu).
  await resetProbe(c.cdp, { saveOnUnload: true });
  await oeffneNotiz(c.cdp, "Profile demo");
  await clearNotices(c.cdp);
  await klickeAnwenden(c.cdp);
  const dlg = await warteAufDialog([c.cdp]);
  if (!dlg) { record(pn("P4"), false, "der Anwenden-Dialog oeffnet sich nicht"); return; }
  await dialogKlick(c.cdp, "cta");
  const n = await warteAufNotice(c.cdp, "changed in the meantime");
  const daten = await leseProbe(c.cdp);
  record(pn("P4"), n !== null && daten?.maxRounds !== 20 && daten?.maxRounds === 51,
    `Notice ${n === null ? "FEHLT" : `„${n.split("\n").filter((l) => l.includes("meantime")).join(" | ")}“`} · data.json maxRounds=${String(daten?.maxRounds)} (50 + 1 vom Abschalten, nicht 20 vom Lauf)`);
}

async function p5(c: Ctx): Promise<void> {
  await resetProbe(c.cdp);
  await oeffneNotiz(c.cdp, "Profile secret");
  const z = await leseZeilen(c.cdp);
  const r = z.rows[0];
  const leak = z.text.includes("sk-FAKE") || z.text.includes(PROBE_API_KEY);
  record(pn("P5"), z.rows.length === 1 && r !== undefined && r.cls.includes("is-secret") && r.status.startsWith("secret") && r.values === null && r.openBtn === "Open settings" && !leak && z.applyDisabled === true,
    r ? `Zeile ${r.path} · „${r.status}“ · Werte ${r.values === null ? "keine" : `„${r.values}“`} · Knopf „${r.openBtn}“ · Anwenden gesperrt ${String(z.applyDisabled)} · Wert im Block sichtbar: ${String(leak)}` : "keine Zeile");
}

async function p11(c: Ctx): Promise<void> {
  await resetProbe(c.cdp);
  await oeffneNotiz(c.cdp, "Profile authorization");
  const z = await leseZeilen(c.cdp);
  const r = z.rows[0];
  const leak = z.text.includes("sk-FAKE") || z.text.includes("Bearer");
  record(pn("P11"), z.rows.length === 1 && r !== undefined && r.cls.includes("is-secret") && r.path === "authorization" && r.status.startsWith("secret") && r.values === null && !leak,
    r ? `Zeile ${r.path} · „${r.status}“ · Werte ${r.values === null ? "keine" : `„${r.values}“`} · Wert im Block sichtbar: ${String(leak)}` : "keine Zeile");
}

async function p6(c: Ctx): Promise<void> {
  await oeffneNotiz(c.cdp, "Profile self");
  const z = await leseZeilen(c.cdp);
  const r = z.rows[0];
  record(pn("P6"), z.rows.length === 1 && r !== undefined && r.cls.includes("is-read-only") && r.status === "read-only in this version" && z.applyDisabled === true,
    r ? `Zeile ${r.path} · „${r.status}“ · Anwenden gesperrt ${String(z.applyDisabled)}` : "keine Zeile");
}

async function p14(c: Ctx): Promise<void> {
  await resetProbe(c.cdp);
  const vorherText = await leseProbeText(c.cdp);
  await oeffneNotiz(c.cdp, "Profile demo");
  await klickeAnwenden(c.cdp);
  const d1 = await warteAufDialog([c.cdp]);
  if (!d1) throw new Vorbedingung("Anwenden-Dialog oeffnet sich nicht (Vorlauf von P14)");
  await dialogKlick(c.cdp, "cta");
  if (!(await dialogWeg(c.cdp))) throw new Vorbedingung("der Anwenden-Dialog schliesst sich im Vorlauf nicht");
  await warteAufNotice(c.cdp, "Settings applied");
  await sleep(500);
  if ((await leseProbe(c.cdp))?.maxRounds !== 20) throw new Vorbedingung("der Vorlauf hat maxRounds nicht auf 20 gesetzt");
  await clearNotices(c.cdp);
  const cmd = await c.cdp.evaluate<{ da: boolean; name: string }>(`const cmd = app.commands.commands[${q(`${PLUGIN_ID}:undo-last-apply`)}]; if (cmd) app.commands.executeCommandById(${q(`${PLUGIN_ID}:undo-last-apply`)}); return { da: !!cmd, name: cmd ? cmd.name : "" };`);
  if (!cmd.da) { record(pn("P14"), false, "Befehl settings-assistant:undo-last-apply ist nicht registriert"); return; }
  const dlg = await warteAufDialog([c.cdp]);
  if (!dlg) { record(pn("P14"), false, `Befehl „${cmd.name}“ oeffnet keinen Zurueckholen-Dialog`); return; }
  await dialogKlick(c.cdp, "cta");
  const n = await warteAufNotice(c.cdp, "Snapshot restored");
  const zu = await dialogWeg(c.cdp);
  const nach = await leseProbeText(c.cdp);
  record(pn("P14"), zu && /Undo last apply/.test(cmd.name) && dlg.info.title === "Restore snapshot" && dlg.info.boxes[0]?.checked === true && n !== null && nach === vorherText,
    `Befehl „${cmd.name}“ · Dialog „${dlg.info.title}“, angehakt ${String(dlg.info.boxes[0]?.checked)} · Notice ${n === null ? "FEHLT" : "da"} · Datei byte-gleich zum Stand vor dem Anwenden: ${String(nach === vorherText)}`);
}

async function p9(c: Ctx): Promise<void> {
  const cmdId = "workspace:toggle-pin";
  await c.cdp.evaluate(`
    const path = app.vault.configDir + "/hotkeys.json";
    await app.vault.adapter.write(path, "{}");
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true };
  `);
  const vor = await c.cdp.evaluate<{ k: unknown }>(`return { k: app.hotkeyManager?.getHotkeys ? (app.hotkeyManager.getHotkeys(${q(cmdId)}) ?? null) : "kein hotkeyManager" };`);
  await oeffneNotiz(c.cdp, "Profile hotkeys");
  const z = await leseZeilen(c.cdp);
  await clearNotices(c.cdp);
  await klickeAnwenden(c.cdp);
  const dlg = await warteAufDialog([c.cdp]);
  if (!dlg) { record(pn("P9"), false, `der Anwenden-Dialog oeffnet sich nicht (Zeilen: ${z.rows.map((r) => `${r.path}:${r.cls}`).join(", ")})`); return; }
  const unchecked = dlg.info.boxes.length;
  await dialogKlick(c.cdp, "tick");
  await sleep(200);
  const cta = (await warteAufDialog([c.cdp], 1500))?.info;
  await dialogKlick(c.cdp, "cta");
  const n = await warteAufNotice(c.cdp, "Settings applied");
  const text = await c.cdp.evaluate<{ t: string | null }>(`const p = app.vault.configDir + "/hotkeys.json"; return { t: (await app.vault.adapter.exists(p)) ? await app.vault.adapter.read(p) : null };`);
  type Hk = Record<string, Array<{ modifiers: string[]; key: string }>>;
  const parseHk = (t: string | null): Hk | null => { try { return t === null ? null : (JSON.parse(t) as Hk); } catch { return null; } };
  const datei = parseHk(text.t);
  const eintrag = datei?.[cmdId]?.[0];
  const dateiOk = eintrag?.key === "J" && (eintrag.modifiers).join(",") === "Mod,Alt";
  const wirkt = await pollUntil<{ k: unknown }>(c.cdp, `
    const h = app.hotkeyManager.getHotkeys(${q(cmdId)});
    return h && h.some((x) => x.key === "J" && x.modifiers.includes("Alt")) ? { k: h } : null;
  `, 10_000, 500);
  const hinweis = n !== null && /restart|Neustart/i.test(n);
  record(pn("P9"), dateiOk && wirkt !== null && !hinweis,
    `Zeilen ${z.rows.map((r) => `${r.path}:${r.cls.replace("sa-row ", "")}`).join(", ")} · Dialog-Kontrollkaestchen ${unchecked} (per Klick angehakt, Knopf „${cta?.ctaText ?? "?"}“) · hotkeys.json ${dateiOk ? "traegt Mod+Alt+J" : `FALSCH: ${String(text.t).slice(0, 100)}`} · hotkeyManager.getHotkeys vorher ${JSON.stringify(vor.k)}, nachher ${wirkt === null ? "NICHT wirksam nach 10 s" : JSON.stringify(wirkt.k)} · Neustart-Hinweis ${hinweis ? "JA" : "nein"}`);
}

async function p10(c: Ctx): Promise<void> {
  await resetProbe(c.cdp);
  const vorherText = await leseProbeText(c.cdp);
  const plan = await c.cdp.evaluate<{ rows?: Array<Record<string, unknown>>; error?: string; tools: string[]; status: unknown }>(`
    const api = app.plugins.plugins[${q(PLUGIN_ID)}].api;
    const r = await api.planProfile({ version: 1, plugins: { ${q(PROBE_ID)}: { maxRounds: 20 } } });
    return { ...r, tools: api.tools().map((t) => t.name), status: api.status() };
  `);
  const sec = await c.cdp.evaluate<{ rows?: Array<Record<string, unknown>> }>(`
    const api = app.plugins.plugins[${q(PLUGIN_ID)}].api;
    return await api.planProfile({ version: 1, plugins: { ${q(PROBE_ID)}: { apiKey: "sk-FAKE-API" } } });
  `);
  const planOk = plan.rows?.length === 1 && plan.rows[0]?.status === "change" && plan.rows[0]?.current === 50 && plan.rows[0]?.desired === 20;
  const secRow = sec.rows?.[0];
  const secOk = sec.rows?.length === 1 && secRow?.status === "secret" && !("current" in (secRow ?? {})) && !("desired" in (secRow ?? {})) && !JSON.stringify(sec).includes("sk-FAKE");
  // applyProfile wartet auf den eigenen Dialog: Versprechen im Renderer parken, Dialog abbrechen, dann einsammeln.
  await c.cdp.evaluate(`
    window.__saApply = app.plugins.plugins[${q(PLUGIN_ID)}].api.applyProfile({ version: 1, plugins: { ${q(PROBE_ID)}: { maxRounds: 20 } } }, { origin: "smoke" });
    return { ok: true };
  `);
  const dlg = await warteAufDialog([c.cdp]);
  if (!dlg) { record(pn("P10"), false, "applyProfile oeffnet keinen eigenen Dialog"); return; }
  const dialogOk = dlg.info.title === "Apply settings";
  await dialogKlick(c.cdp, "cancel");
  const res = await c.cdp.evaluate<Record<string, unknown>>(`return await window.__saApply;`);
  const nach = await leseProbeText(c.cdp);
  record(pn("P10"), planOk && secOk && dialogOk && res.cancelled === true && nach === vorherText,
    `planProfile: ${plan.rows?.length ?? 0} Zeile(n), ${String(plan.rows?.[0]?.status)} ${String(plan.rows?.[0]?.current)}→${String(plan.rows?.[0]?.desired)} · Secret-Zeile ohne Werte: ${String(secOk)} · applyProfile: Dialog „${dlg.info.title}“, Ergebnis ${JSON.stringify(res)}, Datei unveraendert ${String(nach === vorherText)} · Werkzeuge ${plan.tools.join(",")}`);
}

async function p8p12(c: Ctx): Promise<void> {
  await resetProbe(c.cdp);
  const pre = await c.cdp.evaluate<{ url: string | null }>(`
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    p.settings.endpoints = [{ url: ${q(c.fake.url)}, apiKey: ${q(FAKE_ENDPOINT_KEY)}, model: ${q(FAKE_MODEL)} }];
    p.settings.endpointChoice = {}; p.settings.localModel = "";
    p.cachedLocal = null;
    await p.saveSettings();
    const ep = await p.resolveEndpoint();
    return { url: ep ? ep.url : null };
  `);
  if (pre.url !== c.fake.url) throw new Vorbedingung(`Chat-Endpunkt laesst sich nicht aufloesen (${String(pre.url)})`);
  // Netz mitschneiden: gibt es einen Request auf das Bild aus der Antwort?
  const requests: string[] = [];
  await c.cdp.send("Network.enable");
  c.cdp.on("Network.requestWillBeSent", (p) => { const u = (p as { request?: { url?: string } }).request?.url; if (u) requests.push(u); });
  // Messprobe: sieht der Mitschnitt einen Bild-Request ueberhaupt? Sonst waere „kein Request“ blind.
  await c.cdp.evaluate(`
    const probe = document.body.createEl("img", { attr: { src: "https://example.invalid/mess-probe.png" } });
    probe.id = "sa-smoke-probe";
    await new Promise((r) => setTimeout(r, 800));
    probe.remove();
    return { ok: true };
  `);
  const mitschnittSieht = requests.some((u) => u.includes("mess-probe.png"));
  await c.cdp.evaluate(`app.workspace.detachLeavesOfType("settings-assistant-chat"); await new Promise((r) => setTimeout(r, 300)); app.commands.executeCommandById(${q(`${PLUGIN_ID}:open-chat`)}); return { ok: true };`);
  const da = await pollUntil<{ ok: boolean }>(c.cdp, `return document.querySelector(".sa-chat-input") ? { ok: true } : null;`, 10_000, 250);
  if (!da) throw new Vorbedingung("Chat-Ansicht oeffnet sich nicht (kein .sa-chat-input)");
  await clearNotices(c.cdp);
  await c.cdp.evaluate(`
    const i = document.querySelector(".sa-chat-input");
    i.value = "Please set sa-probe maxRounds to 33";
    i.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".sa-chat-send").click();
    return { ok: true };
  `);
  const block = await pollUntil<{ ok: boolean }>(c.cdp, `return document.querySelector(".sa-chat-block .sa-apply") ? { ok: true } : null;`, 30_000, 300);
  await sleep(2000); // Markdown-Rendering und Nachbearbeitung laufen asynchron
  const dom = await c.cdp.evaluate<{ imgs: number; active: number; text: string; sent: string; ctx: string }>(`
    const msgs = document.querySelector(".sa-chat-messages");
    const sent = document.querySelector(".sa-chat-sent");
    return {
      imgs: msgs ? msgs.querySelectorAll("img").length : -1,
      active: msgs ? msgs.querySelectorAll("img, iframe, embed, video, audio, object, link, script, source, [src], [srcset]").length : -1,
      text: msgs ? msgs.textContent : "",
      sent: sent ? sent.textContent : "",
      ctx: sent ? Array.from(sent.querySelectorAll(":scope > div")).map((d) => d.textContent).join(" | ") : "",
    };
  `);
  const leakRequests = requests.filter((u) => u.includes("leak.png"));
  // P12 nur messbar, wenn die Antwort ueberhaupt gerendert wurde.
  if (block && dom.imgs >= 0 && !mitschnittSieht) {
    unmeasured(pn("P12"), "der Netz-Mitschnitt sah nicht einmal den eigenen Mess-Request (Network.requestWillBeSent blind) — „kein Request“ waere nichts wert");
  } else if (block && dom.imgs >= 0) {
    record(pn("P12"), dom.imgs === 0 && dom.active === 0 && leakRequests.length === 0,
      `img im Chat ${dom.imgs}, aktive Elemente/src im Chat ${dom.active}, Requests auf leak.png ${leakRequests.length} (Messprobe: eingefuegtes img wurde gesehen: ${String(mitschnittSieht)}; insgesamt mitgeschnitten ${requests.length}) · Antworttext im Chat enthaelt „leak.png“: ${String(dom.text.includes("leak.png"))}`);
  } else unmeasured(pn("P12"), "die Chat-Antwort wurde nicht gerendert (P8 vorher rot)");

  const bodies = c.fake.bodies.join("\n");
  const keyLeak = bodies.includes("sk-FAKE") || dom.sent.includes("sk-FAKE") || dom.sent.includes("sk-");
  // POSITIV am Body des Servers: was wirklich gesendet wurde, nicht nur, was die Ansicht behauptet.
  let msgs: Array<{ role: string; content: string }> = [];
  try { msgs = ((JSON.parse(c.fake.bodies[0] ?? "{}") as { messages?: Array<{ role: string; content: string }> }).messages ?? []); } catch { msgs = []; }
  const sys = msgs.find((m) => m.role === "system")?.content ?? "";
  const usr = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const bodyOk = usr.includes("### plugins.sa-probe") && usr.includes('"maxRounds": 50') && usr.includes('"apiKey": "🔒"') && !usr.includes(PROBE_API_KEY) && usr.includes("Please set sa-probe maxRounds to 33");
  // Anzeige und Body muessen uebereinstimmen: der volle Prompt im Sent context ist System + Nutzernachricht des Bodys.
  const sameOk = sys !== "" && usr !== "" && dom.sent.includes(sys) && dom.sent.includes(usr);
  const authSeen = c.fake.auth[0] ?? "";
  const authOk = (authSeen === "" || authSeen === `Bearer ${FAKE_ENDPOINT_KEY}`) && !authSeen.includes(PROBE_API_KEY);
  const sentOk = dom.sent.includes("Plugins: sa-probe") && dom.sent.includes("plugins.sa-probe.apiKey") && dom.sent.includes(`Model: ${FAKE_MODEL}`) && bodyOk && sameOk && authOk;
  if (!block) { record(pn("P8"), false, `kein Anwenden-Knopf im Chat nach 30 s; Chat-Text: „${dom.text.slice(0, 120)}“; Server sah ${c.fake.bodies.length} Anfrage(n)`); return; }
  await klickeAnwenden(c.cdp, `.sa-chat-block .sa-apply`);
  const dlg = await warteAufDialog([c.cdp]);
  if (!dlg) { record(pn("P8"), false, "der Anwenden-Dialog aus dem Chat oeffnet sich nicht"); return; }
  const dialogOk = dlg.info.title === "Apply settings" && dlg.info.reload === "sa-probe will be reloaded — open views close.";
  await dialogKlick(c.cdp, "cta");
  const n = await warteAufNotice(c.cdp, "Settings applied");
  await sleep(500);
  const daten = await leseProbe(c.cdp);
  const snap = await neuesterSchnappschuss(c.cdp);
  const herkunftOk = (n ?? "").includes("Settings applied (chat:") && (snap?.origin ?? "").startsWith("chat:") && (snap?.origin ?? "").endsWith(`/${FAKE_MODEL}`);
  record(pn("P8"), !keyLeak && sentOk && dialogOk && daten?.maxRounds === 33 && herkunftOk,
    `Server sah ${c.fake.bodies.length} Anfrage(n), Authorization-Header „${authSeen.replace(FAKE_ENDPOINT_KEY, "<Endpunkt-Schluessel>")}“ (ok ${String(authOk)}) · Body traegt Kontext sa-probe/maxRounds 50/apiKey nur als 🔒: ${String(bodyOk)} · Anzeige = Body: ${String(sameOk)} · Sent context: ${dom.ctx.slice(0, 200)} · Schluessel (sk-…) in Body oder Sent context: ${String(keyLeak)} · Dialog gleich: ${String(dialogOk)} · data.json maxRounds=${String(daten?.maxRounds)} · Herkunft Notice ${n === null ? "FEHLT" : "da"} / Manifest „${snap?.origin ?? "keiner"}“`);
}

// ---------------------------------------------------------------------------------------------

/** Klartext-Schluessel (Altbestand vor der Migration) → kalter Start → Schluesselbund. Nur messbar mit `app.secretStorage`. */
async function p15(c: Ctx): Promise<void> {
  const avail = await c.cdp.evaluate<{ ok: boolean; ver: string }>(`return { ok: typeof app.secretStorage?.getSecret === "function" && typeof app.secretStorage?.setSecret === "function", ver: (document.title.match(/Obsidian ([\\d.]+)/) || [])[1] || "?" };`);
  if (!avail.ok) { skipped(pn("P15"), `app.secretStorage fehlt in dieser Obsidian-Version (${avail.ver}, noetig ab 1.11.4)`); return; }
  // Kalter Start mit Altbestand: ausschalten → data.json mit Klartext-apiKey schreiben → einschalten.
  const pre = await c.cdp.evaluate<{ ok: boolean; vorher: boolean }>(`
    const id = ${q(PLUGIN_ID)};
    const path = app.vault.configDir + "/plugins/" + id + "/data.json";
    if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
    const alt = (await app.vault.adapter.exists(path)) ? JSON.parse(await app.vault.adapter.read(path)) : {};
    alt.endpoints = [{ url: ${q(c.fake.url)}, apiKey: ${q(FAKE_ENDPOINT_KEY)}, model: ${q(FAKE_MODEL)} }];
    alt.endpointChoice = {}; alt.localModel = "";
    await app.vault.adapter.write(path, JSON.stringify(alt, null, 2));
    // Gegenprobe der Vorbedingung: der Klartext steht VOR dem Einschalten auf Platte (das Plugin kann ihn beim Start sofort bereinigen).
    const vorher = (await app.vault.adapter.read(path)).includes(${q(FAKE_ENDPOINT_KEY)});
    await app.plugins.enablePlugin(id);
    await new Promise((r) => setTimeout(r, 600));
    return { ok: !!app.plugins.plugins[id], vorher };
  `);
  if (!pre.ok) throw new Vorbedingung("settings-assistant laesst sich nicht neu laden");
  if (!pre.vorher) throw new Vorbedingung("die Vorbereitung hat den Klartext nicht in die data.json gebracht");
  const mem = await c.cdp.evaluate<{ url: string | null; key: string | null }>(`
    const ep = await app.plugins.plugins[${q(PLUGIN_ID)}].resolveEndpoint();
    return { url: ep ? ep.url : null, key: ep ? (ep.apiKey ?? null) : null };
  `);
  await sleep(800); // persist() laeuft ohne Warten im Hintergrund
  const nach = await c.cdp.evaluate<{ t: string }>(`return { t: await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${q(PLUGIN_ID)} + "/data.json") };`);
  let ep0: { secretId?: unknown; id?: unknown; apiKey?: unknown } | undefined;
  try { ep0 = ((JSON.parse(nach.t) as { endpoints?: Array<{ secretId?: unknown; id?: unknown; apiKey?: unknown }> }).endpoints ?? [])[0]; } catch { ep0 = undefined; }
  const platteOk = !nach.t.includes(FAKE_ENDPOINT_KEY) && typeof ep0?.secretId === "string" && ep0.secretId !== "" && typeof ep0.id === "string" && ep0.id !== "" && ep0.apiKey === undefined;
  const speicherOk = mem.url === c.fake.url && mem.key === FAKE_ENDPOINT_KEY;
  // (b) Chat senden: der Server muss weiter genau den hydrierten Schluessel sehen.
  const vorher = c.fake.auth.length;
  await c.cdp.evaluate(`app.workspace.detachLeavesOfType("settings-assistant-chat"); await new Promise((r) => setTimeout(r, 300)); app.commands.executeCommandById(${q(`${PLUGIN_ID}:open-chat`)}); return { ok: true };`);
  const da = await pollUntil<{ ok: boolean }>(c.cdp, `return document.querySelector(".sa-chat-input") ? { ok: true } : null;`, 10_000, 250);
  if (!da) throw new Vorbedingung("Chat-Ansicht oeffnet sich nicht (kein .sa-chat-input)");
  await c.cdp.evaluate(`
    const i = document.querySelector(".sa-chat-input");
    i.value = "Hello for the keychain check";
    i.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".sa-chat-send").click();
    return { ok: true };
  `);
  const bis = Date.now() + 30_000;
  while (c.fake.auth.length <= vorher && Date.now() < bis) await sleep(300);
  const gesehen = c.fake.auth.length > vorher ? (c.fake.auth[c.fake.auth.length - 1] ?? "") : null;
  const headerOk = gesehen === `Bearer ${FAKE_ENDPOINT_KEY}`;
  // (c) Einstellungen: die Zeile zeigt den Zustand, kein Klartextfeld mit dem Schluessel.
  let stelle: SettingsStelle | null = null;
  let zeile: { saved: string | null; klartext: boolean } = { saved: null, klartext: true };
  try {
    stelle = await openSettings(c.cdp, c.port);
    await pollUntil<{ ok: boolean }>(stelle.cdp, `return document.querySelector(".okit-ep-secret") ? { ok: true } : null;`, 6000, 250);
    zeile = await stelle.cdp.evaluate<{ saved: string | null; klartext: boolean }>(`
      const s = document.querySelector(".okit-ep-secret");
      const vals = Array.from(document.querySelectorAll("input")).map((i) => i.value);
      return { saved: s ? s.textContent : null, klartext: vals.some((v) => v.includes(${q(FAKE_ENDPOINT_KEY)})) || document.body.textContent.includes(${q(FAKE_ENDPOINT_KEY)}) };
    `);
  } finally { closeSettings(c.cdp, stelle); }
  const zeileOk = zeile.saved === "saved" && !zeile.klartext;
  record(pn("P15"), platteOk && speicherOk && headerOk && zeileOk,
    `data.json ohne Klartext, mit secretId/id, ohne apiKey: ${String(platteOk)} · hydrierter Schluessel im Speicher: ${String(speicherOk)} · Authorization-Header am Server „${gesehen === null ? "keine Anfrage" : gesehen.replace(FAKE_ENDPOINT_KEY, "<Endpunkt-Schluessel>")}“ (ok ${String(headerOk)}) · Zeile „${String(zeile.saved)}“, Klartext sichtbar: ${String(zeile.klartext)}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const portArg = argv.indexOf("--port");
  const port = portArg >= 0 ? Number(argv[portArg + 1]) : DEFAULT_PORT;
  if (argv.includes("--setup")) { setupVault(); console.log(`\nDen Vault in der Zweitinstanz oeffnen, dann: npm run smoke:gui -- --port ${port}`); return; }

  const t0 = Date.now();
  const launch = argv.includes("--launch");
  const fake = await startFakeEndpoint();
  let inst: Instanz | null = null;
  let cdp: Cdp | null = null;
  const warnungen: string[] = [];
  try {
    if (launch) {
      const vaultDir = setupVault();
      inst = startInstanz(vaultDir, port);
    }
    cdp = await warteAufFenster(port, launch ? 60_000 : 5000);
    await cdp.mitschnitt((z) => { if (/EXCEPTION/.test(z)) warnungen.push(`Renderer: ${z.slice(0, 300)}`); });
    await requireVisible(cdp).catch((e: unknown) => { warnungen.push(`requireVisible: ${(e as Error).message.split("\n")[0]}`); });
    console.log(`Vorbereitung: ${await bereiteVor(cdp)}`);
    const v = await cdp.evaluate<{ name: string; basePath: string; configDir: string; ver: string }>(`return { name: app.vault.getName(), basePath: app.vault.adapter.basePath, configDir: app.vault.configDir, ver: (document.title.match(/Obsidian ([\\d.]+)/) || [])[1] || "?" };`);
    console.log(`Vault: ${v.name} (${v.basePath}), Obsidian ${v.ver}`);
    requireEigenerBuild(join(v.basePath, v.configDir, "plugins", PLUGIN_ID, "main.js"), join(REPO_ROOT, "main.js"), (m) => warnungen.push(m));
    // Die Oberflaeche muss Englisch sein, sonst messen die Textvergleiche die Sprache statt das Plugin.
    const lang = await cdp.evaluate<{ l: string }>(`return { l: (window.moment ? window.moment.locale() : "?") };`);
    if (lang.l !== "en") warnungen.push(`Oberflaechensprache ist „${lang.l}“, nicht „en“ — Textvergleiche koennen rot werden`);

    const ctx: Ctx = { cdp, port, fake };
    if (!(await pruefeGrundlage(ctx))) {
      console.log("\nGrundlage fehlt — kein Punkt kann gemessen werden.");
    } else {
      await closeExtraLeaves(cdp).catch(() => 0);
      const reihe: Array<[PunktName, (c: Ctx) => Promise<void>]> = [
        [pn("P1"), p1], [pn("P2"), p2], [pn("P13"), p13], [pn("P7"), p7], [pn("P14"), p14],
        [pn("P3"), p3], [pn("P4"), p4], [pn("P5"), p5], [pn("P11"), p11], [pn("P6"), p6],
        [pn("P9"), p9], [pn("P10"), p10], [pn("P8"), p8p12], [pn("P15"), p15],
      ];
      for (const [name, fn] of reihe) {
        await schliesseDialoge(cdp);
        await punkt(name, () => fn(ctx));
      }
      // P12 wird in p8p12 mitgemessen; scheitert p8p12 vorher, bleibt es „nichts gemessen“ (siehe Bilanz).
    }
  } finally {
    if (cdp) {
      await schliesseDialoge(cdp);
      const n = await closeExtraLeaves(cdp).catch(() => 0);
      console.log(`\nAufgeraeumt: ${n} Leaves. Notices: ${await notices(cdp).catch(() => "?")}`);
      cdp.close();
    }
    await fake.close();
    if (inst) await stopInstanz(inst);
  }

  const alle = PUNKTE.map((name) => checks.get(name) ?? { name, zustand: "nichts-gemessen" as Zustand, detail: "nie aufgezeichnet" });
  const zaehle = (z: Zustand): number => alle.filter((c) => c.zustand === z).length;
  const rot = alle.filter((c) => c.zustand === "rot");
  const nichts = alle.filter((c) => c.zustand === "nichts-gemessen");
  console.log(`\n${zaehle("gruen")} gruen · ${rot.length} rot · ${zaehle("uebersprungen")} uebersprungen · ${nichts.length} nichts gemessen · von ${PUNKTE.length} Pruefpunkten (${Math.round((Date.now() - t0) / 1000)} s)`);
  for (const w of warnungen) console.log(`WARNUNG: ${w}`);
  if (rot.length) console.log(`Rot: ${rot.map((r) => r.name.split(" ")[0]).join(" · ")}`);
  if (nichts.length) console.log(`Nichts gemessen: ${nichts.map((r) => r.name.split(" ")[0]).join(" · ")}`);
  if (rot.length || nichts.length) process.exitCode = 1;
}

main().catch((e: unknown) => { console.error(`\nABBRUCH: ${(e as Error).message}`); process.exitCode = 2; });
