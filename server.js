// Sprint Room: a self-contained scrum team tool.
// One Node.js process serves the web app, stores data in a JSON file next to it,
// and pushes live updates to every browser on the network. No npm dependencies.
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { parseArgs } = require("node:util");

const VERSION = "1.2.0";
const COLLECTIONS = new Set(["members", "sprints", "retroItems", "stories"]);
const DECK = new Set(["0", "0.5", "1", "2", "3", "5", "8", "13", "21", "?", "coffee"]);
const MAX_BODY = 256 * 1024;
const MAX_IMPORT = 20 * 1024 * 1024;

// ---------- packaging ----------

// Inside a Windows .exe built with `node --build-sea`, the page is an embedded asset.
let sea = null;
try { sea = require("node:sea"); if (!sea.isSea()) sea = null; } catch { sea = null; }

function indexHTML() {
  if (sea) return Buffer.from(sea.getAsset("index.html"));
  return fs.readFileSync(path.join(__dirname, "web", "index.html"));
}

function appDir() {
  return sea ? path.dirname(process.execPath) : __dirname;
}

// ---------- helpers ----------

const newID = () => crypto.randomBytes(6).toString("hex");
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

class HttpError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}
const bad = msg => new HttpError(400, msg);
const notFound = msg => new HttpError(404, msg);

const emptyPoker = () => ({ roundId: "", storyId: "", storyKey: "", storyTitle: "", revealed: false, saved: false, savedPoints: 0, votes: {}, recorded: {}, startedAt: "" });

// ---------- store ----------

class Store {
  constructor(file) {
    this.file = file;
    this.data = { meta: null, collections: {}, poker: emptyPoker(), version: 0 };
    this.normalize();
  }

  normalize() {
    const d = this.data;
    if (!d.meta || typeof d.meta !== "object") d.meta = { teamName: "Your team", sample: false };
    if (!d.collections || typeof d.collections !== "object") d.collections = {};
    for (const c of COLLECTIONS) if (!d.collections[c] || typeof d.collections[c] !== "object") d.collections[c] = {};
    d.poker = { ...emptyPoker(), ...(d.poker || {}) };
    if (!d.poker.votes) d.poker.votes = {};
    if (!d.poker.recorded) d.poker.recorded = {};
    if (typeof d.version !== "number") d.version = 0;
  }

  load() {
    let text;
    try { text = fs.readFileSync(this.file, "utf8"); }
    catch (e) { if (e.code === "ENOENT") return false; throw e; }
    try { this.data = JSON.parse(text); }
    catch (e) { throw new Error(`${this.file} is not valid JSON: ${e.message}`); }
    this.normalize();
    return true;
  }

  // Write atomically: temp file, then rename over the real one.
  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

// ---------- server ----------

class SprintRoom {
  constructor(store) {
    this.store = store;
    this.subs = new Map(); // response -> member id of that browser ("" = anonymous)
    this.joinURLs = [];
  }

  // Every change goes through here: apply, bump version, save, notify browsers.
  mutate(fn) {
    fn(this.store.data);
    this.store.data.version++;
    try { this.store.save(); }
    catch (e) {
      console.log("Could not save data:", e.message);
      throw new HttpError(500, "The change was made but could not be written to disk: " + e.message);
    }
    finally { this.broadcast(); }
  }

  broadcast() {
    for (const res of this.subs.keys()) res.write("data: changed\n\n");
  }

  online() {
    return [...new Set([...this.subs.values()].filter(Boolean))].sort();
  }

  state(me) {
    const d = this.store.data, p = d.poker;
    const list = m => Object.entries(m).map(([id, doc]) => ({ ...doc, id }))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || a.id.localeCompare(b.id));
    return {
      version: d.version,
      meta: d.meta,
      members: list(d.collections.members),
      sprints: list(d.collections.sprints),
      retroItems: list(d.collections.retroItems),
      stories: list(d.collections.stories),
      poker: {
        roundId: p.roundId, storyId: p.storyId, storyKey: p.storyKey, storyTitle: p.storyTitle,
        revealed: p.revealed, saved: p.saved, savedPoints: p.savedPoints,
        voters: Object.keys(p.votes).sort(),
        votes: p.revealed ? p.votes : {}, // hidden from every browser until revealed
        recorded: p.recorded,
      },
      myVote: me && me in p.votes ? p.votes[me] : null,
      online: this.online(),
      joinUrls: this.joinURLs,
      dataFile: this.store.file,
    };
  }

