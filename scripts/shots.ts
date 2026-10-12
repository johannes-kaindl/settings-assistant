// Instanz-Start, Vertrauensdialog und Restricted Mode uebernommen aus settings-assistant/scripts/gui-smoke.ts, 2026-10-03
/**
 * Aufnahme-Treiber fuer die README-Bilder — faehrt den Vertrag aus `docs/images/README.md` gegen eine
 * **Zweitinstanz** (eigenes Profil, eigener Port), nie gegen die regulaere Instanz.
 *
 * Bruecke, Aufnahme-Primitive und Fixture→Vault liegen zentral im Dach (`../tools/obsidian-cdp/`); hier steht nur
 * das Rezept: welches Bild was zeigt. Der Treiber startet und beendet seine Instanz selbst (nur den eigenen
 * Prozess ueber die PID), baut den Vault VOR jedem Lauf aus `docs/images/fixture/` und stellt den Zustand
 * (Demo-Plugin-Daten, Schnappschuesse, Chat-Endpunkt) selbst her.
 *
 * ```bash
 * npm run build
 * lsof -nP -iTCP:<PORT> -sTCP:LISTEN                         # Port frei?
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label settings-assistant --intent "shots.ts" --exclusive focus --port <PORT> --ttl 300
 * npm run shots -- --port <PORT>                              # alles aufnehmen (frischer Prozess je Lauf)
 * npm run shots -- --port <PORT> --only hero.png              # ein Bild
 * npm run shots -- --list                                   # Vertrag anzeigen
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 * ```
 *
 * Der Chat-Endpunkt ist ein lokaler Fake-Server, der eine feste Antwort streamt — es laeuft kein Modell, und
 * die Bilder tragen keinen echten Modellnamen.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { argv, cwd, exit } from "node:process";

import { Cdp, attachTo, bereiteInstanzVor, clearNotices, closeExtraLeaves, openExisting, pollUntil, reopenNote, setAppConfig } from "../../tools/obsidian-cdp/cdp.js";
import { boxOf, capture, setWindowSize, writeShot, type Rect } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "settings-assistant";
const PLUGIN_ID = "settings-assistant";
const DEMO_ID = "quick-capture";
const REPO_ROOT = cwd();
const OUT_DIR = join(REPO_ROOT, "docs/images");
const FIXTURE_DIR = join(OUT_DIR, "fixture");
const PROFILE_BASE = "/tmp/obs-test-settings-assistant";
const OBSIDIAN_BIN = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const FENSTER_BREITE = 1440;
const FENSTER_HOEHE = 900;
const FAKE_MODEL = "local-model";
const DEMO_DATA = "/plugins/quick-capture/data.json";
const SNAP_ROOT = "/plugins/settings-assistant/snapshots";

const q = (s: string): string => JSON.stringify(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- Fake-LLM-Endpunkt ---------------------------------------------------------------------------

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
async function startFakeEndpoint(): Promise<FakeEndpoint> {
  const server: Server = createServer((req, res) => {
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
      req.on("data", () => undefined);
      req.on("end", () => {
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
  // Fester Port statt Zufall, damit die Adresse im Bild immer gleich aussieht. NICHT 1234: dort haelt LM Studio einen Wildcard-Bind,
  // und ein spezifischer Bind daneben gelingt trotzdem — Anfragen landeten dann beim Fake, aber nur dank Bind-Reihenfolge. Ist der Port belegt, ein freier.
  await new Promise<void>((resolve) => {
    server.once("error", () => { server.listen(0, "127.0.0.1", resolve); });
    server.listen(8765, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }) };
}

// --- Vault und Instanz ---------------------------------------------------------------------------

function setupVault(): string {
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: FIXTURE_DIR, pluginId: PLUGIN_ID });
  console.log(`Aufnahme-Vault gebaut: ${vaultDir}`);
  for (const l of log) console.log(`  · ${l}`);
  // `buildVault` raeumt nur data.json des Plugins — Schnappschuesse und Demo-Plugin ueberleben sonst jeden Abbruch.
  rmSync(join(vaultDir, ".obsidian/plugins", PLUGIN_ID, "snapshots"), { recursive: true, force: true });
  const demoDir = join(vaultDir, ".obsidian/plugins", DEMO_ID);
  rmSync(demoDir, { recursive: true, force: true });
  mkdirSync(demoDir, { recursive: true });
  for (const f of ["manifest.json", "main.js"]) copyFileSync(join(FIXTURE_DIR, "plugins", DEMO_ID, f), join(demoDir, f));
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
  if (pgrepProfile(ud) !== "") ud = `${PROFILE_BASE}-wDocs-1`;
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
  const vor = await bereiteInstanzVor(cdp, { pluginIds: [DEMO_ID, PLUGIN_ID], sprache: "en" });
  const lang = await cdp.evaluate<string>(`return String(window.moment ? window.moment.locale() : "?");`);
  const r = { s: vor.hinweis, lang };
  console.log(`Plugins: ${r.s}; Sprache ${r.lang}`);
  if (!r.s.includes(`${PLUGIN_ID}:geladen`) || r.s.includes("FEHLT")) throw new Error(`Plugins nicht geladen — ${r.s}`);
  if (r.lang !== "en") throw new Error(`Oberflaeche ist nicht Englisch (${r.lang}) — die Bilder wuerden die falsche Sprache zeigen`);
}

// --- Rezept --------------------------------------------------------------------------------------

interface Shot {
  name: string;
  klasse: "hero" | "feature" | "detail";
  /** Stellt den Zustand her und liefert den Bildausschnitt (null = nicht aufnehmbar). */
  run(cdp: Cdp, port: number, fake: FakeEndpoint): Promise<Rect | null>;
}

