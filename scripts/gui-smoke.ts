/**
 * GUI-Smoke — faehrt die Pruefpunkte P1-P25 gegen ein LAUFENDES Obsidian (CORE-TEST-02 b).
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
 *   lsof -nP -iTCP:<PORT> -sTCP:LISTEN                                # Port frei?
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label settings-assistant --intent "GUI-Smoke :<PORT>" --exclusive focus --port <PORT> --ttl 300
 *   npm run smoke:gui -- --launch --port <PORT>
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
 * ## Dataview-Messung (`--dataview`, Welle 27)
 *
 * `npm run smoke:gui -- --launch --dataview --port <PORT>` fuehrt NUR drei eigene Punkte (D1-D3, eigener Nenner) und legt Dataview in den
 * Vault: die drei Dateien werden aus einer vorhandenen Installation unter ~/Documents/*\/.obsidian/plugins/dataview LESEND kopiert (oder
 * aus `DATAVIEW_QUELLE=<Ordner>`), JS-Abfragen und Inline-JS stehen an. D2 ist die Gegenprobe und laeuft zuerst: schlaegt sie nicht an
 * (kein Marker am nackten Renderer), sind D1 und D3 „nichts gemessen“, nicht „sicher“. Der Nenner ohne den Schalter bleibt bei P1-P38.
 *
 * Der erste Lauf nach Profilanlage ist ein Aufwaermlauf und zaehlt nicht. Die regulaere Instanz auf 9222
 * wird nicht angefasst. Gemessen wird im eigenen Staging-Vault (`stagingVaultDir()`), nie im
 * Arbeits-Vault; der Ort steht in obsidian-plugins/AGENTS.md § Staging-Vaults.
 *
 * Typen: `tsconfig.scripts.json` (im `gate` ueber `npm run typecheck:scripts`).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd } from "node:process";

import { Cdp, attachTo, beimAbbruch, bereiteInstanzVor, clearNotices, closeExtraLeaves, istAbgebrochen, notices, openExisting, pollUntil, reopenNote, requireVisible, schliesseDialog, schliesseEinstellungen } from "../../tools/obsidian-cdp/cdp.js";
import { messeFolge, zeichneFolge } from "../../tools/obsidian-cdp/folge.js";
import { fokusAufraeumSkript, fokusMutationSkript, gegenprobeErreichbarkeit, gegenprobeFokus, messeDenkblockKopierbar, messeErreichbarkeit, messeFokusFenster, optOutPflicht, zeichneDenkblock, zeichnePflicht } from "../../tools/obsidian-cdp/pflichtpunkte.js";
import { neutralizeModelMarkdown } from "../src/vendor/kit/safe-markdown";
import { Vorbedingung, createBilanz, parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { startLlmStub, type StubAnfrage } from "../../tools/obsidian-cdp/llm-stub.js";
import { buildVault, requireEigenerBuild, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "settings-assistant";
const PLUGIN_ID = "settings-assistant";
const PROBE_ID = "sa-probe";
const DATAVIEW_ID = "dataview";
const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "fixtures/vault");
const PROBE_FIXTURE = join(REPO_ROOT, "fixtures/plugins", PROBE_ID);
const PROFILE_BASE = "/tmp/obs-test-settings-assistant";
const OBSIDIAN_BIN = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const FAKE_MODEL = "smoke-model";
const FAKE_MODEL_2 = "smoke-model-2";
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
  "P16 Roh-Block im Chat: unter dem Block ein „Raw block (secrets redacted)“ mit 🔒, nirgends der Schluessel; ungueltiges JSON wird nicht angezeigt",
  "P17 Neutralisierung: dataviewjs-Zaun, Inline-Code, img und javascript:-Link erzeugen im Chat kein code/pre/img und keinen Request",
  "P18 Schwaerzung: Bearer-Token und PEM gehen als Platzhalter an den Server, die Antwort kommt im Original zurueck, ein Bild mit Platzhalter in der URL erzeugt kein img",
  "P19 Globales Modell abgeschafft: Alt-data.json mit localModel migriert in die Zeile, danach kein localModel mehr auf Platte, eine geleerte Zeile bleibt leer, die Zeilenauswahl hat keine Option „global model“",
  "P20 Strom: der Chat-Verlauf folgt dem Ende, solange niemand eingreift (Kontrolle zu P21)",
  "P21 Folge-Regel: Hochscrollen mitten im Strom wird respektiert, der Verlauf springt nicht zurueck",
  "P22 Denkblock live: der Reasoning-Text ist waehrend des Stroms sichtbar und waechst",
  "P23 Strom mit absatzgrossen Stuecken: der Chat-Verlauf folgt dem Ende auch bei Spruengen ueber die Folge-Schwelle (Kit 0.59.0, withFollow)",
  "P24 Folge-Regel, zweite Haelfte: steht der Nutzer wieder unten, folgt der Chat-Verlauf dem Strom wieder",
  "P25 Gemma 4 ohne Oeffner (Denken in content, <channel|>, Antwort): der Denktext steht im Denkblock, die Antwort zeigt nur die Antwort",
  "P26 Denkblock kopierbar: der Knopf schreibt den Denktext in die Zwischenablage und quittiert erst danach",
  "P27 Denkblock kopierbar (Gegenprobe): lehnt die Zwischenablage ab, bleibt die Quittung aus",
  "P28 Pflichtpunkt Fokus-Erhalt: ein im Strom getippter Text im Eingabefeld ueberlebt das Ende der Antwort",
  "P29 Pflichtpunkt Fokus-Erhalt (Gegenprobe): ein Auslöser, der den Fokus nimmt, macht die Messung rot",
  "P30 Pflichtpunkt Erreichbarkeit: Senden, Neu, Eingabefeld und Modellzeile sind bei ueberlaufendem Verlauf erreichbar",
  "P31 Pflichtpunkt Erreichbarkeit (Gegenprobe): ohne Rollbalken wird etwas unerreichbar",
  "P32 Modellzeile: im Kopf des Chats, listet beide Modelle des Endpunkts, ein Wechsel schreibt das Modell in die Zeile und die naechste Anfrage traegt es",
  "P33 Modellzeile sperrt sich waehrend eines Laufs (Dropdown und Neu-laden gesperrt) und gibt sich danach frei",
  "P34 Escape bricht den laufenden Lauf ab: der Server sieht den Abbruch, die Antwort traegt „Stopped.“, Senden ist wieder frei",
  "P35 Fehlerzeile nennt bei einem HTTP-Fehler die Begruendung des Servers; „Send again“ sendet dieselbe Frage, die gescheiterte Runde geht nicht ans Modell",
  "P36 Denkblock ist im Strom offen und klappt nach der Antwort zu",
  "P37 Linkschutz: javascript:-, data:-, obsidian://- und file:-Links einer Antwort verlieren ihr href, ein https-Link behaelt es",
  "P38 Einstellungs-Tab baut bei jedem Oeffnen neu auf (der Haken haelt nach hide()); Gegenprobe: ohne Haken (dispose) kein Neuaufbau",
] as const;
type PunktName = (typeof PUNKTE)[number];
const pn = (prefix: string): PunktName => {
  const hit = PUNKTE.find((p) => p.startsWith(`${prefix} `));
  if (!hit) throw new Error(`Unbekannter Punkt ${prefix}`);
  return hit;
};

// Dataview-Messung (`--dataview`): drei eigene Punkte mit eigenem Nenner. Ohne den Schalter bleibt die Bilanz bei den 37 Punkten oben.
const DV_PUNKTE = [
  "D1 Dataview-Kette: dataviewjs-Zaun und $=-Ausdruck einer Chat-Antwort laufen durch das echte Chat-Fenster, beide Marker bleiben leer",
  "D2 Dataview-Gegenprobe: derselbe Text ohne Neutralisierung am nackten Renderer setzt beide Marker (Dataview-JS laeuft in dieser Instanz)",
  "D3 Dataview, Neutralisierer allein: derselbe Text durch neutralizeModelMarkdown und den nackten Renderer setzt keinen Marker",
] as const;
const MIT_DATAVIEW = process.argv.includes("--dataview");
const dn = (prefix: string): (typeof DV_PUNKTE)[number] => {
  const hit = DV_PUNKTE.find((p) => p.startsWith(`${prefix} `));
  if (!hit) throw new Error(`Unbekannter Punkt ${prefix}`);
  return hit;
};

// Erfasser, Soll-Liste (Nenner) und Abschlusszeile kommen aus der zentralen Bruecke (`bilanz.ts`); dieser Treiber war ihre Vorlage.
const { record, skipped, unmeasured, punkt, abschluss } = createBilanz({ punkte: MIT_DATAVIEW ? [...DV_PUNKTE] : [...PUNKTE] });

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

// Zusaetzliche Antworten (P16/P17): gewaehlt wird nach einem Stichwort in der LETZTEN Nutzer-Nachricht, damit P8/P12 mit
// CHAT_ANSWER unveraendert messen.
const RAW_LEAK = "sk-FAKE-LEAK";
const RAW_PROFILE = { version: 1, plugins: { [PROBE_ID]: { apiKey: RAW_LEAK, maxRounds: 44 } } };
const RAW_ANSWER = [
  "Here is a profile that carries a secret.",
  "",
  "```settings-profile",
  JSON.stringify(RAW_PROFILE, null, 2),
  "```",
  "",
  "And a broken one:",
  "",
  "```settings-profile",
  `{"version":1,"plugins":{"${PROBE_ID}":{"apiKey":"${RAW_LEAK}-BAD"}}`,
  "```",
].join("\n");
const NEUTRAL_ANSWER = [
  "Ideas follow.",
  "",
  "```dataviewjs",
  "dv.paragraph(app.vault.getName())",
  "```",
  "",
  "Inline: `$= dv.current()`",
  "",
  "<img src=https://example.invalid/x.png>",
  "",
  "[click](javascript:alert(1))",
].join("\n");
// Dataview-Messung: die Marker sind Fenster-Variablen, gelesen wird per CDP nach dem Rendern.
const DV_BLOCK = "__saDvBlock";
const DV_INLINE = "__saDvInline";
const DV_ANSWER = [
  "Dataview probe.",
  "",
  "```dataviewjs",
  `window.${DV_BLOCK} = 1`,
  "```",
  "",
  `Inline: \`$= window.${DV_INLINE} = 1\``,
].join("\n");
const LINKS_ANSWER = [
  "Links:",
  "",
  "[a-js](javascript:alert(1)) [b-data](data:text/html,x) [c-obs](obsidian://open?vault=x) [d-file](file:///etc/passwd) [e-ok](https://example.org/ok)",
].join("\n");
function antwortFuer(body: string): string {
  let last = "";
  try {
    const msgs = (JSON.parse(body) as { messages?: Array<{ role: string; content: unknown }> }).messages ?? [];
    const u = [...msgs].reverse().find((m) => m.role === "user");
    last = typeof u?.content === "string" ? u.content : JSON.stringify(u?.content ?? "");
  } catch { last = ""; }
  if (last.includes("SMOKE-RAW")) return RAW_ANSWER;
  if (last.includes("SMOKE-NEUTRAL")) return NEUTRAL_ANSWER;
  if (last.includes("SMOKE-LINKS")) return LINKS_ANSWER;
  if (last.includes("SMOKE-DATAVIEW")) return DV_ANSWER;
  if (last.includes("SMOKE-REDACT")) {
    // Spiegelt die Platzhalter der Anfrage zurueck (so, wie ein Modell sie wiederholt) — samt einem Bild mit Platzhalter in der URL.
    const ph = last.match(/\[redacted-[a-z0-9-]+-\d+\]/g) ?? [];
    return `Echo: ${ph.join(" ")}\n\n![x](https://example.invalid/leak-p18?d=${ph[0] ?? ""})`;
  }
  return CHAT_ANSWER;
}

interface FakeEndpoint { url: string; close: () => Promise<void>; readonly bodies: string[]; readonly auth: string[] }
/** Seit Welle 20 der zentrale Stub (`tools/obsidian-cdp/llm-stub.ts`): CORS an, strenge Pfade, Antwort in zwei Haelften
 *  nach `antwortFuer`. `bodies` und `auth` sind Getter ueber den Mitschnitt der Chat-Anfragen (wie der alte Server). */
