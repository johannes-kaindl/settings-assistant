/**
 * Layout-Messung des Chats am Handy (Welle 29): Mobil-Emulation 390 × 844 (Faktor 2) mit und ohne die Höhe einer iOS-Tastatur,
 * Standardtheme hell und dunkel, Bild und Maße je Zustand. Misst die vier Kriterien (a) bis (d) der Daumen-Probe an der Sache:
 * Abstand der Knopfreihe zum unteren Rand (a), Höhe des Antwortbereichs in Zeilen (b), Zeilen von Plugin-Chip und Dropdown (c),
 * Zustand und Ort von „Gesendeter Kontext“ (d). Der Treiber startet und beendet seine Zweitinstanz selbst (nur die eigene PID).
 *
 * ```bash
 * npm run build
 * lsof -nP -iTCP:<PORT> -sTCP:LISTEN
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label settings-assistant --intent "chat-layout <tag>" --exclusive focus --port <PORT> --ttl 300
 * npm run chat-layout -- --port <PORT> --tag vorher [--out /tmp/saw-w29]
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 * ```
 *
 * Grenze: die Emulation verkleinert den Viewport um die Tastaturhöhe (iOS-Tastatur mit Vorschlagsleiste rund 336 pt); sie ersetzt
 * weder das Verhalten von WKWebView noch die Schublade von Obsidian Mobile am Gerät.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { argv, cwd, exit } from "node:process";

import { Cdp, attachTo, bereiteInstanzVor, requireVisible } from "../../tools/obsidian-cdp/cdp.js";
import { startLlmStub } from "../../tools/obsidian-cdp/llm-stub.js";
import { capture } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "settings-assistant";
const PLUGIN_ID = "settings-assistant";
const DEMO_ID = "quick-capture";
const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "docs/images/fixture");
const PROFILE_BASE = "/tmp/obs-test-settings-assistant";
const OBSIDIAN_BIN = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const FAKE_MODEL = "local-model";
const BREITE = 390;
const HOEHE = 844;
/** iOS-Tastatur mit Vorschlagsleiste, iPhone 6,1 Zoll, hochkant. */
const TASTATUR = 336;