  events(req, res, url) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("retry: 2000\ndata: hello\n\n");
    this.subs.set(res, url.searchParams.get("me") || "");
    this.broadcast(); // presence changed
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), 25000);
    req.on("close", () => { clearInterval(keepalive); this.subs.delete(res); this.broadcast(); });
  }

  // ---------- poker ----------

  poker(action, body) {
    this.mutate(d => {
      const p = d.poker;
      const newRound = storyId => {
        const st = d.collections.stories[storyId];
        if (!st) throw notFound("That story no longer exists.");
        d.poker = { ...emptyPoker(), roundId: newID(), storyId, storyKey: st.key || "", storyTitle: st.title || "", startedAt: now() };
      };
      switch (action) {
        case "start": return newRound(body.storyId);
        case "revote":
          if (!p.roundId) throw bad("No story is on the table.");
          return newRound(p.storyId);
        case "clear": d.poker = emptyPoker(); return;
        case "reveal":
          if (!p.roundId) throw bad("No story is on the table.");
          p.revealed = true; return;
        case "vote": {
          if (!p.roundId) throw bad("No story is on the table.");
          if (p.revealed) throw bad("Cards are already revealed. Start a new vote to change it.");
          if (!d.collections.members[body.memberId]) throw bad("Pick a team member before voting.");
          if (!body.value) { delete p.votes[body.memberId]; delete p.recorded[body.memberId]; return; }
          if (!DECK.has(body.value)) throw bad("That card isn't in the deck.");
          p.votes[body.memberId] = body.value;
          if (body.recorded) p.recorded[body.memberId] = true; else delete p.recorded[body.memberId];
          return;
        }
        case "save": {
          if (!p.revealed) throw bad("Reveal the cards before saving an estimate.");
          const st = d.collections.stories[p.storyId];
          if (!st) throw notFound("That story no longer exists.");
          const num = v => (typeof v === "number" && isFinite(v) ? v : 0);
          Object.assign(st, { points: num(body.points), average: num(body.average), nearestCard: num(body.nearestCard), voteCount: num(body.voteCount), estimatedAt: now() });
          p.saved = true; p.savedPoints = num(body.points);
          return;
        }
      }
      throw notFound("Unknown poker action.");
    });
  }

  // ---------- routing ----------

  async handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const m = req.method;
    const send = (code, obj, headers = {}) => {
      res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
      res.end(JSON.stringify(obj));
    };
    try {
      if (parts[0] !== "api") {
        if (m !== "GET" && m !== "HEAD") throw notFound("Not found.");
        if (url.pathname !== "/" && url.pathname !== "/index.html") { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        return res.end(m === "HEAD" ? undefined : indexHTML());
      }
      const route = `${m} /${parts.slice(1).join("/")}`;
      const d = this.store.data;

      if (route === "GET /state") return send(200, this.state(url.searchParams.get("me") || ""));
      if (route === "GET /events") return this.events(req, res, url);
      if (route === "GET /export") {
        const day = new Date().toISOString().slice(0, 10);
        res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="sprint-room-backup-${day}.json"` });
        return res.end(JSON.stringify(d, null, 2));
      }
      if (route === "GET /report/retro.xlsx") {
        const { filename, buffer } = retroReport(d, url.searchParams.get("sprint") || "");
        const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
        res.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Content-Length": buffer.length,
        });
        return res.end(buffer);
      }
      if (route === "POST /import") {
        const inData = await readJSON(req, MAX_IMPORT);
        if (!inData.collections || typeof inData.collections !== "object") throw bad("That file isn't a Sprint Room backup.");
        this.mutate(() => { const v = this.store.data.version; this.store.data = inData; this.store.normalize(); this.store.data.version = v; });
        return send(200, { ok: true });
      }
      if (route === "PATCH /meta") {
        const body = await readJSON(req);
        this.mutate(d => Object.assign(d.meta, body));
        return send(200, { ok: true });
      }
      if (route === "POST /sample/clear") {
        this.mutate(d => {
          for (const c of COLLECTIONS) for (const [id, doc] of Object.entries(d.collections[c])) if (doc.sample === true) delete d.collections[c][id];
          if (!d.collections.stories[d.poker.storyId]) d.poker = emptyPoker();
          d.meta.sample = false; d.meta.teamName = "Your team";
        });
        return send(200, { ok: true });
      }
      if (parts[1] === "poker" && parts.length === 3 && m === "POST") {
        const body = Number(req.headers["content-length"] || 0) > 0 ? await readJSON(req) : {};
        this.poker(parts[2], body);
        return send(200, { ok: true });
      }
      if (parts[1] === "c") {
        const col = parts[2], id = parts[3];
        if (!COLLECTIONS.has(col)) throw notFound("Unknown collection " + col);
        if (parts.length === 3 && m === "POST") {
          const body = await readJSON(req);
          delete body.id;
          if (!body.createdAt) body.createdAt = now();
          const newId = newID();
          this.mutate(d => { d.collections[col][newId] = body; });
          return send(200, { id: newId });
        }
        if (parts.length === 4 && m === "PATCH") {
          const body = await readJSON(req);
          delete body.id;
          this.mutate(d => {
            const doc = d.collections[col][id];
            if (!doc) throw notFound("That item no longer exists. Someone may have deleted it.");
            Object.assign(doc, body);
          });
          return send(200, { ok: true });
        }
        if (parts.length === 4 && m === "DELETE") {
          this.mutate(d => {
            delete d.collections[col][id];
            if (col === "members") { delete d.poker.votes[id]; delete d.poker.recorded[id]; }
          });
          return send(200, { ok: true });
        }
        if (col === "retroItems" && parts.length === 5 && parts[4] === "vote" && m === "POST") {
          const { voter } = await readJSON(req);
          if (!voter) throw bad("A voter is required.");
          this.mutate(d => {
            const doc = d.collections.retroItems[id];
            if (!doc) throw notFound("That note no longer exists.");
            const votes = Array.isArray(doc.votes) ? doc.votes : [];
            doc.votes = votes.includes(voter) ? votes.filter(v => v !== voter) : [...votes, voter];
          });
          return send(200, { ok: true });
        }
      }
      throw notFound("Not found.");
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      if (!res.headersSent) send(e instanceof HttpError ? e.code : 500, { error: e.message });
    }
  }
}

function readJSON(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, "That request is too large.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!v || typeof v !== "object" || Array.isArray(v)) throw 0;
        resolve(v);
      } catch { reject(bad("Request body must be a JSON object.")); }
    });
    req.on("error", reject);
  });
}

// ---------- Excel (.xlsx) report ----------
// An .xlsx file is a zip of XML parts. Written by hand so the app needs no packages.

const zlib = require("node:zlib");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(files) { // files: [{name, data: Buffer|string}]
  const t = new Date();
  const time = (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1);
  const date = ((t.getFullYear() - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const packed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const xmlEsc = v => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const colName = i => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

// Cell style ids (see STYLES): 0 normal, 1 header, 2 wrapped text, 3 title, 4 bold, 5 one-decimal number, 6 subtitle, 7 percent
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="16"/><color rgb="FF16202B"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><sz val="11"/><color rgb="FF5B6878"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2B59C3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD8DEE6"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// sheet: {name, title?, subtitle?, columns: [{header, width, wrap?, decimal?, bold?}], rows: [[...]], note?}
function sheetXML(sh) {
  const out = [];
  let r = 0;
  const cell = (c, v, style) => {
    const ref = colName(c) + (r + 1);
    if (v === null || v === undefined || v === "") return `<c r="${ref}" s="${style}"/>`;
    if (typeof v === "number" && isFinite(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  const row = (cells, ht) => { out.push(`<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${cells.join("")}</row>`); r++; };
  if (sh.title) row([cell(0, sh.title, 3)], 24);
  if (sh.subtitle) row([cell(0, sh.subtitle, 6)]);
  if (sh.title || sh.subtitle) row([]);
  const headerRow = r;
  row(sh.columns.map((col, i) => cell(i, col.header, 1)), 20);
  for (const values of sh.rows) row(sh.columns.map((col, i) => cell(i, values[i], col.percent ? 7 : col.decimal ? 5 : col.bold ? 4 : col.wrap ? 2 : 0)));
  if (!sh.rows.length) row([cell(0, sh.empty || "Nothing recorded.", 6)]);
  if (sh.note) { row([]); row([cell(0, sh.note, 6)]); }
  const lastCol = colName(sh.columns.length - 1);
  const pane = `<pane ySplit="${headerRow + 1}" topLeftCell="A${headerRow + 2}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 2}" sqref="A${headerRow + 2}"/>`;
  const filter = sh.rows.length ? `<autoFilter ref="A${headerRow + 1}:${lastCol}${headerRow + 1 + sh.rows.length}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join("")}</cols><sheetData>${out.join("")}</sheetData>${filter}<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

function workbook(sheets, title) {
  const safe = sheets.map((sh, i) => ({ ...sh, name: (sh.name.replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31) || `Sheet${i + 1}`) }));
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>Sprint Room</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now()}</dcterms:created></cp:coreProperties>` },
    { name: "docProps/app.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Sprint Room</Application></Properties>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${safe.map((sh, i) => `<sheet name="${xmlEsc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${safe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: STYLES },
    ...safe.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXML(sh) })),
  ];
  return zip(files);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(s) { // "2026-09-28" or ISO timestamp -> "28 Sep 2026"
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : String(s);
}
function fmtDateTime(s) { // local "2026-09-28T15:30" or UTC ISO -> "28 Sep 2026 15:30" in this computer's time
  if (!s) return "";
  const d = /Z$|[+-]\d\d:\d\d$/.test(s) ? new Date(s) : null;
  if (d && !isNaN(d)) { const p = n => String(n).padStart(2, "0"); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(s);
  return m ? `${fmtDate(m[1])} ${m[2]}` : fmtDate(s);
}
const cardText = v => (v === "coffee" ? "Coffee break" : v === "0.5" ? "0.5" : v);

function retroReport(d, sprintId) {
  const team = d.meta.teamName || "Your team";
  const members = d.collections.members;
  const byStart = Object.entries(d.collections.sprints).map(([id, s]) => ({ ...s, id })).sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
  const sprints = sprintId ? byStart.filter(s => s.id === sprintId) : byStart;
  if (sprintId && !sprints.length) throw notFound("That sprint no longer exists.");
  const ids = new Set(sprints.map(s => s.id));
  const sprintName = id => d.collections.sprints[id]?.name || "";
  const order = new Map(sprints.map((s, i) => [s.id, i]));
  const items = Object.entries(d.collections.retroItems).map(([id, r]) => ({ ...r, id })).filter(r => ids.has(r.sprintId))
    .sort((a, b) => order.get(a.sprintId) - order.get(b.sprintId) || (b.votes?.length || 0) - (a.votes?.length || 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const stories = Object.values(d.collections.stories).filter(s => ids.has(s.sprintId))
    .sort((a, b) => order.get(a.sprintId) - order.get(b.sprintId) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const votes = r => (Array.isArray(r.votes) ? r.votes.length : 0);
  const owner = id => members[id]?.name || "";
  const single = sprints.length === 1 ? sprints[0] : null;
  const title = single ? `${team} · ${single.name} retrospective` : `${team} · Retrospectives, all sprints`;
  const subtitle = `Generated by Sprint Room on ${fmtDateTime(now())}`;
  const kindLabel = { well: "Went well", improve: "To improve" };
  const withSprint = cols => (single ? cols : [{ header: "Sprint", width: 14 }, ...cols]);
  const rowSprint = (r, vals) => (single ? vals : [sprintName(r.sprintId), ...vals]);

  const summary = {
    name: "Summary", title, subtitle,
    columns: [
      { header: "Sprint", width: 14, bold: true }, { header: "Dates", width: 26 }, { header: "Sprint goal", width: 46, wrap: true },
      { header: "Retrospective", width: 22 },
      { header: "Committed pts", width: 14, decimal: true }, { header: "Velocity (pts done)", width: 18, decimal: true },
      { header: "Reliability", width: 11, percent: true }, { header: "Avg cycle time (days)", width: 20, decimal: true },
      { header: "Went well", width: 11 }, { header: "To improve", width: 11 },
      { header: "Action items", width: 12 }, { header: "Actions done", width: 13 }, { header: "Actions open", width: 13 },
      { header: "Stories estimated", width: 17 }, { header: "Story points", width: 13, decimal: true },
    ],
    rows: sprints.map(s => {
      const its = items.filter(r => r.sprintId === s.id), acts = its.filter(r => r.kind === "action");
      const est = stories.filter(x => x.sprintId === s.id && typeof x.points === "number");
      const k = s.kpis || {}, num = v => (typeof v === "number" && isFinite(v) ? v : "");
      return [s.name, `${fmtDate(s.start)} to ${fmtDate(s.end)}`, s.goal || "", s.retroFinishedAt ? `Finished ${fmtDateTime(s.retroFinishedAt)}` : fmtDateTime(s.retro) || "Not scheduled",
        num(k.committed), num(k.velocity), k.committed > 0 && typeof k.velocity === "number" ? k.velocity / k.committed : "", num(k.cycleTime),
        its.filter(r => r.kind === "well").length, its.filter(r => r.kind === "improve").length, acts.length,
        acts.filter(a => a.done).length, acts.filter(a => !a.done).length, est.length, est.reduce((a, x) => a + x.points, 0)];
    }),
    empty: "No sprints yet.",
  };
  const notes = {
    name: "Retro notes", title: single ? `${single.name}: what went well and what to improve` : "What went well and what to improve",
    columns: withSprint([{ header: "Category", width: 13, bold: true }, { header: "Note", width: 70, wrap: true }, { header: "+1 votes", width: 10 }, { header: "Added", width: 20 }]),
    rows: items.filter(r => r.kind !== "action").sort((a, b) => (single ? 0 : order.get(a.sprintId) - order.get(b.sprintId)) || (a.kind === b.kind ? 0 : a.kind === "well" ? -1 : 1) || votes(b) - votes(a))
      .map(r => rowSprint(r, [kindLabel[r.kind] || r.kind, r.text, votes(r), fmtDateTime(r.createdAt)])),
    empty: "No notes recorded.",
  };
  const actions = {
    name: "Action items", title: single ? `${single.name}: action items` : "Action items",
    columns: withSprint([{ header: "Action", width: 64, wrap: true }, { header: "Owner", width: 20 }, { header: "Status", width: 10, bold: true }, { header: "+1 votes", width: 10 }, { header: "Added", width: 20 }]),
    rows: items.filter(r => r.kind === "action").map(r => rowSprint(r, [r.text, owner(r.ownerId) || "No owner", r.done ? "Done" : "Open", votes(r), fmtDateTime(r.createdAt)])),
    empty: "No action items recorded.",
  };
  const est = {
    name: "Story estimates", title: single ? `${single.name}: scrum poker estimates` : "Scrum poker estimates",
    columns: withSprint([{ header: "Key", width: 12 }, { header: "Story", width: 54, wrap: true }, { header: "Story points", width: 13, decimal: true }, { header: "Average vote", width: 13, decimal: true }, { header: "Nearest card", width: 13 }, { header: "Votes", width: 8 }, { header: "Estimated", width: 20 }]),
    rows: stories.map(x => rowSprint(x, [x.key || "", x.title || "", typeof x.points === "number" ? x.points : "Not estimated", typeof x.average === "number" ? x.average : "", typeof x.nearestCard === "number" ? x.nearestCard : "", typeof x.voteCount === "number" ? x.voteCount : "", fmtDateTime(x.estimatedAt)])),
    note: "Story points are the average of all numeric votes. ? and coffee-break cards are not counted.",
    empty: "No stories recorded.",
  };
  const statusText = { available: "Available", partial: "Part-time", away: "Out of office" };
  const teamSheet = {
    name: "Team", title: `${team}: team`,
    columns: [{ header: "Name", width: 22, bold: true }, { header: "Role", width: 22 }, { header: "Availability", width: 15 }, { header: "Capacity (pts)", width: 14 }, { header: "Notes", width: 44, wrap: true }],
    rows: Object.values(members).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(m => [m.name, m.role || "", statusText[m.status] || "Available", Number(m.capacity) || 0, m.notes || ""]),
    empty: "No team members.",
  };
  const safeName = s => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const filename = safeName(single ? `${team} - ${single.name} retrospective.xlsx` : `${team} - retrospectives ${new Date().toISOString().slice(0, 10)}.xlsx`);
  return { filename, buffer: workbook([summary, notes, actions, est, teamSheet], title) };
}

// ---------- sample data ----------

function seed(store) {
  const d = store.data;
  const pad = n => String(n).padStart(2, "0");
  const day = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  const at = (x, hm) => `${day(x)}T${hm}`;
  const add = (x, n) => { const y = new Date(x); y.setDate(y.getDate() + n); return y; };
  const t = new Date();
  let mon = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  while (mon.getDay() !== 1) mon = add(mon, -1);
  const curS = mon, curE = add(mon, 11), lastS = add(mon, -14), lastE = add(mon, -3);

  d.meta = { teamName: "Checkout Squad", sample: true };
  const member = (id, name, role, capacity, status, notes, n) =>
    (d.collections.members[id] = { name, role, capacity, status, notes, sample: true, createdAt: `2026-01-01T09:00:0${n}Z` });
  member("m1", "Priya Raman", "Scrum master", 4, "available", "Facilitates stand-up and retro", 1);
  member("m2", "Daniel Okafor", "Product owner", 0, "available", "Owns the checkout backlog", 2);
  member("m3", "Mei Chen", "Backend engineer", 10, "available", "Payments API, UTC+8", 3);
  member("m4", "Lucas Ferreira", "Frontend engineer", 9, "available", "", 4);
  member("m5", "Aisha Karimi", "QA engineer", 6, "partial", "Mornings only this week", 5);
  member("m6", "Tom Lindqvist", "Full-stack engineer", 9, "away", "On leave this week", 6);

  const sprint = (id, name, goal, s, e, extra, created) =>
    (d.collections.sprints[id] = { name, goal, start: day(s), end: day(e), standup: "09:30", planning: at(s, "10:00"), review: at(e, "14:00"), retro: at(e, "15:30"), sample: true, createdAt: created, ...extra });
  const done = (e, committed, velocity, cycleTime) => ({ status: "completed", endedAt: new Date(e.getFullYear(), e.getMonth(), e.getDate(), 16).toISOString(), kpis: { committed, velocity, cycleTime, recordedAt: now() } });
  const history = [
    [19, "Launch guest checkout", 30, 24, 5.8],
    [20, "Reduce payment failures on Android", 32, 27, 5.1],
    [21, "Send order tracking emails", 34, 33, 4.6],
    [22, "Accept gift cards at checkout", 36, 29, 4.9],
  ];
  history.forEach(([n, goal, committed, velocity, cycleTime], i) => {
    const s = add(mon, -14 * (5 - i)), e = add(s, 11);
    sprint(`s${n}`, `Sprint ${n}`, goal, s, e, done(e, committed, velocity, cycleTime), `2025-12-0${i + 1}T09:00:00Z`);
  });
  sprint("s23", "Sprint 23", "Ship saved cards for returning customers", lastS, lastE, done(lastE, 34, 32, 4.2), "2026-01-01T09:00:00Z");
  sprint("s24", "Sprint 24", "Cut checkout drop-off on mobile by simplifying the address step", curS, curE, { status: "active", startedAt: new Date(curS.getFullYear(), curS.getMonth(), curS.getDate(), 10).toISOString() }, "2026-01-02T09:00:00Z");

  const votes = n => Array.from({ length: n }, (_, i) => `sample${i}`);
  const note = (id, kind, text, v, ownerId, done, n) => {
    const doc = { sprintId: "s23", kind, text, votes: votes(v), sample: true, createdAt: new Date(lastE.getFullYear(), lastE.getMonth(), lastE.getDate(), 15, 30 + n).toISOString() };
    if (kind === "action") Object.assign(doc, { ownerId, done });
    d.collections.retroItems[id] = doc;
  };
  note("r1", "well", "Pairing Mei and Lucas on the card vault integration cut review time in half", 4, "", false, 1);
  note("r2", "well", "Feature flag let us release saved cards to 10% of users on day 8", 3, "", false, 2);
  note("r3", "well", "Stand-ups stayed under 15 minutes all sprint", 1, "", false, 3);
  note("r4", "improve", "Staging was down for two days and blocked QA", 5, "", false, 4);
  note("r5", "improve", "Stories entered the sprint without acceptance criteria", 3, "", false, 5);
  note("r6", "improve", "PR reviews waited over a day on average", 2, "", false, 6);
  note("r7", "action", "Add a staging health check to the team channel", 0, "m3", true, 7);
  note("r8", "action", "No story enters planning without acceptance criteria", 0, "m2", false, 8);
  note("r9", "action", "Review-first hour: everyone clears open PRs before 11:00", 0, "m1", false, 9);

  const story = (id, key, title, points, n) => {
    const doc = { key, title, sprintId: "s24", points, sample: true, createdAt: new Date(curS.getFullYear(), curS.getMonth(), curS.getDate(), 10, 30 + n).toISOString() };
    if (points != null) Object.assign(doc, { voteCount: 4, average: points, estimatedAt: now() });
    d.collections.stories[id] = doc;
  };
  story("st1", "CHK-301", "Autocomplete addresses from postcode", 5.3, 1);
  story("st2", "CHK-302", "Remember last-used shipping address", 3, 2);
  story("st3", "CHK-305", "Inline validation for phone numbers", 2.5, 3);
  story("st4", "CHK-307", "Collapse billing address when same as shipping", null, 4);
  story("st5", "CHK-310", "Track address-step drop-off in analytics", null, 5);
  story("st6", "CHK-312", "Apple Pay express checkout on product page", null, 6);

  d.poker = { ...emptyPoker(), roundId: newID(), storyId: "st4", storyKey: "CHK-307", storyTitle: "Collapse billing address when same as shipping",
    votes: { m3: "3", m4: "5", m5: "3" }, recorded: { m3: true, m4: true, m5: true }, startedAt: now() };
}

// ---------- startup ----------

function dataDir() {
  const dir = appDir();
  try {
    const probe = path.join(dir, ".sprint-room-write-test");
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return dir;
  } catch {
    const base = process.env.APPDATA || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config"));
    const alt = path.join(base, "SprintRoom");
    fs.mkdirSync(alt, { recursive: true });
    return alt;
  }
}

function lanIPs() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254."))
    .map(a => a.address);
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref(); } catch {}
}

function fatal(msg) {
  console.log("\n  Sprint Room could not start:\n  " + msg + "\n");
  if (!process.stdin.isTTY) process.exit(1);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("  Press Enter to close this window.", () => process.exit(1));
}

function listen(server, port, last) {
  return new Promise((resolve, reject) => {
    const attempt = p => {
      if (p > last) return reject(new Error(`Ports ${port}-${last} are all in use. Is Sprint Room already running?`));
      server.once("error", e => (e.code === "EADDRINUSE" || e.code === "EACCES" ? attempt(p + 1) : reject(e)));
      server.listen(p, () => resolve(p));
    };
    attempt(port);
  });
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2), // in a packaged .exe argv[1] is also the executable path
    options: { port: { type: "string", default: "4280" }, data: { type: "string" }, "no-browser": { type: "boolean", default: false } },
    allowPositionals: true,
    strict: false,
  });
  const port = Number(values.port) || 4280;

  const store = new Store(values.data || path.join(dataDir(), "sprint-room-data.json"));
  try {
    if (!store.load()) { seed(store); store.save(); }
  } catch (e) { return fatal(e.message.includes("JSON") ? e.message : `Can't use the data file at ${store.file}: ${e.message}`); }

  const app = new SprintRoom(store);
  const server = http.createServer((req, res) => app.handle(req, res));
  server.headersTimeout = 10000;
  server.requestTimeout = 0; // live-update streams stay open

  let chosen;
  try { chosen = await listen(server, port, port + 19); }
  catch (e) { return fatal(e.message); }
  app.joinURLs = lanIPs().map(ip => `http://${ip}:${chosen}`);

  const local = `http://localhost:${chosen}`;
  console.log([
    "", "  ==============================================", `   SPRINT ROOM ${VERSION} is running`, "  ==============================================", "",
    `  Open on this computer:  ${local}`,
    ...(app.joinURLs.length ? ["", "  Teammates on the same network open:", ...app.joinURLs.map(u => "    " + u)] : []),
    "", `  Data file: ${store.file}`, "",
    "  Keep this window open while you use Sprint Room.",
    "  Close it (or press Ctrl+C) to stop. Your data stays saved.", "",
  ].join("\n"));
  if (!values["no-browser"]) setTimeout(() => openBrowser(local), 400);
}

main();