async function startFakeEndpoint(): Promise<FakeEndpoint> {
  const stub = await startLlmStub({
    models: [FAKE_MODEL, FAKE_MODEL_2],
    antwort: (anfrage) => ({ text: antwortFuer(anfrage.body), teile: 2, model: FAKE_MODEL }),
  });
  const chat = (): StubAnfrage[] => stub.anfragen().filter((a) => a.route === "chat");
  return {
    url: stub.url,
    get bodies() { return chat().map((a) => a.body); },
    get auth() { return chat().map((a) => String(a.header.authorization ?? "")); },
    close: () => stub.stop(),
  };
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
  if (MIT_DATAVIEW) console.log(`  · ${installiereDataview(vaultDir)}`);
  return vaultDir;
}

/** Dataview nur LESEND aus einer vorhandenen Installation kopieren (`DATAVIEW_QUELLE` oder die erste unter ~/Documents/*), JS-Abfragen und Inline-JS einschalten. */
function installiereDataview(vaultDir: string): string {
  const kandidaten: string[] = [];
  if (process.env.DATAVIEW_QUELLE) kandidaten.push(process.env.DATAVIEW_QUELLE);
  const docs = join(homedir(), "Documents");
  for (const v of readdirSync(docs)) kandidaten.push(join(docs, v, ".obsidian/plugins", DATAVIEW_ID));
  const quelle = kandidaten.find((k) => { try { return readdirSync(k).includes("main.js"); } catch { return false; } });
  if (!quelle) throw new Error("Keine Dataview-Installation gefunden — DATAVIEW_QUELLE=<Ordner mit main.js, manifest.json, styles.css> setzen.");
  const ziel = join(vaultDir, ".obsidian/plugins", DATAVIEW_ID);
  rmSync(ziel, { recursive: true, force: true });
  mkdirSync(ziel, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(join(quelle, f), join(ziel, f));
  writeFileSync(join(ziel, "data.json"), JSON.stringify({ enableDataviewJs: true, enableInlineDataviewJs: true }, null, 2));
  const liste = join(vaultDir, ".obsidian/community-plugins.json");
  let ids: string[] = [];
  try { ids = JSON.parse(readFileSync(liste, "utf8")) as string[]; } catch { ids = []; }
  if (!ids.includes(DATAVIEW_ID)) writeFileSync(liste, JSON.stringify([...ids, DATAVIEW_ID]));
  return `${DATAVIEW_ID} ${(JSON.parse(readFileSync(join(ziel, "manifest.json"), "utf8")) as { version: string }).version} nach .obsidian/plugins/${DATAVIEW_ID}/ kopiert (JS-Abfragen und Inline-JS an)`;
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

/** Idempotent: im Normalweg (`finally`) und im Abbruch-Modul (hoechstens eine Sekunde, daher kurze Fristen). */
async function stopInstanz(inst: Instanz): Promise<void> {
  if (inst.child.exitCode !== null || inst.child.signalCode !== null) return;
  const eilig = istAbgebrochen();
  const exited = new Promise<void>((resolve) => { inst.child.once("exit", () => { resolve(); }); });
  inst.child.kill("SIGTERM");
  await Promise.race([exited, sleep(eilig ? 600 : 8000)]);
  if (inst.child.exitCode === null && inst.child.signalCode === null) { inst.child.kill("SIGKILL"); await Promise.race([exited, sleep(eilig ? 200 : 4000)]); }
  if (eilig) return;
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

/** Vertrauensdialog (frisches Profil), Restricted Mode, beide Plugins laden — aus der zentralen Bruecke (`bereiteInstanzVor`). */
async function bereiteVor(cdp: Cdp): Promise<string> {
  return (await bereiteInstanzVor(cdp, { pluginIds: MIT_DATAVIEW ? [PROBE_ID, PLUGIN_ID, DATAVIEW_ID] : [PROBE_ID, PLUGIN_ID] })).hinweis;
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
  // `schliesseDialog` kennt beide Knopf-Formen (`.modal-close-button` bis 1.12, `.modal-header-button` ab 1.14.4).
  await schliesseDialog(cdp).catch(() => undefined);
  await sleep(200);
  await clearNotices(cdp).catch(() => undefined);
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
  await schliesseEinstellungen(cdp);
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
  void schliesseEinstellungen(cdp);
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
    p.settings.endpointChoice = {};
    p.llm.invalidate();
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
  const da = await pollUntil<{ ok: boolean }>(c.cdp, `return document.querySelector(".okit-chat-input") ? { ok: true } : null;`, 10_000, 250);
  if (!da) throw new Vorbedingung("Chat-Ansicht oeffnet sich nicht (kein .okit-chat-input)");
  await clearNotices(c.cdp);
  await c.cdp.evaluate(`
    const i = document.querySelector(".okit-chat-input");
    i.value = "Please set sa-probe maxRounds to 33";
    i.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".okit-chat-send").click();
    return { ok: true };
  `);
  const block = await pollUntil<{ ok: boolean }>(c.cdp, `return document.querySelector(".sa-chat-block .sa-apply") ? { ok: true } : null;`, 30_000, 300);
  await sleep(2000); // Markdown-Rendering und Nachbearbeitung laufen asynchron
  const dom = await c.cdp.evaluate<{ imgs: number; active: number; text: string; sent: string; ctx: string }>(`
    const msgs = document.querySelector(".okit-chat-log");
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

/** Endpunkt auf `url` stellen, Chat oeffnen, neues Gespraech, `frage` senden — ohne auf das Ende zu warten. */
/** Endpunkt setzen, Chat oeffnen, neuen Chat beginnen — alles, was VOR dem Senden liegt (die Folge-Messung haengt ihren Beobachter dazwischen). */
async function chatVorbereiten(c: Ctx, url: string = c.fake.url): Promise<void> {
  const pre = await c.cdp.evaluate<{ url: string | null }>(`
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    p.settings.endpoints = [{ url: ${q(url)}, apiKey: ${q(FAKE_ENDPOINT_KEY)}, model: ${q(FAKE_MODEL)} }];
    p.settings.endpointChoice = {};
    p.llm.invalidate();
    await p.saveSettings();
    const ep = await p.resolveEndpoint();
    return { url: ep ? ep.url : null };
  `);
  if (pre.url !== url) throw new Vorbedingung(`Chat-Endpunkt laesst sich nicht aufloesen (${String(pre.url)})`);
  await c.cdp.evaluate(`app.workspace.detachLeavesOfType("settings-assistant-chat"); await new Promise((r) => setTimeout(r, 300)); app.commands.executeCommandById(${q(`${PLUGIN_ID}:open-chat`)}); return { ok: true };`);
  const da = await pollUntil<{ ok: boolean }>(c.cdp, `return document.querySelector(".okit-chat-input") ? { ok: true } : null;`, 10_000, 250);
  if (!da) throw new Vorbedingung("Chat-Ansicht oeffnet sich nicht (kein .okit-chat-input)");
  await c.cdp.evaluate(`
    const nb = document.querySelector(".okit-chat-new");
    if (nb) nb.click();
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  `);
  await clearNotices(c.cdp);
}

async function chatAbsenden(c: Ctx, frage: string): Promise<void> {
  await c.cdp.evaluate(`
    const i = document.querySelector(".okit-chat-input");
    i.value = ${q(frage)};
    i.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".okit-chat-send").click();
    return { ok: true };
  `);
}

async function chatSenden(c: Ctx, frage: string, url: string = c.fake.url): Promise<void> {
  await chatVorbereiten(c, url);
  await chatAbsenden(c, frage);
}

/** Endpunkt auf den Fake setzen, Chat oeffnen, NEUEN Chat beginnen, Frage senden, auf das Ende der Antwort warten. */
async function chatRunde(c: Ctx, frage: string): Promise<void> {
  await chatSenden(c, frage);
  const fertig = await pollUntil<{ ok: boolean }>(c.cdp, `
    const send = document.querySelector(".okit-chat-send");
    const turns = document.querySelectorAll(".okit-chat-turn.is-assistant").length;
    return send && send.textContent === "Send" && turns === 1 && document.querySelector(".okit-chat-turn.is-assistant .okit-stream-block, .okit-chat-turn.is-assistant .sa-chat-block") ? { ok: true } : null;
  `, 30_000, 300);
  if (!fertig) throw new Vorbedingung("die Chat-Antwort kommt nicht zu Ende (kein Block/Text nach 30 s)");
  await sleep(2000); // Markdown-Rendering und Nachbearbeitung laufen asynchron
}

async function p16(c: Ctx): Promise<void> {
  await chatRunde(c, "SMOKE-RAW please propose a profile");
  const d = await c.cdp.evaluate<{ blocks: number; details: number; summary: string; below: boolean; pre1: string; pre2: string; all: string; root: string; sentTxt: string }>(`
    const msgs = document.querySelector(".okit-chat-log");
    const blocks = Array.from(msgs.querySelectorAll(".sa-chat-block"));
    const dets = blocks.map((b) => b.querySelector(":scope > details.sa-chat-raw"));
    return {
      blocks: blocks.length,
      details: dets.filter(Boolean).length,
      summary: dets[0] ? dets[0].querySelector("summary").textContent : "",
      below: !!(blocks[0] && dets[0] && blocks[0].querySelector(":scope > .sa-chat-block-result") && (blocks[0].querySelector(":scope > .sa-chat-block-result").compareDocumentPosition(dets[0]) & Node.DOCUMENT_POSITION_FOLLOWING)),
      pre1: dets[0] ? dets[0].querySelector("pre").textContent : "",
      pre2: dets[1] ? dets[1].querySelector("pre").textContent : "",
      all: msgs.textContent,
      root: document.querySelector(".sa-chat").textContent + " " + document.querySelector(".sa-chat").innerHTML,
      sentTxt: Array.from(document.querySelectorAll(".notice")).map((n) => n.textContent).join(" | "),
    };
  `);
  const kein = (t: string): boolean => !t.includes(RAW_LEAK);
  const ok = d.blocks === 2 && d.details === 2 && d.summary === "Raw block (secrets redacted)" && d.below
    && d.pre1.includes("🔒") && kein(d.pre1) && d.pre2 === "(block is not valid JSON — not shown)"
    && kein(d.all) && kein(d.root) && kein(d.sentTxt);
  record(pn("P16"), ok,
    `Bloecke ${d.blocks}, <details> ${d.details}, Titel „${d.summary}“, unter dem Ergebnis ${String(d.below)} · Block 1 im <pre>: „${d.pre1.replace(/\n/g, " ").slice(0, 120)}“ (🔒 ${String(d.pre1.includes("🔒"))}, Schluessel ${String(!kein(d.pre1))}) · Block 2 (ungueltiges JSON mit Schluessel): „${d.pre2}“ · „${RAW_LEAK}“ im Text des Chat-Containers ${String(!kein(d.all))}, im gesamten Chat-DOM inkl. innerHTML ${String(!kein(d.root))}, in Notices ${String(!kein(d.sentTxt))}`);
}

async function p17(c: Ctx): Promise<void> {
  const requests: string[] = [];
  await c.cdp.send("Network.enable");
  c.cdp.on("Network.requestWillBeSent", (p) => { const u = (p as { request?: { url?: string } }).request?.url; if (u) requests.push(u); });
  // Messprobe wie P12: sieht der Mitschnitt einen Request auf example.invalid ueberhaupt?
  await c.cdp.evaluate(`
    const probe = document.body.createEl("img", { attr: { src: "https://example.invalid/mess-probe-p17.png" } });
    await new Promise((r) => setTimeout(r, 800));
    probe.remove();
    return { ok: true };
  `);
  const mitschnittSieht = requests.some((u) => u.includes("mess-probe-p17.png"));
  await chatRunde(c, "SMOKE-NEUTRAL please explain");
  const d = await c.cdp.evaluate<{ code: number; preLang: number; active: number; links: string[]; text: string; dataview: boolean; turn: number }>(`
    const msgs = document.querySelector(".okit-chat-log");
    const turn = msgs.querySelector(".okit-chat-turn.is-assistant");
    return {
      turn: turn ? 1 : 0,
      code: msgs.querySelectorAll("code").length,
      preLang: msgs.querySelectorAll("pre[class*='language-'], code[class*='language-'], [class*='block-language-']").length,
      active: msgs.querySelectorAll("img, script, iframe, embed, object, video, audio, [src], [srcset]").length,
      links: Array.from(msgs.querySelectorAll(".okit-stream-block a")).map((a) => (a.textContent || "") + " -> " + String(a.getAttribute("href"))),
      text: turn ? Array.from(turn.querySelectorAll(".okit-stream-block")).map((b) => b.textContent ?? "").join(" ") : "",
      dataview: !!(app.plugins.plugins && app.plugins.plugins.dataview),
    };
  `);
  const invalid = requests.filter((u) => u.includes("example.invalid") && !u.includes("mess-probe-p17"));
  if (d.turn === 0) { unmeasured(pn("P17"), "die Chat-Antwort wurde nicht gerendert"); return; }
  if (!mitschnittSieht) { unmeasured(pn("P17"), "der Netz-Mitschnitt sah nicht einmal den eigenen Mess-Request — „kein Request“ waere nichts wert"); return; }
  // Nicht vakuum: der Anker „click“ muss existieren UND seinen href verloren haben (`links.every` ueber null Elemente waere wahr).
  const linkOk = d.links.some((l) => l.startsWith("click -> null")) && d.links.every((l) => !/javascript:/i.test(l));
  const sichtbar = d.text.includes("ˋ") && d.text.includes("dataviewjs") && d.text.includes("$= dv.current()") && d.text.includes("<img src=https://example.invalid/x.png>") && d.text.includes("click");
  record(pn("P17"), d.code === 0 && d.preLang === 0 && d.active === 0 && linkOk && sichtbar && invalid.length === 0,
    `code-Elemente ${d.code}, pre/code mit language-Klasse ${d.preLang}, img/script/iframe/[src] ${d.active}, Links im Antworttext [${d.links.join("; ")}] (Anker „click“ ohne href, kein javascript: ${String(linkOk)}), Requests auf example.invalid ${invalid.length} (Messprobe sah ${String(mitschnittSieht)}; mitgeschnitten ${requests.length}) · Antwort als Text sichtbar (ˋ-Zeichen, Inline-Text, escaped <img>, Linktext): ${String(sichtbar)} · Dataview in der Zweitinstanz installiert: ${String(d.dataview)}${d.dataview ? "" : " — die Aussage ist daher nur „es entsteht kein code-/pre-Element, an dem ein Prozessor haengen koennte“, NICHT „Dataview fuehrt nichts aus“"}`);
}


const P18_TOKEN = "Bearer abcdefghijklmnop0123456789";
const P18_PEM_BODY = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC";

async function p18(c: Ctx): Promise<void> {
  const requests: string[] = [];
  await c.cdp.send("Network.enable");
  c.cdp.on("Network.requestWillBeSent", (p) => { const u = (p as { request?: { url?: string } }).request?.url; if (u) requests.push(u); });
  await c.cdp.evaluate(`
    const probe = document.body.createEl("img", { attr: { src: "https://example.invalid/mess-probe-p18.png" } });
    await new Promise((r) => setTimeout(r, 800));
    probe.remove();
    return { ok: true };
  `);
  const mitschnittSieht = requests.some((u) => u.includes("mess-probe-p18.png"));
  const vor = c.fake.bodies.length;
  await chatRunde(c, `SMOKE-REDACT please check ${P18_TOKEN} and -----BEGIN PRIVATE KEY----- ${P18_PEM_BODY} -----END PRIVATE KEY-----`);
  const d = await c.cdp.evaluate<{ turn: number; text: string; imgs: number; active: number }>(`
    const msgs = document.querySelector(".okit-chat-log");
    const turn = msgs.querySelector(".okit-chat-turn.is-assistant");
    return {
      turn: turn ? 1 : 0,
      text: turn ? turn.textContent ?? "" : "",
      imgs: msgs.querySelectorAll("img").length,
      active: msgs.querySelectorAll("img, script, iframe, embed, object, video, audio, [src], [srcset]").length,
    };
  `);
  const body = c.fake.bodies.slice(vor).join("\n");
  if (body === "") { unmeasured(pn("P18"), "der Server hat keine Anfrage gesehen"); return; }
  if (d.turn === 0) { unmeasured(pn("P18"), "die Chat-Antwort wurde nicht gerendert"); return; }
  if (!mitschnittSieht) { unmeasured(pn("P18"), "der Netz-Mitschnitt sah nicht einmal den eigenen Mess-Request — „kein Request“ waere nichts wert"); return; }
  const tokenOnWire = body.includes("abcdefghijklmnop0123456789");
  const pemOnWire = body.includes(P18_PEM_BODY);
  const placeholders = (body.match(/\[redacted-(?:token|private-key)-\d+\]/g) ?? []).length;
  const tokenBack = d.text.includes(P18_TOKEN);
  const pemBack = d.text.includes(P18_PEM_BODY);
  const leak = requests.filter((u) => u.includes("leak-p18"));
  record(pn("P18"), !tokenOnWire && !pemOnWire && placeholders >= 2 && tokenBack && pemBack && d.imgs === 0 && d.active === 0 && leak.length === 0,
    `am Server: Token im Klartext ${String(tokenOnWire)}, PEM-Rumpf im Klartext ${String(pemOnWire)}, Platzhalter ${placeholders} · in der Antwort wieder da: Token ${String(tokenBack)}, PEM-Rumpf ${String(pemBack)} · img im Chat ${d.imgs}, aktive Elemente ${d.active}, Requests auf leak-p18 ${leak.length} (Messprobe sah ${String(mitschnittSieht)}; mitgeschnitten ${requests.length})`);
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
    alt.endpointChoice = {};
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
  const da = await pollUntil<{ ok: boolean }>(c.cdp, `return document.querySelector(".okit-chat-input") ? { ok: true } : null;`, 10_000, 250);
  if (!da) throw new Vorbedingung("Chat-Ansicht oeffnet sich nicht (kein .okit-chat-input)");
  await c.cdp.evaluate(`
    const i = document.querySelector(".okit-chat-input");
    i.value = "Hello for the keychain check";
    i.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".okit-chat-send").click();
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

/** Alt-`data.json` mit `localModel` → Migration in die Zeile ohne Modell → Altschluessel von der Platte → zweiter Start. */
async function p19(c: Ctx): Promise<void> {
  const lauf = (alt: string) => c.cdp.evaluate<{ ok: boolean; vorher: string }>(`
    const id = ${q(PLUGIN_ID)};
    const path = app.vault.configDir + "/plugins/" + id + "/data.json";
    if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
    const alt = (await app.vault.adapter.exists(path)) ? JSON.parse(await app.vault.adapter.read(path)) : {};
    ${alt}
    await app.vault.adapter.write(path, JSON.stringify(alt, null, 2));
    const vorher = await app.vault.adapter.read(path);
    await app.plugins.enablePlugin(id);
    await new Promise((r) => setTimeout(r, 1200));
    return { ok: !!app.plugins.plugins[id], vorher };
  `);
  const lies = async () => JSON.parse((await c.cdp.evaluate<{ t: string }>(`return { t: await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${q(PLUGIN_ID)} + "/data.json") };`)).t) as { localModel?: unknown; endpoints?: Array<{ model?: string }> };
  const pre = await lauf(`alt.endpoints = [{ url: ${q(c.fake.url)}, apiKey: "" }]; alt.endpointChoice = {}; alt.localModel = "legacy-p19";`);
  if (!pre.ok) throw new Vorbedingung("settings-assistant laesst sich nicht neu laden");
  if (!pre.vorher.includes("legacy-p19")) throw new Vorbedingung("die Vorbereitung hat localModel nicht in die data.json gebracht");
  await sleep(800);
  const a = await lies();
  const migriert = a.endpoints?.[0]?.model === "legacy-p19" && !("localModel" in a);
  // Zweiter Lauf: die Zeile bewusst leeren, Plugin neu starten — sie darf nicht wieder gefuellt werden.
  const pre2 = await lauf(`alt.endpoints = [{ url: ${q(c.fake.url)}, apiKey: "" }]; delete alt.localModel;`);
  if (!pre2.ok) throw new Vorbedingung("settings-assistant laesst sich nicht ein zweites Mal neu laden");
  await sleep(800);
  const b = await lies();
  const bleibtLeer = (b.endpoints?.[0]?.model ?? "") === "" && !("localModel" in b);
  // Zeilenauswahl: Optionen aller Auswahlfelder der Einstellungen; ohne gemessene Auswahl ist „keine Option“ nichts wert.
  await lauf(`alt.endpoints = [{ url: ${q(c.fake.url)}, apiKey: "", model: ${q(FAKE_MODEL)} }]; delete alt.localModel;`);
  let stelle: SettingsStelle | null = null;
  let opts: string[] = [];
  try {
    stelle = await openSettings(c.cdp, c.port);
    await sleep(1500);
    opts = (await stelle.cdp.evaluate<{ o: string[] }>(`return { o: Array.from(document.querySelectorAll("select option")).map((o) => o.textContent ?? "") };`)).o;
  } finally { closeSettings(c.cdp, stelle); }
  if (opts.length === 0) { unmeasured(pn("P19"), "keine Auswahl mit Optionen in den Einstellungen gesehen — „keine Option global model“ waere nichts wert"); return; }
  const global = opts.filter((o) => /global model|globales Modell/i.test(o));
  record(pn("P19"), migriert && bleibtLeer && global.length === 0,
    `Altwert in der Zeile, localModel von der Platte: ${String(migriert)} · geleerte Zeile bleibt nach Neustart leer: ${String(bleibtLeer)} · Optionen [${opts.join("; ")}], davon „global model“: ${global.length}`);
}

// ---------------------------------------------------------------------------------------------
// Strom im Chat (Welle 20, zentraler Stub): Folge-Regel und Denkblock live
// ---------------------------------------------------------------------------------------------
// Bisher ohne Modell nicht messbar. Scrollender Container ist `.okit-chat-log` (`scrollEl` von `buildStreamArea`,
// Spalten-Flex mit `min-height: 0`, begrenzte Hoehe). Gueltigkeit (CORE-TEST-22): Ueberlauf >= 80 px zum Stoerungszeitpunkt
// (Folge-Schwelle 40 px + 40 px Spielraum), mindestens zwei Stuecke nach der Stoerung, abgetastet nur bis zum vorletzten
// Stueck; der Stub haelt danach drei Takte offen. Sonst „nichts gemessen“. Tokengrosse Stuecke (10 Zeichen).
const STROM_TAKT = 40;
const STROM_LAENGE = 10;
const STROM_TEXT = Array.from({ length: 26 }, (_, i) => `Absatz ${i + 1}: Der Strom laeuft weiter, Wort fuer Wort, damit der Verlauf waechst und das Ende wandert.\n\n`).join("");
const STROM_STUECKE = Math.ceil(STROM_TEXT.length / STROM_LAENGE);
const MSGS = `document.querySelector(".okit-chat-log")`;
const P20 = pn("P20"), P21 = pn("P21"), P23 = pn("P23"), P24 = pn("P24");

/** Folge-Messung: zentral (`messeFolge`, tools/obsidian-cdp/README § Folge-Messung). Hier bleibt das Wissen ueber den Chat:
 *  Stub, Vorbereitung, Senden, der Scroll-Container und „laeuft der Strom noch“. `grob`: ein ganzer Absatz je Stueck. */
async function strom(c: Ctx, opt: { kontrolle: boolean; stoerung: boolean; wiederaufnahme?: boolean }, grob = false): Promise<Awaited<ReturnType<typeof messeFolge>>> {
  const absaetze = STROM_TEXT.split(/(?<=\n\n)/);
  const takt = grob ? 150 : STROM_TAKT;
  const stub = await startLlmStub({ models: [FAKE_MODEL], takt, nachlaufMs: 3 * takt, standard: grob ? { stuecke: absaetze } : { text: STROM_TEXT, laenge: STROM_LAENGE } });
  try {
    await chatVorbereiten(c, stub.url);
    const e = await messeFolge(c.cdp, {
      ausdruck: MSGS,
      laeuft: () => stub.zaehler().unterwegs > 0,
      starte: () => chatAbsenden(c, "SMOKE-STROM lange Antwort"),
      ...opt,
    });
    await pollUntil<boolean>(c.cdp, `const s = document.querySelector(".okit-chat-send"); return s && s.textContent === "Send" ? true : null;`, 25_000, 300).catch(() => undefined);
    return e;
  } finally {
    await stub.stop();
  }
}

async function p20(c: Ctx): Promise<void> {
  zeichneFolge({ record, unmeasured }, { kontrolle: P20 }, await strom(c, { kontrolle: true, stoerung: false }));
}

async function p23(c: Ctx): Promise<void> {
  zeichneFolge({ record, unmeasured }, { kontrolle: P23 }, await strom(c, { kontrolle: true, stoerung: false }, true));
}

/** P21 (Folge) und P24 (Wiederaufnahme) teilen sich einen Strom: erst die Stoerung, danach steht der Nutzer wieder unten. */
async function p21(c: Ctx): Promise<void> {
  zeichneFolge({ record, unmeasured }, { folge: P21, wiederaufnahme: P24 }, await strom(c, { kontrolle: false, stoerung: true, wiederaufnahme: true }));
}

/** Gemma 4 auf LM Studio (Welle 23): das Denken steht OHNE Oeffner in `content`, `<channel|>` schliesst es, die Antwort folgt.
 *  Der Stub streamt genau das und haelt die Verbindung danach offen, damit der Anzeigetext vor dem Schluss-Draw lesbar bleibt.
 *  Gemessen wird der ANZEIGETEXT der Antwort (`.okit-stream-body`): ohne Kanal-Leser und `onContentReset` bliebe der Denktext samt
 *  `<channel|>` darin stehen; das Denken gehoert in den Block `.okit-stream-reasoning`. Der Server nennt das Modell in der Antwort. */
async function p25(c: Ctx): Promise<void> {
  const GEDANKE = "Ich waege erst die Quellen ab und pruefe dann den Kontext.";
  const stub = await startLlmStub({
    models: [FAKE_MODEL], takt: 150, nachlaufMs: 4000,
    antwort: () => ({ stuecke: [GEDANKE.slice(0, 20), GEDANKE.slice(20) + "<channel|>", "Die fertige ", "Antwort."], model: "google/gemma-4-e4b" }),
  });
  try {
    await chatSenden(c, "SMOKE-GEMMA bitte antworten", stub.url);
    const g = await pollUntil<{ antwort: string; denken: string; block: boolean }>(c.cdp, `
      const body = document.querySelector(".okit-chat-turn.is-assistant .okit-stream-body");
      if (!body || !(body.textContent || "").includes("Antwort.")) return null;
      const pre = document.querySelector(".okit-chat-turn.is-assistant .okit-stream-reasoning pre");
      return { antwort: (body.textContent || "").trim(), denken: pre ? pre.textContent || "" : "", block: !!pre };`, 20_000, 100).catch(() => null);
    if (g === null) { unmeasured(pn("P25"), "die Antwort kam im Anzeigetext nicht an (20 s)"); return; }
    record(pn("P25"), g.block && g.antwort === "Die fertige Antwort." && g.denken.includes("waege") && !g.antwort.includes("waege") && !g.antwort.includes("channel"),
      `Anzeigetext „${g.antwort.slice(0, 80)}“ · Denkblock ${g.block ? `„${g.denken.slice(0, 40)}“` : "fehlt"}`);
  } finally {
    await pollUntil<boolean>(c.cdp, `const s = document.querySelector(".okit-chat-send"); return s && s.textContent === "Send" ? true : null;`, 25_000, 300).catch(() => undefined);
    await stub.stop();
  }
}

async function p22(c: Ctx): Promise<void> {
  const stub = await startLlmStub({
    models: [FAKE_MODEL], takt: 250, nachlaufMs: 750,
    standard: { reasoning: "Ich ueberlege Schritt fuer Schritt, was zu tun ist. ".repeat(12), laenge: 40, text: "Fertig." },
  });
  try {
    await chatSenden(c, "SMOKE-DENKEN bitte nachdenken", stub.url);
    type Probe = { len: number; offen: boolean; sichtbar: boolean; body: number };
    const proben: Probe[] = [];
    const frist = Date.now() + 8_000;
    while (Date.now() < frist && proben.length < 12) {
      const pr = await c.cdp.evaluate<Probe | null>(`
        const pre = document.querySelector(".okit-chat-turn.is-assistant .okit-stream-reasoning pre");
        if (!pre) return null;
        const det = pre.closest("details");
        return { len: pre.textContent.length, offen: det.open, sichtbar: pre.getBoundingClientRect().height > 0, body: (document.querySelector(".okit-chat-turn.is-assistant .okit-stream-body")?.textContent ?? "").trim().length };
      `);
      if (pr !== null) proben.push(pr);
      await sleep(250);
    }
    await pollUntil<boolean>(c.cdp, `const s = document.querySelector(".okit-chat-send"); return s && s.textContent === "Send" ? true : null;`, 25_000, 300).catch(() => undefined);
    if (proben.length < 3) { unmeasured(pn("P22"), `nur ${proben.length} Probe(n) mit Denkblock im Strom`); return; }
    const langen = proben.map((x) => x.len);
    const waechst = langen.every((l, i) => i === 0 || l >= langen[i - 1]!) && langen[langen.length - 1]! > langen[0]!;
    const sichtbar = proben.every((x) => x.offen && x.sichtbar);
    const vorAntwort = proben[0]!.body === 0;
    record(pn("P22"), waechst && sichtbar && vorAntwort, `${proben.length} Proben, Laenge ${langen.join(" → ")} · offen und sichtbar: ${String(sichtbar)} · beim ersten Probepunkt noch keine Antwort: ${String(vorAntwort)}`);
  } finally {
    await stub.stop();
  }
}

/** Welle 24 — Denkblock kopierbar (Kit 0.63.0) und die §3a-Pflichtpunkte am Chat. EIN Strom mit langem Denken und Text: im Strom wird der
 *  Kopier-Knopf geprueft (erst ablehnende, dann aufzeichnende Zwischenablage) und ins Eingabefeld getippt; nach dem Ende misst
 *  `messeFokusFenster`, ob der Schluss-Draw den Fokus liess. Danach, im Ruhezustand, die Gegenprobe zum Fokus; die Erreichbarkeit ist hier nicht
 *  anwendbar (siehe unten). */
async function p26(c: Ctx): Promise<void> {
  const stub = await startLlmStub({
    models: [FAKE_MODEL], takt: 150, nachlaufMs: 6000,
    standard: { reasoning: "Ich ueberlege Schritt fuer Schritt, was zu tun ist. ".repeat(12), laenge: 40, text: "Fertig. " + "Noch ein Satz zur Antwort. ".repeat(6) },
  });
  try {
    await chatSenden(c, "SMOKE-KOPIE bitte nachdenken", stub.url);
    const da = await pollUntil<boolean>(c.cdp, `
      const pre = document.querySelector(".okit-chat-turn.is-assistant .okit-stream-reasoning pre");
      return pre && pre.textContent.length > 30 ? true : null;`, 15_000, 100).catch(() => null);
    if (!da) {
      for (const n of ["P26", "P27", "P28"] as const) unmeasured(pn(n), "der Denktext erreichte im Strom nie 30 Zeichen");
    } else {
      // Mutation JETZT, im Strom: Fokus ins Feld, tippen, Auslöser feuern. Gemessen wird erst nach dem Ende (Schluss-Draw).
      const m = await c.cdp.evaluate<{ ok: boolean }>(fokusMutationSkript({ selector: ".okit-chat-input", text: "abc" }));
      // Kopier-Knopf samt Gegenprobe: die Bausteine der Brücke (erst aufzeichnende, dann ablehnende Zwischenablage), Selektoren des Chat-Zugs.
      zeichneDenkblock({ record, unmeasured }, { kopie: pn("P26"), gegen: pn("P27") }, await messeDenkblockKopierbar(c.cdp, {
        block: ".okit-chat-turn.is-assistant .okit-stream-reasoning",
        knopf: ".okit-chat-turn.is-assistant .okit-stream-reasoning-copy",
        enthaelt: "ueberlege",
        erwartetKnopf: true,
      }));
      await pollUntil<boolean>(c.cdp, `const s = document.querySelector(".okit-chat-send"); return s && s.textContent === "Send" ? true : null;`, 25_000, 300).catch(() => undefined);
      if (!m.ok) unmeasured(pn("P28"), "kein .okit-chat-input im DOM");
      else {
        zeichnePflicht({ record, unmeasured }, pn("P28"), await messeFokusFenster(c.cdp, { selector: ".okit-chat-input", text: "abc" }));
        await c.cdp.evaluate(fokusAufraeumSkript(".okit-chat-input"));
      }
    }
    // Ruhezustand: der Strom ist zu Ende.
    await pollUntil<boolean>(c.cdp, `const s = document.querySelector(".okit-chat-send"); return s && s.textContent === "Send" ? true : null;`, 25_000, 300).catch(() => undefined);
    zeichnePflicht({ record, unmeasured }, pn("P29"), await gegenprobeFokus(c.cdp, { selector: ".okit-chat-input", text: "abc" }));
    // Erreichbarkeit: Messung mit gefülltem Verlauf, Gegenprobe zuerst mit `wachsen` (der Verlauf wächst statt zu rollen und drückt Eingabefeld und
    // Senden aus dem Panel). Bleibt auch sie blind, ist das Opt-out begründet; wird sie einmal wirksam, zählen P30 und P31 wieder.
    const erreichbar = {
      selektoren: [".okit-chat-send", ".okit-chat-input", ".okit-chat-new", ".okit-model-bar-select"],
      fuelle: { in: ".okit-chat-log" },
      erforderlich: [".okit-chat-send", ".okit-chat-input"],
    };
    const messung = await messeErreichbarkeit(c.cdp, erreichbar);
    const gegen = await gegenprobeErreichbarkeit(c.cdp, { ...erreichbar, scrollen: false, art: "wachsen" });
    if (messung.urteil === "gruen" && gegen.urteil === "rot" && gegen.detail.includes("die Probe sieht den Defekt nicht")) {
      const grund = `Eingabefeld, Senden, Neu und Modellzeile sitzen ausserhalb des Rollbereichs .okit-chat-log; auch mit der Bauart wachsen macht die Gegenprobe kein Element unerreichbar, die Probe koennte nie rot werden. Messung: ${messung.detail}. Gegenprobe: ${gegen.detail}`;
      optOutPflicht({ record, unmeasured, skipped }, pn("P30"), grund);
      optOutPflicht({ record, unmeasured, skipped }, pn("P31"), grund);
    } else {
      zeichnePflicht({ record, unmeasured }, pn("P30"), messung);
      zeichnePflicht({ record, unmeasured }, pn("P31"), gegen);
    }
  } finally {
    await stub.stop();
  }
}

// ---------------------------------------------------------------------------------------------
// Welle 26: Chat-Fenster und Modellzeile des Kits (obsidian-kit 0.67.0)
// ---------------------------------------------------------------------------------------------

const ANTWORT_FERTIG = `const s = document.querySelector(".okit-chat-send"); return s && s.textContent === "Send" ? true : null;`;
const warteAufFertig = (c: Ctx): Promise<boolean | null> => pollUntil<boolean>(c.cdp, ANTWORT_FERTIG, 25_000, 300).catch(() => null);

/** Das Modell der ersten Endpunkt-Zeile aus der data.json auf Platte (die Zeile, die die Modellzeile schreibt). */
async function zeilenModell(c: Ctx): Promise<string | null> {
  const r = await c.cdp.evaluate<{ m: string | null }>(`
    try {
      const d = JSON.parse(await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${q(PLUGIN_ID)} + "/data.json"));
      return { m: d.endpoints && d.endpoints[0] ? (d.endpoints[0].model ?? "") : null };
    } catch { return { m: null }; }
  `);
  return r.m;
}

async function p32(c: Ctx): Promise<void> {
  await chatVorbereiten(c);
  const ok = await pollUntil<{ ok: boolean }>(c.cdp, `const s = document.querySelector(".okit-chat-header .okit-model-bar-select"); return s && s.options.length >= 3 ? { ok: true } : null;`, 10_000, 250).catch(() => null);
  if (!ok) { unmeasured(pn("P32"), "die Modellzeile im Kopf des Chats zeigt nach 10 s keine Modell-Liste (weniger als drei Eintraege: Automatisch und zwei Modelle)"); return; }
  const zeile = await c.cdp.evaluate<{ label: string; opts: Array<{ v: string; t: string }>; denk: boolean; warn: boolean; alt: number }>(`
    const bar = document.querySelector(".okit-chat-header .okit-model-bar");
    const sel = bar.querySelector(".okit-model-bar-select");
    return {
      label: (bar.querySelector(".okit-model-bar-label") || {}).textContent || "",
      opts: Array.from(sel.options).map((o) => ({ v: o.value, t: o.textContent || "" })),
      denk: !!bar.querySelector(".okit-thinking-control"),
      warn: !!bar.querySelector(".okit-model-bar-warn:not(.is-hidden)"),
      alt: document.querySelectorAll(".okit-chat-header button").length,
    };
  `);
  const beide = [FAKE_MODEL, FAKE_MODEL_2].every((m) => zeile.opts.some((o) => o.v === m));
  const vorher = await zeilenModell(c);
  // Wechsel im Dropdown, wie ein Nutzer: Wert setzen, change melden.
  await c.cdp.evaluate(`const sel = document.querySelector(".okit-chat-header .okit-model-bar-select"); sel.value = ${q(FAKE_MODEL_2)}; sel.dispatchEvent(new Event("change", { bubbles: true })); return { ok: true };`);
  const geschrieben = await pollUntil<{ m: string }>(c.cdp, `
    const d = JSON.parse(await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${q(PLUGIN_ID)} + "/data.json"));
    const m = d.endpoints && d.endpoints[0] ? d.endpoints[0].model : "";
    return m === ${q(FAKE_MODEL_2)} ? { m } : null;`, 8000, 300).catch(() => null);
  const vor = c.fake.bodies.length;
  await chatAbsenden(c, "Which model answers?");
  const bis = Date.now() + 20_000;
  while (c.fake.bodies.length <= vor && Date.now() < bis) await sleep(250);
  await warteAufFertig(c);
  let gesendet = "";
  try { gesendet = String((JSON.parse(c.fake.bodies[c.fake.bodies.length - 1] ?? "{}") as { model?: string }).model ?? ""); } catch { gesendet = ""; }
  // Zurueck auf das erste Modell, damit spaetere Punkte vom Ausgangszustand ausgehen (sie setzen die Zeile ohnehin selbst).
  await c.cdp.evaluate(`const sel = document.querySelector(".okit-chat-header .okit-model-bar-select"); if (sel) { sel.value = ${q(FAKE_MODEL)}; sel.dispatchEvent(new Event("change", { bubbles: true })); } return { ok: true };`);
  record(pn("P32"), zeile.label === "Chat" && beide && zeile.denk && !zeile.warn && vorher === FAKE_MODEL && geschrieben !== null && gesendet === FAKE_MODEL_2,
    `Zeile „${zeile.label}“, Eintraege [${zeile.opts.map((o) => `${o.v === "" ? "<leer>" : o.v}=„${o.t}“`).join("; ")}] · beide Modelle da: ${String(beide)} · Denk-Steuerung in der Zeile: ${String(zeile.denk)} (Knoepfe im Kopf insgesamt ${zeile.alt}) · Warnzeichen: ${String(zeile.warn)} · Zeile vorher „${String(vorher)}“, nach dem Wechsel auf Platte: ${geschrieben ? `„${geschrieben.m}“` : "NICHT geschrieben"} · Anfrage am Server traegt model „${gesendet}“`);
}

/** P33 und P34 teilen sich einen langsamen Strom: erst die Sperre messen, dann mit Escape abbrechen. */
async function p33p34(c: Ctx): Promise<void> {
  const stub = await startLlmStub({ models: [FAKE_MODEL, FAKE_MODEL_2], takt: STROM_TAKT * 4, nachlaufMs: 0, standard: { text: STROM_TEXT, laenge: STROM_LAENGE } });
  try {
    await chatSenden(c, "SMOKE-ESCAPE lange Antwort", stub.url);
    const laeuft = await pollUntil<boolean>(c.cdp, `const b = document.querySelector(".okit-chat-turn.is-assistant .okit-stream-body"); return b && (b.textContent || "").length > 20 ? true : null;`, 20_000, 150).catch(() => null);
    if (!laeuft) { for (const n of ["P33", "P34"] as const) unmeasured(pn(n), "der Strom kam nicht in Gang (kein Antworttext nach 20 s)"); return; }
    const im = await c.cdp.evaluate<{ select: boolean; reload: boolean; senden: string }>(`
      const bar = document.querySelector(".okit-chat-header .okit-model-bar");
      const knoepfe = Array.from(bar.querySelectorAll("button"));
      return { select: bar.querySelector(".okit-model-bar-select").disabled === true, reload: knoepfe.length > 0 && knoepfe.some((b) => b.disabled === true), senden: document.querySelector(".okit-chat-send").textContent };
    `);
    // Escape in der Eingabe, wie ein Nutzer.
    const vorGeschlossen = stub.zaehler().clientGeschlossen;
    await c.cdp.evaluate(`document.querySelector(".okit-chat-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return { ok: true };`);
    const frei = await warteAufFertig(c);
    await sleep(500);
    const nach = await c.cdp.evaluate<{ select: boolean; aborted: string; senden: string; status: string }>(`
      const bar = document.querySelector(".okit-chat-header .okit-model-bar");
      const a = document.querySelector(".okit-chat-turn.is-assistant .okit-chat-aborted");
      return { select: bar.querySelector(".okit-model-bar-select").disabled === true, aborted: a ? a.textContent : "", senden: document.querySelector(".okit-chat-send").textContent, status: (document.querySelector(".okit-chat-status") || {}).textContent || "" };
    `);
    const serverSahAbbruch = stub.zaehler().clientGeschlossen > vorGeschlossen;
    record(pn("P33"), im.select && im.reload && im.senden === "Stop" && !nach.select,
      `im Lauf: Dropdown gesperrt ${String(im.select)}, Neu-laden gesperrt ${String(im.reload)}, Knopf „${im.senden}“ · nach dem Abbruch: Dropdown gesperrt ${String(nach.select)}`);
    record(pn("P34"), frei === true && nach.aborted === "Stopped." && nach.senden === "Send" && serverSahAbbruch,
      `Senden nach Escape wieder „${nach.senden}“ (frei ${String(frei)}), Zeile unter der Antwort „${nach.aborted}“, Statuszeile „${nach.status}“ · Server sah die geschlossene Verbindung: ${String(serverSahAbbruch)} (${vorGeschlossen} → ${stub.zaehler().clientGeschlossen})`);
  } finally {
    await stub.stop();
  }
}

async function p35(c: Ctx): Promise<void> {
  const GRUND = "model crashed in smoke";
  const stub = await startLlmStub({
    models: [FAKE_MODEL],
    antwort: (_a, n) => (n === 1 ? { status: 500, fehler: GRUND } : { text: "Wieder da.", teile: 2, model: FAKE_MODEL }),
  });
  try {
    await chatSenden(c, "SMOKE-FEHLER erste Frage", stub.url);
    const fehler = await pollUntil<{ text: string; retry: string }>(c.cdp, `
      const e = document.querySelector(".okit-chat-turn.is-assistant .okit-chat-error, .okit-chat-note .okit-chat-error");
      const r = document.querySelector(".okit-chat-retry");
      return e && r ? { text: e.textContent || "", retry: r.textContent || "" } : null;`, 20_000, 250).catch(() => null);
    if (!fehler) { unmeasured(pn("P35"), "nach 20 s keine Fehlerzeile mit „Send again“"); return; }
    const vor = stub.anfragen().filter((a) => a.route === "chat").length;
    await c.cdp.evaluate(`document.querySelector(".okit-chat-retry").click(); return { ok: true };`);
    const wieder = await pollUntil<{ text: string; fehler: number; retry: number }>(c.cdp, `
      const t = Array.from(document.querySelectorAll(".okit-chat-turn.is-assistant")).map((x) => x.textContent || "").join(" ");
      return t.includes("Wieder da.") ? { text: t, fehler: document.querySelectorAll(".okit-chat-error").length, retry: document.querySelectorAll(".okit-chat-retry").length } : null;`, 20_000, 250).catch(() => null);
    const chat = stub.anfragen().filter((a) => a.route === "chat");
    const zweite = chat[1];
    let nutzer = -1;
    try { nutzer = ((JSON.parse(zweite?.body ?? "{}") as { messages?: Array<{ role: string }> }).messages ?? []).filter((m) => m.role === "user").length; } catch { nutzer = -1; }
    record(pn("P35"), fehler.text.includes("HTTP 500") && fehler.text.includes(GRUND) && fehler.retry === "Send again" && wieder !== null && wieder.fehler === 0 && wieder.retry === 0 && chat.length === vor + 1 && nutzer === 1,
      `Fehlerzeile „${fehler.text.slice(0, 160)}“ (HTTP 500 ${String(fehler.text.includes("HTTP 500"))}, Begruendung des Servers ${String(fehler.text.includes(GRUND))}) · Knopf „${fehler.retry}“ · nach dem Klick: Antwort ${wieder ? "da" : "FEHLT"}, Fehlerzeile weg ${String(wieder?.fehler === 0)}, Knopf weg ${String(wieder?.retry === 0)} · Server sah ${chat.length} Anfrage(n), die zweite mit ${nutzer} Nutzernachricht(en)`);
  } finally {
    await stub.stop();
  }
}

async function p36(c: Ctx): Promise<void> {
  const stub = await startLlmStub({
    models: [FAKE_MODEL], takt: 200, nachlaufMs: 400,
    standard: { reasoning: "Ich ueberlege Schritt fuer Schritt, was zu tun ist. ".repeat(6), laenge: 40, text: "Fertig. Und noch ein Satz." },
  });
  try {
    await chatSenden(c, "SMOKE-ZUKLAPPEN bitte nachdenken", stub.url);
    const offen = await pollUntil<boolean>(c.cdp, `
      const d = document.querySelector(".okit-chat-turn.is-assistant details.okit-stream-reasoning");
      return d && d.open && (d.textContent || "").length > 20 ? true : null;`, 15_000, 100).catch(() => null);
    if (!offen) { unmeasured(pn("P36"), "kein offener Denkblock im Strom gesehen — „klappt zu“ waere ohne Ausgangslage nichts wert"); return; }
    await warteAufFertig(c);
    await sleep(600);
    const nach = await c.cdp.evaluate<{ da: boolean; offen: boolean; summary: string; text: string }>(`
      const d = document.querySelector(".okit-chat-turn.is-assistant details.okit-stream-reasoning");
      return { da: !!d, offen: !!(d && d.open), summary: d ? (d.querySelector("summary") || {}).textContent || "" : "", text: d ? (d.querySelector("pre") || {}).textContent || "" : "" };
    `);
    record(pn("P36"), nach.da && !nach.offen && nach.text.includes("ueberlege"),
      `im Strom offen: ${String(offen)} · nach der Antwort: Block da ${String(nach.da)}, offen ${String(nach.offen)}, Zeile „${nach.summary.slice(0, 40)}“, Denktext erhalten ${String(nach.text.includes("ueberlege"))}`);
  } finally {
    await stub.stop();
  }
}

async function p37(c: Ctx): Promise<void> {
  await chatRunde(c, "SMOKE-LINKS please list links");
  const links = await c.cdp.evaluate<Array<{ t: string; h: string | null }>>(`
    return Array.from(document.querySelectorAll(".okit-chat-turn.is-assistant .okit-stream-block a")).map((a) => ({ t: a.textContent || "", h: a.getAttribute("href") }));
  `);
  const von = (t: string) => links.find((l) => l.t === t);
  const gekappt = ["a-js", "b-data", "c-obs", "d-file"].map((t) => ({ t, link: von(t) }));
  // Nicht vakuum: jeder Anker muss existieren (sonst waere „ohne href“ ein Bild, das die Antwort nie hatte), der https-Link seinen href behalten.
  const alleDa = gekappt.every((x) => x.link !== undefined);
  const ok = von("e-ok");
  record(pn("P37"), alleDa && gekappt.every((x) => x.link?.h === null || x.link?.h === undefined) && ok?.h === "https://example.org/ok",
    `Anker im Antworttext: ${links.map((l) => `${l.t} -> ${String(l.h)}`).join("; ")} · alle vier Anker da: ${String(alleDa)}`);
}

/** Der Haken `installTabRefreshOnOpen` trägt nur, solange er installiert bleibt (Vertrag in `settings_walker.ts`, Welle 27): `hide()` baut ihn nicht ab, `onunload` über `dispose()`.
 *  Gemessen wird, wie oft der Tab sich beim Öffnen neu aufbaut (Zähler um `renderImperative`); die Gegenprobe ruft `dispose()` selbst und öffnet erneut, dann darf
 *  kein Neuaufbau mehr kommen — sonst zählte der Zähler nichts. Danach lädt der Punkt das Plugin neu, damit der Tab wieder einen Haken hat. */
async function p38(c: Ctx): Promise<void> {
  const oeffnen = async (): Promise<number> => {
    await schliesseEinstellungen(c.cdp);
    await warteAufGeschlosseneSettings(c.port);
    return c.cdp.evaluate<number>(`
      const tab = app.setting.pluginTabs.find((t) => t.id === ${q(PLUGIN_ID)});
      if (!tab) return -1;
      if (!tab.__zaehler) { tab.__zaehler = { n: 0 }; const orig = tab.renderImperative.bind(tab); tab.renderImperative = (...a) => { tab.__zaehler.n++; return orig(...a); }; }
      app.setting.open();
      await new Promise((r) => setTimeout(r, 400));
      app.setting.openTabById(${q(PLUGIN_ID)});
      await new Promise((r) => setTimeout(r, 1000));
      return tab.__zaehler.n;
    `);
  };
  const n1 = await oeffnen();
  const n2 = await oeffnen();
  const n3 = await oeffnen();
  if (n1 < 0) { unmeasured(pn("P38"), "Einstellungs-Tab des Plugins nicht gefunden (app.setting.pluginTabs)"); return; }
  // Gegenprobe: den Haken abbauen (das tut onunload) und noch einmal öffnen.
  await c.cdp.evaluate(`app.setting.pluginTabs.find((t) => t.id === ${q(PLUGIN_ID)}).dispose(); return true;`);
  const n4 = await oeffnen();
  await schliesseEinstellungen(c.cdp);
  await c.cdp.evaluate(`await app.plugins.disablePlugin(${q(PLUGIN_ID)}); await app.plugins.enablePlugin(${q(PLUGIN_ID)}); await new Promise((r) => setTimeout(r, 800)); return true;`);
  const jedesMal = n2 - n1 >= 1 && n3 - n2 >= 1 && n1 >= 1;
  const gegenprobeOk = n4 === n3;
  record(pn("P38"), jedesMal && gegenprobeOk,
    `Neuaufbauten nach dem 1./2./3. Oeffnen: ${n1}/${n2}/${n3}, nach dispose() und erneutem Oeffnen ${n4} (Gegenprobe ${gegenprobeOk ? "wirkt: kein Neuaufbau" : "wirkt NICHT: der Zaehler zaehlt auch ohne Haken"})`);
}

interface DvLauf { block: string; inline: string; geladen: boolean; version: string; js: boolean; inlineJs: boolean; html: string }

/** Marker leeren, Markdown mit dem NACKTEN Renderer in ein angehaengtes Element rendern (so laufen die Prozessoren aller Plugins), Marker lesen.
 *  `require("obsidian")` gibt es im Renderer nicht; den nackten Renderer des Plugins (`MarkdownRenderer.render(app, md, el, "", host)`, ohne
 *  Neutralisierer und ohne den domGuard des Kit-Fensters) liefert die Chat-Ansicht als `deps.renderMarkdown`. */
async function dvRendere(c: Ctx, md: string): Promise<DvLauf> {
  return c.cdp.evaluate<DvLauf>(`
    delete window.${DV_BLOCK}; delete window.${DV_INLINE};
    const dv = app.plugins.plugins[${q(DATAVIEW_ID)}];
    const typ = ${q("settings-assistant-chat")};
    if (!app.workspace.getLeavesOfType(typ).length) {
      app.commands.executeCommandById(${q(`${PLUGIN_ID}:open-chat`)});
      await new Promise((r) => setTimeout(r, 1500));
    }
    const view = app.workspace.getLeavesOfType(typ)[0]?.view;
    if (!view || !view.deps || typeof view.deps.renderMarkdown !== "function") throw new Error("keine Chat-Ansicht mit deps.renderMarkdown");
    const host = document.body.createDiv();
    await view.deps.renderMarkdown(host, ${q(md)});
    await new Promise((r) => setTimeout(r, 2500));
    const r = {
      block: String(window.${DV_BLOCK}), inline: String(window.${DV_INLINE}),
      geladen: !!dv, version: dv ? dv.manifest.version : "", js: !!(dv && dv.settings.enableDataviewJs), inlineJs: !!(dv && dv.settings.enableInlineDataviewJs),
      html: host.innerHTML.replace(/\\s+/g, " ").slice(0, 160),
    };
    host.remove();
    return r;
  `);
}

let dvGegenprobeAn: boolean | null = null;

async function d2(c: Ctx): Promise<void> {
  const r = await dvRendere(c, DV_ANSWER);
  dvGegenprobeAn = r.geladen && r.block === "1" && r.inline === "1";
  record(dn("D2"), dvGegenprobeAn,
    `Dataview ${r.geladen ? r.version : "NICHT geladen"} (JS-Abfragen ${String(r.js)}, Inline-JS ${String(r.inlineJs)}) · Marker Block ${r.block}, Inline ${r.inline} (verlangt: beide 1) · Rendering: ${r.html}`);
}

function dvVoraussetzung(): void {
  if (dvGegenprobeAn !== true) throw new Vorbedingung("die Gegenprobe D2 schlug nicht an: Dataview-JS laeuft in dieser Instanz nicht, die Messung waere blind");
}

async function d1(c: Ctx): Promise<void> {
  dvVoraussetzung();
  await c.cdp.evaluate(`delete window.${DV_BLOCK}; delete window.${DV_INLINE}; return { ok: true };`);
  await chatRunde(c, "SMOKE-DATAVIEW please");
  const d = await c.cdp.evaluate<{ block: string; inline: string; text: string; aktiv: number }>(`
    const turn = document.querySelector(".okit-chat-log .okit-chat-turn.is-assistant");
    return {
      block: String(window.${DV_BLOCK}), inline: String(window.${DV_INLINE}),
      text: turn ? turn.textContent ?? "" : "",
      aktiv: document.querySelectorAll(".okit-chat-log [class*='block-language-'], .okit-chat-log .dataview").length,
    };
  `);
  // Nicht vakuum: die Antwort muss gerendert dastehen (als Text), sonst waere „Marker leer“ nur eine leere Seite.
  const sichtbar = d.text.includes("dataviewjs") && d.text.includes("$=") && d.text.includes("ˋ");
  record(dn("D1"), d.block === "undefined" && d.inline === "undefined" && d.aktiv === 0 && sichtbar,
    `Marker Block ${d.block}, Inline ${d.inline} (verlangt: beide undefined) · Dataview-Elemente im Chat ${d.aktiv} · Antwort als Text sichtbar ${String(sichtbar)}`);
}

async function d3(c: Ctx): Promise<void> {
  dvVoraussetzung();
  const neutral = neutralizeModelMarkdown(DV_ANSWER);
  const ohneZaun = !neutral.includes("`");
  const r = await dvRendere(c, neutral);
  record(dn("D3"), ohneZaun && r.block === "undefined" && r.inline === "undefined",
    `Text ohne Backtick ${String(ohneZaun)} · Marker Block ${r.block}, Inline ${r.inline} (verlangt: beide undefined) · Rendering: ${r.html}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("setup")) { setupVault(); console.log("\nDen Vault in der Zweitinstanz oeffnen, dann: npm run smoke:gui -- --port <PORT>"); return; }
  const port = Number(args.value("port"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port <1024-65535> ist Pflicht (kein Standardport: 9222 gehoert der regulaeren Instanz). Beispiel: npm run smoke:gui -- --launch --port <PORT>");
  }

  const launch = args.has("launch");
  const fake = await startFakeEndpoint();
  let inst: Instanz | null = null;
  let zustand: { schliesse(): Promise<void> } | null = null;
  let cdp: Cdp | null = null;
  const warnungen: string[] = [];
  try {
    if (launch) {
      const vaultDir = setupVault();
      const gestartet = startInstanz(vaultDir, port);
      inst = gestartet;
      // Vor der ersten Messung anmelden: ein Ctrl-C beendet die eigene Zweitinstanz (nur diese PID), statt sie stehen zu lassen.
      zustand = beimAbbruch(() => stopInstanz(gestartet), "Zweitinstanz beenden");
    }
    cdp = await warteAufFenster(port, launch ? 60_000 : 5000);
    await cdp.mitschnitt((z) => { if (/EXCEPTION/.test(z)) warnungen.push(`Renderer: ${z.slice(0, 300)}`); });
    await requireVisible(cdp).catch((e: unknown) => { warnungen.push(`requireVisible: ${(e as Error).message.split("\n")[0]}`); });
    console.log(`Vorbereitung: ${await bereiteVor(cdp)}`);
    const v = await cdp.evaluate<{ name: string; basePath: string; configDir: string; ver: string }>(`return { name: app.vault.getName(), basePath: app.vault.adapter.basePath, configDir: app.vault.configDir, ver: (document.title.match(/Obsidian ([\\d.]+)/) || [])[1] || "?" };`);
    console.log(`Vault: ${v.name} (${v.basePath}), Obsidian ${v.ver}`);
    requireEigenerBuild(join(v.basePath, v.configDir, "plugins", PLUGIN_ID, "main.js"), join(REPO_ROOT, "main.js"), (m) => warnungen.push(m));
    // Vorzustand: Schnappschuesse frueherer Laeufe zaehlt P13 sonst mit (7 statt 1, gemessen Welle 22; CORE-TEST-21). Nur der
    // Ordner des Plugins im Staging-Vault, im Prozess des Treibers (der Vault ist Wegwerfware, `setupVault` raeumt ihn ebenso).
    rmSync(join(v.basePath, v.configDir, "plugins", PLUGIN_ID, "snapshots"), { recursive: true, force: true });
    // Die Oberflaeche muss Englisch sein, sonst messen die Textvergleiche die Sprache statt das Plugin.
    const lang = await cdp.evaluate<{ l: string }>(`return { l: (window.moment ? window.moment.locale() : "?") };`);
    if (lang.l !== "en") warnungen.push(`Oberflaechensprache ist „${lang.l}“, nicht „en“ — Textvergleiche koennen rot werden`);

    const ctx: Ctx = { cdp, port, fake };
    if (!(await pruefeGrundlage(ctx))) {
      console.log("\nGrundlage fehlt — kein Punkt kann gemessen werden.");
    } else {
      await closeExtraLeaves(cdp).catch(() => 0);
      const reihe: Array<[PunktName | (typeof DV_PUNKTE)[number], (c: Ctx) => Promise<void>]> = MIT_DATAVIEW ? [[dn("D2"), d2], [dn("D1"), d1], [dn("D3"), d3]] : [
        [pn("P1"), p1], [pn("P2"), p2], [pn("P13"), p13], [pn("P7"), p7], [pn("P14"), p14],
        [pn("P3"), p3], [pn("P4"), p4], [pn("P5"), p5], [pn("P11"), p11], [pn("P6"), p6],
        [pn("P9"), p9], [pn("P10"), p10], [pn("P8"), p8p12], [pn("P15"), p15], [pn("P16"), p16], [pn("P17"), p17], [pn("P18"), p18], [pn("P19"), p19], [pn("P20"), p20], [pn("P21"), p21], [pn("P22"), p22], [pn("P23"), p23], [pn("P25"), p25], [pn("P26"), p26],
        [pn("P32"), p32], [pn("P33"), p33p34], [pn("P35"), p35], [pn("P36"), p36], [pn("P37"), p37], [pn("P38"), p38],
      ];
      for (const [name, fn] of reihe) {
        await schliesseDialoge(cdp);
        await punkt(name, () => fn(ctx));
      }
      // P12 wird in p8p12 mitgemessen; scheitert p8p12 vorher, bleibt es „nichts gemessen“ (siehe Bilanz).
    }
  } finally {
    if (cdp && !istAbgebrochen()) {
      await schliesseDialoge(cdp);
      const n = await closeExtraLeaves(cdp).catch(() => 0);
      console.log(`\nAufgeraeumt: ${n} Leaves. Notices: ${await notices(cdp).catch(() => "?")}`);
      cdp.close();
    }
    if (!istAbgebrochen()) await fake.close();
    await zustand?.schliesse();
    // Nach Ctrl-C druckt das Modul die Bilanz und beendet den Prozess selbst.
    if (istAbgebrochen()) return;
  }

  abschluss();
  for (const w of warnungen) console.log(`WARNUNG: ${w}`);
}

runDriver(main);