const q = (s: string): string => JSON.stringify(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const CHAT_PROFILE = {
  version: 1,
  plugins: { [DEMO_ID]: { autoSaveSeconds: 15, openAfterCapture: false } },
  notes: {
    [`plugins.${DEMO_ID}.autoSaveSeconds`]: "Saves every 15 seconds, so a crash loses little.",
    [`plugins.${DEMO_ID}.openAfterCapture`]: "Keeps the note you are writing in front.",
  },
};
const CHAT_ANSWER = [
  "Quick Capture saves a new capture every 60 seconds and opens it afterwards. Here is a profile that saves every 15 seconds and keeps your current note in front:",
  "",
  "```settings-profile",
  JSON.stringify(CHAT_PROFILE, null, 2),
  "```",
].join("\n");

interface FakeEndpoint { url: string; close: () => Promise<void> }
/** Der zentrale Stub (`tools/obsidian-cdp/llm-stub.ts`) streamt die feste Antwort in zwei Haelften. */
async function startFakeEndpoint(): Promise<FakeEndpoint> {
  // Fester Port statt Zufall, damit die Adresse im Bild immer gleich aussieht. NICHT 1234: dort haelt LM Studio einen Wildcard-Bind,
  // und ein spezifischer Bind daneben gelingt trotzdem — Anfragen landeten dann beim Fake, aber nur dank Bind-Reihenfolge. Ist der Port belegt, ein freier.
  const optionen = { models: [FAKE_MODEL], standard: { text: CHAT_ANSWER, teile: 2, model: FAKE_MODEL } };
  const stub = await startLlmStub({ ...optionen, port: 8765 }).catch(() => startLlmStub({ ...optionen, port: 0 }));
  return { url: stub.url, close: () => stub.stop() };
}

// --- Vault und Instanz ---------------------------------------------------------------------------

function setupVault(): string {
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: FIXTURE_DIR, pluginId: PLUGIN_ID });
  console.log(`Layout-Vault gebaut: ${vaultDir}`);
  for (const l of log) console.log(`  · ${l}`);
  // `buildVault` raeumt nur data.json des Plugins — Schnappschuesse und Demo-Plugin ueberleben sonst jeden Abbruch.
  rmSync(join(vaultDir, ".obsidian/plugins", PLUGIN_ID, "snapshots"), { recursive: true, force: true });
  const demoDir = join(vaultDir, ".obsidian/plugins", DEMO_ID);
  rmSync(demoDir, { recursive: true, force: true });
  mkdirSync(demoDir, { recursive: true });
  for (const f of ["manifest.json", "main.js"]) copyFileSync(join(FIXTURE_DIR, "plugins", DEMO_ID, f), join(demoDir, f));
  const probeDir = join(vaultDir, ".obsidian/plugins", "sa-probe");
  rmSync(probeDir, { recursive: true, force: true });
  mkdirSync(probeDir, { recursive: true });
  for (const f of ["manifest.json", "main.js"]) copyFileSync(join(REPO_ROOT, "fixtures/plugins/sa-probe", f), join(probeDir, f));
  writeFileSync(join(demoDir, "data.json"), JSON.stringify({
    captureFolder: "Captures",
    autoSaveSeconds: 60,
    openAfterCapture: true,
    showRibbonIcon: true,
    apiKey: "sk-demo-0000",
  }, null, 2));
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
  if (pgrepProfile(ud) !== "") ud = `${PROFILE_BASE}-w29`;
  if (pgrepProfile(ud) !== "") throw new Error(`Auch ${ud} wird von einer fremden Instanz gehalten — Abbruch (nichts beendet).`);
  mkdirSync(ud, { recursive: true });
  // Oberflaeche Englisch: obsidian.json UND localStorage (das zweite setzt `bereiteVor`).
  writeFileSync(join(ud, "obsidian.json"), JSON.stringify({ vaults: { [REPO_NAME]: { path: vaultDir, ts: Date.now(), open: true } }, language: "en" }));
  for (const f of readdirSync(ud)) if (/^obsidian-.*\.asar$/.test(f)) rmSync(join(ud, f));
  const asar = neuesteAsar();
  if (asar) copyFileSync(asar, join(ud, asar.split("/").pop() ?? "obsidian.asar"));
  else console.warn("WARNUNG: keine obsidian-*.asar im regulaeren Profil — es laeuft die gebuendelte Version.");
  const child = spawn(OBSIDIAN_BIN, [`--user-data-dir=${ud}`, `--remote-debugging-port=${port}`, "-AppleLanguages", "(en)"], { stdio: "ignore" });
  console.log(`Zweitinstanz gestartet: PID ${child.pid ?? "?"}, Profil ${ud}, Port ${port}`);
  return { child, ud };
}
async function stopInstanz(inst: Instanz): Promise<void> {
  const exited = new Promise<void>((resolve) => { inst.child.once("exit", () => { resolve(); }); });
  if (inst.child.exitCode === null) inst.child.kill("SIGTERM");
  await Promise.race([exited, sleep(8000)]);
  if (inst.child.exitCode === null && inst.child.signalCode === null) { inst.child.kill("SIGKILL"); await Promise.race([exited, sleep(4000)]); }
  await sleep(500);
  const rest = pgrepProfile(inst.ud);
  console.log(`Zweitinstanz beendet; verbleibende Prozesse im Profil: ${rest === "" ? "keine" : rest.replace(/\n/g, ",")}`);
}
async function warteAufFenster(port: number, timeoutMs: number): Promise<Cdp> {
  const bis = Date.now() + timeoutMs;
  let letzter = "";
  while (Date.now() < bis) {
    try { const cdp = await attachTo("workspace", port, REPO_NAME); if (cdp) return cdp; } catch (e) { letzter = (e as Error).message; }
    await sleep(1000);
  }
  throw new Error(`Kein Obsidian-Fenster fuer Vault "${REPO_NAME}" auf Port ${port}. ${letzter}`);
}