async function stelleDemoDatenHer(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const id = ${q(DEMO_ID)};
    if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
    await app.vault.adapter.write(app.vault.configDir + ${q(DEMO_DATA)}, ${q(JSON.stringify({ captureFolder: "Captures", autoSaveSeconds: 60, openAfterCapture: true, showRibbonIcon: true, apiKey: "sk-demo-0000" }, null, 2))});
    await app.plugins.enablePlugin(id);
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true };
  `);
}

async function schliesseDialoge(cdp: Cdp): Promise<void> {
  // Ein Dialog, der offen bleibt, steht im naechsten Bild als Geist (gemessen: Anwenden-Dialog ueber dem Chat).
  // Erst per Knopf, dann per Escape; ob wirklich keiner mehr da ist, wird gemessen statt angenommen.
  await cdp.evaluate(`
    for (const b of document.querySelectorAll(".modal-container .modal-close-button")) b.click();
    await new Promise((r) => setTimeout(r, 250));
    for (const n of document.querySelectorAll(".notice")) n.remove();
    return { ok: true };
  `).catch(() => undefined);
  for (let i = 0; i < 5; i++) {
    const offen = await cdp.evaluate<{ n: number }>(`return { n: document.querySelectorAll(".modal-container").length };`).catch(() => ({ n: 0 }));
    if (offen.n === 0) return;
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);
  }
  console.log("      · ein Dialog liess sich nicht schliessen");
}

/** Profil-Notiz im Lesemodus oeffnen und auf den gerenderten Block warten. */
async function oeffneProfilNotiz(cdp: Cdp): Promise<boolean> {
  await cdp.send("Page.bringToFront");
  await setAppConfig(cdp, "livePreview", true);
  if (!(await openExisting(cdp, "Weekly review setup.md", "preview"))) return false;
  await closeExtraLeaves(cdp);
  await reopenNote(cdp, "Weekly review setup.md", "preview");
  const da = await pollUntil<{ ok: boolean }>(cdp, `
    const leaf = document.querySelector(".workspace-leaf.mod-active .markdown-reading-view");
    return leaf && leaf.querySelector(".sa-profile .sa-rows") ? { ok: true } : null;
  `, 10_000, 250);
  return da !== null;
}

async function warteAufDialog(cdp: Cdp): Promise<boolean> {
  return (await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".modal-container .modal") ? { ok: true } : null;`, 8000, 200)) !== null;
}

async function klickeAnwenden(cdp: Cdp): Promise<boolean> {
  const r = await cdp.evaluate<{ ok: boolean }>(`
    const b = document.querySelector(".workspace-leaf.mod-active .markdown-reading-view .sa-apply");
    if (!b || b.disabled) return { ok: false };
    b.click();
    return { ok: true };
  `);
  return r.ok;
}

/** Endpunkt auf den Fake setzen, damit der Chat ohne Modell eine Antwort hat. */
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