/** Vertrauensdialog, Restricted Mode, beide Plugins laden; Oberflaeche Englisch. */
async function bereiteVor(cdp: Cdp): Promise<void> {
  const vor = await bereiteInstanzVor(cdp, { pluginIds: [DEMO_ID, PLUGIN_ID], nurVault: REPO_NAME, sprache: "en" });
  const lang = await cdp.evaluate<string>(`return String(window.moment ? window.moment.locale() : "?");`);
  const r = { s: vor.hinweis, lang };
  console.log(`Plugins: ${r.s}; Sprache ${r.lang}`);
  if (!r.s.includes(`${PLUGIN_ID}:geladen`) || r.s.includes("FEHLT")) throw new Error(`Plugins nicht geladen — ${r.s}`);
  if (r.lang !== "en") throw new Error(`Oberflaeche ist nicht Englisch (${r.lang}) — die Bilder wuerden die falsche Sprache zeigen`);
}

// --- Rezept --------------------------------------------------------------------------------------


async function setzeEndpunkt(cdp: Cdp, fake: FakeEndpoint): Promise<boolean> {
  const pre = await cdp.evaluate<{ url: string | null }>(`
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    p.settings.endpoints = [{ url: ${q(fake.url)}, apiKey: "", model: ${q(FAKE_MODEL)} }];
    p.settings.endpointChoice = {};
    p.llm.invalidate();
    await p.saveSettings();
    const ep = await p.resolveEndpoint();
    return { url: ep ? ep.url : null };
  `);
  return pre.url === fake.url;
}

// --- Messung -------------------------------------------------------------------------------------

interface Box { x: number; y: number; w: number; h: number; bottom: number }
interface Messung {
  zustand: string;
  viewport: [number, number];
  isMobile: boolean;
  chat: Box | null; log: Box | null; zeilenhoehe: number; logZeilen: number;
  modellzeile: Box | null; chips: Box | null; chip: Box | null; dropdown: Box | null; eingabe: Box | null; knopfreihe: Box | null; senden: Box | null; neu: Box | null; statuszeile: Box | null; statustext: string;
  kontext: Box | null; kontextOffen: boolean | null; kontextImLog: boolean | null;
  tiefster: number; abstandUnten: number;
  chipUndDropdownInEinerZeile: boolean | null;
  reihenfolge: string[];
  unterhalb: string;
}

const MESS_JS = `
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); if (b.width === 0 && b.height === 0) return null; return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
  const log = document.querySelector(".okit-chat-log");
  const body = document.querySelector(".okit-stream-body") || log;
  const cs = getComputedStyle(body);
  let lh = parseFloat(cs.lineHeight); if (!Number.isFinite(lh)) lh = parseFloat(cs.fontSize) * 1.5;
  const lb = log ? log.getBoundingClientRect() : null;
  const sent = document.querySelector(".sa-chat-sent");
  const chip = r(".sa-chip"), dd = r(".sa-chip-add");
  const teile = { modellzeile: r(".okit-model-bar"), chips: r(".sa-chat-chips"), eingabe: r(".okit-chat-input"), knopfreihe: r(".okit-chat-buttons"), statuszeile: r(".okit-chat-statusbar") };
  const unten = Object.values(teile).filter(Boolean).map((b) => b.bottom);
  const namen = [["Modellzeile", ".okit-model-bar"], ["Chips", ".sa-chat-chips"], ["Eingabe", ".okit-chat-input"], ["Knopfreihe", ".okit-chat-buttons"], ["Statuszeile", ".okit-chat-statusbar"], ["Kontext", ".sa-chat-sent"], ["Verlauf", ".okit-chat-log"]];
  const reihe = namen.map(([n, s]) => [n, r(s)]).filter(([, b]) => b).sort((a, b) => a[1].y - b[1].y).map(([n, b]) => n + "@" + Math.round(b.y));
  const tiefster = unten.length ? Math.max(...unten) : 0;
  return {
    viewport: [innerWidth, innerHeight], isMobile: document.body.classList.contains("is-mobile"),
    chat: r(".okit-chat"), log: r(".okit-chat-log"), zeilenhoehe: +lh.toFixed(2), logZeilen: lb ? +(lb.height / lh).toFixed(1) : 0,
    ...teile, chip, dropdown: dd, senden: r(".okit-chat-send"), neu: r(".okit-chat-new"),
    statustext: (document.querySelector(".okit-chat-status")?.textContent || "").trim(),
    kontext: r(".sa-chat-sent"), kontextOffen: sent ? sent.open : null, kontextImLog: sent && log ? log.contains(sent) : null,
    tiefster, abstandUnten: +(innerHeight - tiefster).toFixed(1),
    chipUndDropdownInEinerZeile: chip && dd ? Math.abs(chip.y - dd.y) < 6 : null,
    reihenfolge: reihe,
    unterhalb: (() => { const c = r(".okit-chat"); if (!c) return ""; const e = document.elementFromPoint(200, Math.min(innerHeight - 2, c.bottom + 20)); const kette = []; for (let n = e; n && kette.length < 7; n = n.parentElement) kette.push(n.tagName.toLowerCase() + (n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\\s+/).slice(0, 3).join(".") : "")); return kette.join(" < "); })(),
  };
`;

async function messe(cdp: Cdp, zustand: string): Promise<Messung> {
  const m = await cdp.evaluate<Omit<Messung, "zustand">>(MESS_JS);
  return { zustand, ...m };
}

function kurz(m: Messung): string {
  const b = (x: Box | null): string => (x ? `${x.y}–${x.bottom}` : "—");
  return [
    `${m.zustand}: Viewport ${m.viewport.join("×")} mobil ${String(m.isMobile)}`,
    `  (a) Abstand Knopfreihe/Eingabe zum unteren Rand ${m.abstandUnten} px (tiefstes Chat-Element bis ${m.tiefster}; Chat ${b(m.chat)})`,
    `  (b) Antwortbereich ${m.log?.h ?? "—"} px = ${m.logZeilen} Zeilen à ${m.zeilenhoehe} px`,
    `  (c) Chip ${b(m.chip)} · Dropdown ${b(m.dropdown)} · in einer Zeile ${String(m.chipUndDropdownInEinerZeile)}`,
    `  (d) Kontext offen ${String(m.kontextOffen)} · im Verlauf ${String(m.kontextImLog)} · ${b(m.kontext)}`,
    `  Statuszeile „${m.statustext}“ ${b(m.statuszeile)} · Modellzeile ${b(m.modellzeile)} · Eingabe ${b(m.eingabe)} · Knopfreihe ${b(m.knopfreihe)}`,
    `  Reihenfolge von oben: ${m.reihenfolge.join(" > ")}`,
    `  Unter dem Chat: ${m.unterhalb}`,
  ].join("\n");
}

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(): Promise<void> {
  const port = Number(flag("--port"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port <1024-65535> ist Pflicht (9222 gehoert der regulaeren Instanz).");
  const tag = flag("--tag") ?? "lauf";
  const out = flag("--out") ?? "/tmp/saw-w29";
  mkdirSync(out, { recursive: true });

  const fake = await startFakeEndpoint();
  const vaultDir = setupVault();
  const inst = startInstanz(vaultDir, port);
  let cdp: Cdp | null = null;
  const messungen: Messung[] = [];
  try {
    cdp = await warteAufFenster(port, 60_000);
    await sleep(2500);
    await bereiteVor(cdp);
    if (!(await setzeEndpunkt(cdp, fake))) throw new Error("Fake-Endpunkt laesst sich nicht aufloesen");

    // Mobil-Emulation: laedt Obsidian neu (der Aufruf endet mit „Execution context was destroyed“), danach neu anhaengen.
    await cdp.evaluate(`app.emulateMobile(true); return true;`).catch(() => undefined);
    try { cdp.close(); } catch { /* Kontext schon weg */ }
    await sleep(4000);
    const neu = await attachTo("workspace", port, REPO_NAME);
    if (!neu) throw new Error("nach dem Neuladen kein Fenster");
    cdp = neu;
    await requireVisible(cdp);
    await bereiteInstanzVor(cdp, { pluginIds: [DEMO_ID, PLUGIN_ID], nurVault: REPO_NAME, sprache: "en" });
    await setzeEndpunkt(cdp, fake);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: BREITE, height: HOEHE, deviceScaleFactor: 2, mobile: true });
    await sleep(1200);
    const mobil = await cdp.evaluate<boolean>(`return document.body.classList.contains("is-mobile");`);
    if (!mobil) throw new Error("is-mobile nach emulateMobile(true) nicht gesetzt");

    // Chat oeffnen, eine Runde fuehren, ein Plugin als Chip waehlen.
    await cdp.evaluate(`app.workspace.detachLeavesOfType("settings-assistant-chat"); app.workspace.rightSplit.expand?.(); app.commands.executeCommandById(${q(`${PLUGIN_ID}:open-chat`)}); return true;`);
    const da = await cdp.evaluate<boolean>(`for (let i = 0; i < 40 && !document.querySelector(".okit-chat-input"); i++) await new Promise((r) => setTimeout(r, 250)); return !!document.querySelector(".okit-chat-input");`);
    if (!da) throw new Error("Chat-Ansicht oeffnet sich nicht");
    await cdp.evaluate(`const v = app.workspace.getLeavesOfType("settings-assistant-chat")[0].view; v.submit("What does Quick Capture do, and how could I make it save more often?"); return true;`);
    const fertig = await cdp.evaluate<boolean>(`for (let i = 0; i < 80 && !document.querySelector(".sa-chat-sent"); i++) await new Promise((r) => setTimeout(r, 250)); await new Promise((r) => setTimeout(r, 800)); return !!document.querySelector(".sa-chat-sent");`);
    if (!fertig) throw new Error("die Antwort kam nicht zustande (kein „Sent context“)");
    const chip = await cdp.evaluate<boolean>(`const s = document.querySelector(".sa-chip-add"); if (!s) return !!document.querySelector(".sa-chip"); if (!document.querySelector(".sa-chip")) { const o = [...s.options].find((x) => x.value === ${q(DEMO_ID)}); if (o) { s.value = o.value; s.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 500)); } } return !!document.querySelector(".sa-chip");`);
    if (!chip) console.log("WARNUNG: kein Plugin-Chip entstanden");

    for (const [schema, name] of [["moonstone", "hell"], ["obsidian", "dunkel"]] as const) {
      await cdp.evaluate(`app.vault.setConfig("theme", ${q(schema)}); app.updateTheme(); app.workspace.trigger("css-change"); await new Promise((r) => setTimeout(r, 600)); return true;`);
      for (const mitTastatur of [false, true]) {
        const hoehe = mitTastatur ? HOEHE - TASTATUR : HOEHE;
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: BREITE, height: hoehe, deviceScaleFactor: 2, mobile: true });
        await cdp.evaluate(mitTastatur ? `document.querySelector(".okit-chat-input")?.focus(); return true;` : `document.activeElement?.blur?.(); return true;`);
        await sleep(900);
        const zustand = `${tag}-${name}-${mitTastatur ? "tastatur" : "ohne"}`;
        const m = await messe(cdp, zustand);
        messungen.push(m);
        console.log(kurz(m));
        const png = await capture(cdp, undefined, 1);
        const pfad = join(out, `${zustand}.png`);
        writeFileSync(pfad, png);
        console.log(`  Bild ${pfad}`);
      }
    }
    writeFileSync(join(out, `${tag}-messung.json`), JSON.stringify(messungen, null, 2));
  } finally {
    if (cdp) {
      await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
      // Das Profil behaelt die Emulation (localStorage): zurueckstellen, sonst startet der naechste Lauf mobil.
      await cdp.evaluate(`app.vault.setConfig("theme", "moonstone"); app.emulateMobile(false); return true;`).catch(() => undefined);
      await sleep(1500);
      cdp.close();
    }
    await stopInstanz(inst);
    await fake.close();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  exit(1);
});