const SHOTS: Shot[] = [
  {
    name: "hero.png",
    klasse: "hero",
    async run(cdp) {
      await stelleDemoDatenHer(cdp);
      if (!(await oeffneProfilNotiz(cdp))) return null;
      await sleep(600);
      const sizer = await boxOf(cdp, ".workspace-leaf.mod-active .markdown-reading-view .markdown-preview-sizer", 16);
      const block = await boxOf(cdp, ".workspace-leaf.mod-active .markdown-reading-view .sa-profile", 16);
      if (!sizer || !block) return null;
      // Von der Ueberschrift der Notiz bis unter den Anwenden-Knopf — kein Weissraum darunter.
      // Querformat (Hero: H <= B) ist bei Breite der Lesespalte erfuellt, die Hoehe wird trotzdem gedeckelt.
      return { ...sizer, height: Math.min(block.y + block.height - sizer.y, sizer.width) };
    },
  },
  {
    name: "apply-dialog.png",
    klasse: "feature",
    async run(cdp) {
      await stelleDemoDatenHer(cdp);
      if (!(await oeffneProfilNotiz(cdp))) return null;
      if (!(await klickeAnwenden(cdp))) return null;
      if (!(await warteAufDialog(cdp))) return null;
      await sleep(600);
      return boxOf(cdp, ".modal-container .modal", -5);
    },
  },
  {
    name: "chat.png",
    klasse: "detail",
    async run(cdp, _port, fake) {
      await stelleDemoDatenHer(cdp);
      if (!(await oeffneProfilNotiz(cdp))) return null;
      if (!(await setzeEndpunkt(cdp, fake))) return null;
      await cdp.evaluate(`app.workspace.detachLeavesOfType("settings-assistant-chat"); await new Promise((r) => setTimeout(r, 300)); app.commands.executeCommandById(${q(`${PLUGIN_ID}:open-chat`)}); return { ok: true };`);
      const da = await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".sa-chat-input") ? { ok: true } : null;`, 10_000, 250);
      if (!da) return null;
      await cdp.evaluate(`
        const nb = Array.from(document.querySelectorAll(".sa-chat-head button")).find((b) => b.textContent === "New chat");
        if (nb) nb.click();
        await new Promise((r) => setTimeout(r, 300));
        const i = document.querySelector(".sa-chat-input");
        i.value = "Quick Capture saves too rarely. Can you make it save every 15 seconds and stop opening the new note?";
        i.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector(".sa-chat-send").click();
        return { ok: true };
      `);
      const fertig = await pollUntil<{ ok: boolean }>(cdp, `
        const send = document.querySelector(".sa-chat-send");
        return send && send.textContent === "Send" && document.querySelector(".sa-chat-block .sa-apply") ? { ok: true } : null;
      `, 30_000, 300);
      if (!fertig) return null;
      await sleep(2000);
      // Nur die rechte Seitenleiste: ein Ausschnitt mit einem Stueck Notiz davor zeigt abgeschnittenen Text.
      // Ein Hochformat-Streifen ist ein detail-Bild (keine Hoehengrenze).
      // Unten auf die Sende-Zeile begrenzen: darunter fuellt der Container bis zum Fensterrand und faengt ein OS-Artefakt ein.
      const seite = await boxOf(cdp, ".mod-right-split", 0);
      const senden = await boxOf(cdp, ".sa-chat-send", 0);
      if (!seite || !senden) return null;
      return { ...seite, height: senden.y + senden.height + 8 - seite.y };
    },
  },
  {
    name: "restore-dialog.png",
    klasse: "feature",
    async run(cdp) {
      await stelleDemoDatenHer(cdp);
      if (!(await oeffneProfilNotiz(cdp))) return null;
      if (!(await klickeAnwenden(cdp))) return null;
      if (!(await warteAufDialog(cdp))) return null;
      // Alle Zeilen des Dialogs anhaken und bestaetigen — erzeugt den Schnappschuss, den das Bild zeigt.
      await cdp.evaluate(`
        const m = document.querySelector(".modal-container .modal");
        const btn = m.querySelector(".modal-button-container button.mod-cta");
        if (btn) btn.click();
        return { ok: true };
      `);
      await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".modal-container .modal") ? null : { ok: true };`, 8000, 200);
      await pollUntil<{ ok: boolean }>(cdp, `
        const root = app.vault.configDir + ${q(SNAP_ROOT)};
        return (await app.vault.adapter.exists(root)) && (await app.vault.adapter.list(root)).folders.length > 0 ? { ok: true } : null;
      `, 10_000, 300);
      await sleep(800);
      await clearNotices(cdp);
      await cdp.evaluate(`app.commands.executeCommandById(${q(`${PLUGIN_ID}:undo-last-apply`)}); return { ok: true };`);
      if (!(await warteAufDialog(cdp))) return null;
      await sleep(600);
      return boxOf(cdp, ".modal-container .modal", -5);
    },
  },
  {
    name: "settings.png",
    klasse: "detail",
    async run(cdp, port) {
      await schliesseDialoge(cdp);
      await cdp.evaluate(`app.setting.close(); return { ok: true };`).catch(() => undefined);
      await sleep(600);
      await cdp.evaluate(`
        app.setting.open();
        await new Promise((r) => setTimeout(r, 500));
        app.setting.openTabById(${q(PLUGIN_ID)});
        await new Promise((r) => setTimeout(r, 1000));
        return { ok: true };
      `);
      const alsModal = await cdp.evaluate<boolean>(`return Boolean(document.querySelector(".modal.mod-settings"));`);
      const fenster = alsModal ? cdp : await attachTo("settings", port, REPO_NAME);
      if (!fenster) return null;
      try {
        if (!alsModal) {
          await fenster.send("Page.bringToFront");
          await setWindowSize(fenster, 1100, 1500);
          await sleep(600);
        }
        // Der Tab ist laenger als jedes Fenster. Gezeigt wird der Teil „Snapshots“: von der Ueberschrift bis unter die Liste.
        const clip = await fenster.evaluate<Rect | null>(`
          const heads = Array.from(document.querySelectorAll(".setting-item-heading"));
          const h = heads.find((e) => /^\\s*Snapshots\\s*$/.test(e.textContent || ""));
          const list = document.querySelector(".sa-snapshots");
          if (!h || !list) return null;
          list.scrollIntoView({ block: "end" });
          await new Promise((r) => setTimeout(r, 400));
          const a = h.getBoundingClientRect(), b = list.getBoundingClientRect();
          const c = document.querySelector(".vertical-tab-content").getBoundingClientRect();
          return { x: c.x, y: Math.max(c.y, a.y - 12), width: c.width, height: b.bottom + 12 - Math.max(c.y, a.y - 12) };
        `);
        const box = clip;
        if (!box) return null;
        const png = await capture(fenster, box);
        console.log(`  ✓ ${await writeShot(fenster, "settings.png", png, { outDir: OUT_DIR, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH, thumb: true })}`);
      } finally {
        if (!alsModal) { await fenster.evaluate("window.close(); return true;").catch(() => undefined); fenster.close(); }
        else await cdp.evaluate(`app.setting.close(); return { ok: true };`).catch(() => undefined);
      }
      return null;
    },
  },
];

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(): Promise<void> {
  if (argv.includes("--list")) {
    for (const s of SHOTS) console.log(`  ${s.klasse.padEnd(8)} ${s.name}`);
    return;
  }
  const port = Number(flag("--port"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port <1024-65535> ist Pflicht (kein Standardport: 9222 gehoert der regulaeren Instanz). Beispiel: npm run shots -- --port <PORT>");
  }
  const nur = flag("--only");
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const fake = await startFakeEndpoint();
  const vaultDir = setupVault();
  const inst = startInstanz(vaultDir, port);
  let cdp: Cdp | null = null;
  let ok = 0;
  let fehlend = 0;
  try {
    cdp = await warteAufFenster(port, 60_000);
    await cdp.send("Page.bringToFront");
    await sleep(3000);
    await bereiteVor(cdp);
    await setWindowSize(cdp, FENSTER_BREITE, FENSTER_HOEHE);
    await setAppConfig(cdp, "readableLineLength", false);
    await setAppConfig(cdp, "showInlineTitle", false);
    await sleep(800);

    for (const shot of SHOTS) {
      if (nur && shot.name !== nur) continue;
      try {
        const box = await shot.run(cdp, port, fake);
        if (shot.name === "settings.png") { ok++; continue; }
        const png = box ? await capture(cdp, box) : null;
        await schliesseDialoge(cdp);
        if (!png) { console.log(`  ✗ ${shot.name} — Zustand kam nicht zustande`); fehlend++; continue; }
        console.log(`  ✓ ${await writeShot(cdp, shot.name, png, { outDir: OUT_DIR, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH, thumb: shot.klasse === "detail" })}`);
        ok++;
      } catch (err) {
        console.log(`  ✗ ${shot.name} — ${(err as Error).message}`);
        fehlend++;
        await schliesseDialoge(cdp);
      }
    }
  } finally {
    cdp?.close();
    await stopInstanz(inst);
    await fake.close();
  }
  console.log(`\n${ok} Bild(er) geschrieben, ${fehlend} offen.`);
  if (fehlend) exit(1);
}

main().catch((err: Error) => {
  console.error(err.message);
  exit(1);
});
