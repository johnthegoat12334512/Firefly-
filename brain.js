/* Brain kit: an Obsidian-style living graph for any project. One file, no dependencies.
 *
 *   const brain = Brain.mount(document.getElementById("here"), {
 *     hub:  {id:"lead", label:"Lead", color:"#8b6cef", info:"Runs the team"},       // centre of the circle
 *     top:  {id:"owner", label:"Owner", color:"#f0f0f0"},                             // optional, just above the hub
 *     ring: [{id:"scout", label:"Scout", color:"#f2e36b", info:"Finds trends"}, ...], // members, evenly on a circle
 *     notes:[{id:"Home", text:"# Home\n- see [[Lessons]]", links:["Lessons"], attach:"lead"}, ...], // vault notes
 *     extra:{nodes:[{id:"x", label:"Card 12", color:"#8a8a8a"}], links:[["scout","x"]]},           // anything else
 *     onSelect(node){ ... },     // click on a node (notes open in the built-in viewer unless noteViewer:false)
 *   });
 *   brain.update(sameShapeAsAbove);   brain.setActive(["scout"]);   brain.pulse("lead","scout");   brain.burst("lead");
 *   brain.focus("scout");   brain.fit();   brain.openNote("Home");   brain.destroy();
 *
 * Light on the machine: draws only when something moves or changes, at most 30 frames a second; glows are cached.
 */
(function (root) {
  "use strict";
  const CSS = `
.bk{position:relative;overflow:hidden;background:var(--bk-bg,#1e1e1e);font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#dadada}
.bk canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab}
.bk canvas.bk-drag{cursor:grabbing}
.bk-tip{position:absolute;pointer-events:none;background:#262626;border:1px solid #3a3a3a;border-radius:6px;box-shadow:0 4px 14px #0006;padding:7px 9px;font-size:12px;max-width:260px;display:none;z-index:3}
.bk-tip b{display:block;font-weight:600;margin-bottom:2px}.bk-tip small{color:#9a9a9a}
.bk-zoom{position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;gap:6px;z-index:2}
.bk-zoom button{width:30px;height:30px;border-radius:5px;background:#252525;border:1px solid #2e2e2e;color:#9a9a9a;cursor:pointer;font:inherit}
.bk-note{position:absolute;right:14px;top:14px;bottom:14px;width:min(440px,calc(100% - 28px));background:#181818;border:1px solid #3a3a3a;border-radius:8px;box-shadow:0 10px 30px #0008;display:flex;flex-direction:column;z-index:4}
.bk-note[hidden]{display:none}
.bk-note header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #2e2e2e}
.bk-note header b{font-size:14px;flex:1}
.bk-note header button{background:none;border:1px solid #3a3a3a;border-radius:5px;color:#9a9a9a;padding:4px 9px;cursor:pointer;font:inherit;font-size:12px}
.bk-nb{overflow-y:auto;padding:12px 14px;font-size:13.5px;line-height:1.55;color:#d6d6d6}
.bk-nb h1,.bk-nb h2,.bk-nb h3{font-size:15px;font-weight:600;margin:14px 0 6px;color:#ececec}.bk-nb h1{font-size:17px;margin-top:2px}
.bk-nb ul{margin:4px 0;padding-left:18px}.bk-nb p{margin:6px 0}
.bk-nb code{font:12px ui-monospace,Menlo,monospace;background:#252525;padding:1px 4px;border-radius:3px}
.bk-nb table{border-collapse:collapse;width:100%;font-size:12.5px}.bk-nb th,.bk-nb td{text-align:left;padding:5px 4px;border-bottom:1px solid #2e2e2e}
.bk-nb a{color:#a68af9;cursor:pointer;border-bottom:1px dotted #a68af9;text-decoration:none}
.bk-chat{display:flex;flex-direction:column;min-height:0;background:#181818;border-left:1px solid #2e2e2e;color:#dadada;font-family:Inter,"Segoe UI",system-ui,sans-serif}
.bk-msgs{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:11px;min-height:0}
.bk-m{display:grid;grid-template-columns:20px minmax(0,1fr);gap:8px;font-size:13.5px}
.bk-m i{width:20px;height:20px;border-radius:5px;display:block}
.bk-m b{font-weight:600;font-size:13px}.bk-m small{color:#777;margin-left:6px;font-size:11px}
.bk-m div.t{white-space:pre-wrap;overflow-wrap:anywhere;color:#d3d3d3;margin-top:2px}
.bk-m.you div.t{color:#f0f0f0}.bk-m.wait div.t{color:#888}
.bk-to{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding:8px 12px 0}
.bk-to button{flex:none;background:none;border:0;border-radius:5px;padding:5px 8px;color:#9a9a9a;font:inherit;font-size:12.5px;cursor:pointer;display:flex;gap:6px;align-items:center}
.bk-to button i{width:8px;height:8px;border-radius:50%}.bk-to button[aria-pressed="true"]{background:#252525;color:#ececec}
.bk-in{display:flex;gap:8px;padding:8px 12px 12px}
.bk-in textarea{flex:1;min-width:0;resize:none;min-height:40px;max-height:140px;background:#252525;border:1px solid #3a3a3a;border-radius:6px;color:#ececec;padding:9px 11px;font:inherit;font-size:13.5px}
.bk-in button{flex:none;border:0;border-radius:6px;background:#8b6cef;color:#fff;padding:0 14px;font:inherit;font-weight:500;cursor:pointer}
.bk-note2{color:#777;font-size:11.5px;padding:0 12px 8px}`;

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  function hexA(hex, a) {
    const h = String(hex || "#888").replace("#", ""); const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${v >> 16 & 255},${v >> 8 & 255},${v & 255},${a})`;
  }

  /* Markdown for notes: headings, lists, tables, **bold**, `code`, [[wikilinks]] (clickable). Escapes everything first. */
  function markdown(text) {
    const inline = (t) => esc(t).replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, id, alias) => `<a data-note="${esc(id.trim())}">${esc((alias || id).trim())}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
    let html = "", list = false, tbl = [], para = [];
    const table = (rows) => { const cells = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      return `<div style="overflow-x:auto;margin:6px 0"><table>${cells.map((r, i) => `<tr>${r.map((c) => i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join("")}</tr>`).join("")}</table></div>`; };
    const flush = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } if (list) { html += "</ul>"; list = false; } if (tbl.length) { html += table(tbl); tbl = []; } };
    for (const line of String(text || "").replace(/^---[\s\S]*?\n---\n/, "").split("\n")) {
      if (/^\s*\|/.test(line)) { if (para.length || list) { const t = tbl; tbl = []; flush(); tbl = t; } tbl.push(line); continue; }
      if (tbl.length) flush();
      const h = line.match(/^(#{1,3})\s+(.*)/), li = line.match(/^\s*[-*]\s+(.*)/);
      if (h) { flush(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; }
      else if (li) { if (para.length) { const l = list; list = false; flush(); list = l; } if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(li[1])}</li>`; }
      else if (line.trim()) { if (list) { html += "</ul>"; list = false; } para.push(line.trim()); }
      else flush();
    }
    flush(); return html;
  }

  function mount(el, opts) {
    if (!document.getElementById("bk-css")) { const st = document.createElement("style"); st.id = "bk-css"; st.textContent = CSS; document.head.append(st); }
    el.classList.add("bk");
    el.insertAdjacentHTML("beforeend", `<canvas aria-label="Graph"></canvas><div class="bk-tip"></div>
      <div class="bk-zoom"><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="fit" aria-label="Fit">◎</button></div>
      <aside class="bk-note" hidden><header><b></b><button type="button">Close</button></header><div class="bk-nb"></div></aside>`);
    const cv = el.querySelector("canvas"), ctx = cv.getContext("2d"), tip = el.querySelector(".bk-tip"), noteEl = el.querySelector(".bk-note");
    let o = opts || {};
    let W = 0, H = 0, dpr = 1, nodes = [], edges = [], byId = new Map(), adj = new Map();
    let view = {x: 0, y: 0, k: 1}, hover = null, hl = null, drag = null, pan = null, alpha = 1, dirty = true, alive = true;
    const active = new Set(), pulses = [], pointers = new Map(); let pinch = null;
    const FONT = getComputedStyle(el).fontFamily, MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
    const sprites = new Map(), auras = new Map();

    function sprite(color) {
      let c = sprites.get(color); if (c) return c;
      c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d");
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); sprites.set(color, c); return c;
    }
    function resize() { const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; sky = null; dirty = true; requestAnimationFrame(() => { if (alive) fit(); }); }

    /* ---------- theme: flat and quiet, like a good notes app; override any colour with opts.theme ---------- */

    const T = Object.assign({bg: "#050912", node: "#8e9196", text: "#dfe8f5", faintText: "#8fa3c0", line: "rgba(120,190,200,.20)", bridge: "rgba(127,220,255,.16)", accent: "#7fdcff"}, opts?.theme || {});
    let clock = 0;   // ms, for the slow drift of each chart
    /* ---------- the universe: painted once per size, then just copied each frame ---------- */
    let sky = null, twinklers = [], shocks = [];
    const rand = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const STAR_TINTS = ["#cfe0ff", "#e8efff", "#ffffff", "#fff4e6", "#ffe2bf", "#bcd4ff"];
    const PAD = 220;   // the sky is painted larger than the screen so it can drift with the camera
    function paintSky() {
      const w = Math.ceil(W + PAD * 2), h = Math.ceil(H + PAD * 2), c = document.createElement("canvas");
      c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr); const x = c.getContext("2d"); x.scale(dpr, dpr);
      const R = rand(7919);
      const base = x.createRadialGradient(w * .55, h * .42, 0, w * .55, h * .42, Math.max(w, h) * .8);
      base.addColorStop(0, "#08080a"); base.addColorStop(.55, "#040405"); base.addColorStop(1, "#000000");
      x.fillStyle = base; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = "lighter";
      // nebulae: soft clouds of deep blue, teal and a little violet
      const clouds = [["#3a3a44", .07], ["#2b2733", .06], ["#25302f", .05], ["#332b2b", .04]];   // barely-there neutral haze
      for (let i = 0; i < 14; i++) { const [col, a] = clouds[i % clouds.length], cx = R() * w, cy = R() * h, rr = (0.18 + R() * 0.35) * Math.max(w, h);
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr); g.addColorStop(0, hexA(col, a * (0.5 + R() * 0.6))); g.addColorStop(1, hexA(col, 0));
        x.fillStyle = g; x.fillRect(0, 0, w, h); }
      // the galactic band: a tilted haze with a dense river of faint stars
      x.save(); x.translate(w / 2, h / 2); x.rotate(-0.42);
      const bandW = Math.hypot(w, h), bandH = Math.min(w, h) * .32;
      const bg = x.createLinearGradient(0, -bandH, 0, bandH); bg.addColorStop(0, "rgba(200,200,210,0)"); bg.addColorStop(.5, "rgba(210,210,220,.035)"); bg.addColorStop(1, "rgba(120,150,220,0)");
      x.fillStyle = bg; x.fillRect(-bandW / 2, -bandH, bandW, bandH * 2);
      for (let i = 0; i < 2600; i++) { const g1 = (R() + R() + R() - 1.5) / 1.5; const px = (R() - .5) * bandW, py = g1 * bandH;
        x.fillStyle = hexA(STAR_TINTS[i % STAR_TINTS.length], .08 + R() * .35); const s1 = R() < .97 ? .55 : 1.1; x.fillRect(px, py, s1, s1); }
      x.restore();
      // the star field
      for (let i = 0; i < 1100; i++) { const px = R() * w, py = R() * h, big = R(), size = big > .985 ? 1.6 : big > .9 ? 1.05 : .6;
        x.fillStyle = hexA(STAR_TINTS[Math.floor(R() * STAR_TINTS.length)], .25 + R() * .6); x.beginPath(); x.arc(px, py, size, 0, Math.PI * 2); x.fill(); }
      x.globalCompositeOperation = "source-over";
      // a soft vignette keeps the edges deep
      const v = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .35, w / 2, h / 2, Math.max(w, h) * .75); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.55)");
      x.fillStyle = v; x.fillRect(0, 0, w, h);
      sky = c;
      let cs = 9001; const CR = () => ((cs = (cs * 16807) % 2147483647) / 2147483647);
      constellations = Array.from({length: 20}, () => { const cx = (CR() - .5) * 1.6, cy = (CR() - .5) * 1.6, n = 4 + Math.floor(CR() * 4), pts = [];
        let px = cx, py = cy; for (let i = 0; i < n; i++) { px += (CR() - .5) * .16; py += (CR() - .5) * .16; pts.push([px, py, .6 + CR() * .9]); } return pts; });
      twinklers = Array.from({length: Math.round(Math.min(60, W * H / 20000))}, () => ({x: R() * w, y: R() * h, r: .7 + R() * 1.3, a: .35 + R() * .5, f: .4 + R() * 1.4, p: R() * 6.28, c: STAR_TINTS[Math.floor(R() * STAR_TINTS.length)], flare: R() < .18}));
    }
    let constellations = [];
    function drawConstellations(t) {   // faint star patterns turning very slowly behind everything
      const ang = calm ? 0 : t / 600000, ca = Math.cos(ang), sa = Math.sin(ang), S = Math.max(W, H) * .75, cx = W / 2, cy = H / 2;
      const at = ([x, y]) => [cx + (x * ca - y * sa) * S, cy + (x * sa + y * ca) * S];
      for (const c of constellations) { ctx.strokeStyle = "rgba(220,225,235,.10)"; ctx.lineWidth = .6; ctx.beginPath();
        c.forEach((p, i) => { const [x, y] = at(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
        for (const p of c) { const [x, y] = at(p); ctx.fillStyle = "rgba(220,232,255,.55)"; ctx.beginPath(); ctx.arc(x, y, p[2], 0, Math.PI * 2); ctx.fill(); } }
    }
    function drawSky(t) {
      if (!sky) paintSky();
      const ox = Math.max(-PAD, Math.min(PAD, -view.x * view.k * .045)), oy = Math.max(-PAD, Math.min(PAD, -view.y * view.k * .045));
      ctx.drawImage(sky, -PAD + ox, -PAD + oy, W + PAD * 2, H + PAD * 2);
      drawConstellations(t);
      if (calm) return;
      for (const s of twinklers) { const a = s.a * (0.55 + 0.45 * Math.sin(t / 1000 * s.f + s.p)), px = s.x - PAD + ox, py = s.y - PAD + oy;
        if (px < -4 || py < -4 || px > W + 4 || py > H + 4) continue;
        ctx.globalAlpha = a; ctx.drawImage(sprite(s.c), px - s.r * 3, py - s.r * 3, s.r * 6, s.r * 6);
        if (s.flare) { ctx.strokeStyle = hexA(s.c, a * .5); ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(px - s.r * 5, py); ctx.lineTo(px + s.r * 5, py); ctx.moveTo(px, py - s.r * 5); ctx.lineTo(px, py + s.r * 5); ctx.stroke(); } }
      ctx.globalAlpha = 1;
    }

    const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ro = new ResizeObserver(resize); ro.observe(cv); resize();

    function build() {
      const keep = new Map(nodes.map((n) => [n.id, n])); nodes = []; edges = []; byId = new Map(); adj = new Map();
      const add = (id, props) => { const old = keep.get(id); const a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 160;
        const n = {id, x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0, deg: 0, ...props};
        if (old) Object.assign(n, {x: old.x, y: old.y, vx: old.vx, vy: old.vy, fixed: old.fixed, userMoved: old.userMoved});
        byId.set(id, n); nodes.push(n); adj.set(id, new Set()); return n; };
      const link = (a, b) => { if (a === b || !byId.has(a) || !byId.has(b)) return; const k = a < b ? a + "|" + b : b + "|" + a;
        if (edges.some((e) => e.k === k)) return; edges.push({k, a, b}); adj.get(a).add(b); adj.get(b).add(a); byId.get(a).deg++; byId.get(b).deg++; };
      const place = (id, x, y) => { const n = byId.get(id); if (n && !n.userMoved) { n.x = x; n.y = y; n.vx = n.vy = 0; n.fixed = true; } };
      const hub = o.hub, ring = o.ring || [], notes = o.notes || [], extra = o.extra || {};
      if (hub) add(hub.id, {kind: "hub", r: 8, ...hub});
      if (o.top) { add(o.top.id, {kind: "top", r: 11, ...o.top}); if (hub) link(o.top.id, hub.id); }
      for (const m of ring) { add(m.id, {kind: "member", r: 7.5, ...m}); if (hub) link(hub.id, m.id); }
      const R = o.radius || 270;
      if (o.layout === "hierarchy") {
        /* Left to right: the person, the Lead, then the crew from strongest/most used to weakest. Members zig-zag a little
         * so every line from the Lead stays visible. rank feeds the dot size: earlier = bigger. */
        const chain = [o.top, hub, ...ring].filter(Boolean);
        const members = (id) => (o.notes || []).filter((nt) => nt.group === id).length + ((o.extra || {}).nodes || []).filter((e) => e.group === id).length;
        const size = (m) => 44 + 16 * Math.sqrt(members(m.id));   // a chart's radius grows with what's in it
        let x = 0; const xs = chain.map((m, i) => (x += i ? size(chain[i - 1]) + size(m) + 34 : 0));
        const mid = (xs[0] + xs[xs.length - 1]) / 2;
        chain.forEach((m, i) => { const n = byId.get(m.id); if (n) { n.rank = i; n.group = n.id; n.phase = i * 1.7; n.size = size(m); }
          place(m.id, xs[i] - mid, 0); });
      } else {
        if (hub) place(hub.id, 0, 0); if (o.top) place(o.top.id, 0, -105);
        ring.forEach((m, i) => { const a = -Math.PI / 2 + (i + 0.5) / ring.length * Math.PI * 2; place(m.id, Math.cos(a) * R, Math.sin(a) * R); });
      }
      notes.forEach((nt, i) => { const n = add("note:" + nt.id, {kind: "note", label: nt.title || nt.id, color: o.noteColor || "#d9d3f7", note: nt, info: nt.path || "note", group: nt.group || null});
        if (!keep.has("note:" + nt.id)) { const c = n.group && byId.get(n.group), a = i * 2.39996, d = c ? 30 + 9 * Math.sqrt(i) : R * .6;
          n.x = (c ? c.x : 0) + Math.cos(a) * d; n.y = (c ? c.y : 0) + Math.sin(a) * d; } });
      for (const nt of notes) { for (const l of nt.links || []) link("note:" + nt.id, "note:" + l); if (nt.attach) link("note:" + nt.id, nt.attach); }
      (extra.nodes || []).forEach((e, i) => { const fresh = !keep.has(e.id), n = add(e.id, {kind: "extra", ...e}), c = n.group && byId.get(n.group);
        if (fresh && c) { const a = i * 2.39996 + 1, d = 34 + 8 * Math.sqrt(i % 60); n.x = c.x + Math.cos(a) * d; n.y = c.y + Math.sin(a) * d; } });
      for (const [a, b] of extra.links || []) link(a, b);
      for (const n of nodes) if (n.r == null) n.r = 2.6 + Math.min(5, Math.sqrt(n.deg) * 1.4);
      const stars = nodes.filter((n) => n.kind === "note").sort((a, b) => b.deg - a.deg || String(a.label).localeCompare(String(b.label)));
      const named = Math.max(6, Math.ceil(stars.length * 0.14)), spiked = Math.max(2, Math.ceil(stars.length * 0.06));
      stars.forEach((n, i) => { n.named = i < named; n.spiked = i < spiked && n.deg >= 2; });
      if (o.layout === "solar") planSolar();
      alpha = 1; dirty = true;
    }
    const BIG = (n) => n.kind === "hub" || n.kind === "top" || n.kind === "member";
    function step() {
      if (o.layout === "solar") return;
      const k = alpha; if (k < 0.002 && !drag) return;
      for (let i = 0; i < nodes.length; i++) { const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) { const b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y; const d2 = dx * dx + dy * dy + 0.01;
          if (d2 > 250000) continue;
          const apart = (a.group || a.id) !== (b.group || b.id);
          const f = (BIG(a) && BIG(b) ? 5200 : apart ? 6000 : 1600) / d2 * k; const d = Math.sqrt(d2);
          dx /= d; dy /= d; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f; } }
      for (const e of edges) { const a = byId.get(e.a), b = byId.get(e.b); const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (BIG(a) && BIG(b)) continue;   // the bridges between charts don't pull: the charts keep their places
        const cross = (a.group || a.id) !== (b.group || b.id); if (cross) continue;   // links into another chart are drawn, not pulled
        const want = BIG(a) || BIG(b) ? 64 : 40; const f = (d - want) / d * 0.03 * k; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; }
      for (const n of nodes) { const c = n.group && n.group !== n.id ? byId.get(n.group) : null;
        if (c) { n.vx += (c.x - n.x) * 0.006 * k; n.vy += (c.y - n.y) * 0.006 * k; }
        else { const pull = n.kind === "note" ? 0.0009 : 0.0025; n.vx -= n.x * pull * k; n.vy -= n.y * pull * k; }
        if (n === drag?.n || n.fixed) { n.vx = n.vy = 0; continue; } n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy; }
      if (o.layout !== "solar") { separate(); keepInCharts(); }
      alpha *= 0.985;
    }
    /* Nothing may sit on anything else. Each node takes the space it really uses on screen (a card, or a note icon with
     * its label underneath), converted to graph units at the current zoom, so the layout stays clean at every zoom. */
    /* Sizes are in graph units (they grow and shrink with zoom, like a notes-app graph). */
    const LABELS_AT = 0.85;   // below this zoom, small dots hide their names (they fade in above it)
    const zoomR = (r) => r * Math.max(0.55, Math.min(2.2, view.k));
    const nodeR = (n) => o.layout === "solar" ? solarR(n) * Math.max(0.6, Math.min(2.4, view.k)) : BIG(n) ? zoomR(n.rank == null ? (n.kind === "hub" ? 8 : 7) : Math.max(5, 9 - n.rank * 0.45)) : zoomR(2.2 + Math.min(3.6, Math.sqrt(n.deg || 0) * 1.05));
    const labelAlpha = (n) => BIG(n) ? 1 : Math.max(0, Math.min(1, (view.k - LABELS_AT) / 0.35));
    function footprint(n) {
      const kk = view.k || 1, r = nodeR(n);
      if (!BIG(n) && labelAlpha(n) <= 0) return {hw: (r + 6) / kk, hh: (r + 6) / kk, ox: 0, oy: 0};
      const chars = Math.min(BIG(n) ? 18 : 26, String(n.label ?? n.id).length), cw = BIG(n) ? 7.4 : 6;
      if (BIG(n) && n.size) return {hw: (r + 12) / kk, hh: (r + 12) / kk, ox: 0, oy: 0};   // title sits above the chart, outside it
      if (BIG(n)) return {hw: Math.max(r + 16, chars * cw / 2 + 10) / kk, hh: (r * 2 + 50) / kk / 2, ox: 0, oy: 16 / kk};
      return {hw: Math.max(r + 6, chars * cw / 2 + 4) / kk, hh: (r * 2 + 20) / kk / 2, ox: 0, oy: 9 / kk};
    }
    /* A chart's own dots stay inside its circle, so charts never run into each other. */
    function keepInCharts() {
      for (const n of nodes) { const c = n.group && n.group !== n.id ? byId.get(n.group) : null; if (!c || !c.size || n === drag?.n) continue;
        const dx = n.x - c.x, dy = n.y - c.y, d = Math.hypot(dx, dy) || 1, max = c.size - 10;
        if (d > max) { n.x = c.x + dx / d * max; n.y = c.y + dy / d * max; n.vx *= .3; n.vy *= .3; } }
    }
    function separate() {
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < nodes.length; i++) { const a = nodes[i], fa = footprint(a);
          for (let j = i + 1; j < nodes.length; j++) { const b = nodes[j];
            // Only the hub, the node being dragged and nodes the person placed by hand never move. Laid-out cards may be
            // nudged apart (that's how a narrow phone screen stays readable), but they give way far less than notes do.
            const still = (n) => n.kind === "hub" || n === drag?.n || n.userMoved || (o.layout === "hierarchy" && BIG(n));
            const aStill = still(a), bStill = still(b); if (aStill && bStill) continue;
            const fb = footprint(b), dx = (b.x + fb.ox) - (a.x + fa.ox), dy = (b.y + fb.oy) - (a.y + fa.oy);
            const ox = fa.hw + fb.hw - Math.abs(dx), oy = fa.hh + fb.hh - Math.abs(dy);
            if (ox <= 0 || oy <= 0) continue;
            const alongX = ox < oy, amount = alongX ? ox : oy, sign = (alongX ? dx : dy) || ((i + j) % 2 ? 1 : -1);
            const weight = (n) => (BIG(n) ? 1 : 6);   // how readily a node gives way
            const push = sign > 0 ? amount : -amount, share = aStill ? 0 : bStill ? 1 : weight(a) / (weight(a) + weight(b));
            if (alongX) { a.x -= push * share; b.x += push * (1 - share); a.vx *= 0.5; b.vx *= 0.5; }
            else { a.y -= push * share; b.y += push * (1 - share); a.vy *= 0.5; b.vy *= 0.5; } } } }
    }
    const toScreen = (n) => [(n.x - view.x) * view.k + W / 2, (n.y - view.y) * view.k + H / 2];
    const toWorld = (sx, sy) => [(sx - W / 2) / view.k + view.x, (sy - H / 2) / view.k + view.y];
    const trim = (s, n) => (s = String(s ?? "")).length > n ? s.slice(0, n - 1) + "…" : s;
    /* ---------- drawing: charts floating in a dark sky ----------
     * Every crew member is its own small graph (its dot in the middle, its skills, work and memories around it). The
     * charts sit left to right in rank order and drift very slowly. Hovering anything lights it and its links in the
     * accent colour and fades the rest; fades are eased, never snapped. */
    const drift = (n) => { const c = n.group ? byId.get(n.group) : null; if (!c || calm || o.layout === "solar") return [0, 0]; const p = c.phase || 0;
      return [Math.sin(clock / 9000 + p) * 5, Math.cos(clock / 11000 + p * 1.3) * 4]; };
    const eased = new Map();   // node id -> current brightness, eased toward its target
    function light(n, target) { const v = eased.get(n.id) ?? target, next = v + (target - v) * 0.22; eased.set(n.id, Math.abs(next - target) < 0.01 ? target : next); if (next !== target) dirty = true; return eased.get(n.id); }
    function text(str, x, y, color, font, alpha) { if (alpha <= 0) return; ctx.globalAlpha = alpha; ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = color; ctx.fillText(str, x, y); ctx.globalAlpha = 1; }
    /* ---------- solar mode: the hierarchy as a solar system ----------
     * The person is the sun. The Lead is the nearest planet (with a ring); the crew orbit further out from strongest
     * and most used to weakest. Each planet's skills and work circle it as moons. The shared memories are an outer
     * belt, still linked like a graph. Orbits follow Kepler (inner planets move faster), seen from slightly above. */
    const TILT = 0.5; let belt = 300;
    const hash = (str) => { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
    function solarR(n) {
      if (n.kind === "top") return 6.5;
      if (BIG(n)) return n.kind === "hub" ? 6 : 5;
      if (n.orbit?.parent) return 3 + Math.min(1.8, Math.sqrt(n.deg || 0) * .6);
      return 1.6 + Math.min(3, Math.sqrt(n.deg || 0) * .9);   // belt
    }
    function planSolar() {
      const sun = nodes.find((n) => n.kind === "top"), hubN = nodes.find((n) => n.kind === "hub");
      const planets = [hubN, ...(o.ring || []).map((m) => byId.get(m.id))].filter(Boolean);
      for (const n of nodes) { n.fixed = true; n.orbit = null; }
      if (sun) { sun.x = 0; sun.y = 0; sun.vault = 90; sun.pr = 20 + Math.sqrt(90) * 4.6; }
      let r = 0, prevSoi = (sun?.pr || 30) + 16;   // Dev's own reach
      planets.forEach((p, i) => {
        const inside = nodes.filter((m) => m !== p && m.group === p.id).length;
        p.vault = 45 + Math.min(110, inside * 8); p.pr = 20 + Math.sqrt(p.vault) * 4.6;   // the vault's radius, in graph units
        const moons = nodes.filter((m) => m !== p && m.group === p.id);
        let layer = 0, inLayer = 0, cap = 7, soi = p.pr + 14;
        moons.forEach((m) => { if (inLayer >= cap) { layer++; inLayer = 0; cap = 7 + layer * 6; } m.layer = layer; m.slot = inLayer++; });
        const layers = moons.length ? layer + 1 : 0;
        moons.forEach((m) => { const count = m.layer === layer ? inLayer : 7 + m.layer * 6, mr = p.pr + 14 + m.layer * 10;
          m.orbit = {parent: p, r: mr, speed: 0.00055 / (1 + m.layer * .6), phase: (m.slot / count) * Math.PI * 2 + m.layer * .7}; });
        soi = p.pr + 14 + Math.max(0, layers - 1) * 10 + (p.id === hubN?.id ? p.pr * 1.3 : 0) + 10;
        r += Math.max(70, prevSoi + soi + 26); prevSoi = soi;
        p.orbit = {r, speed: 0.00016 * Math.pow(120 / r, 1.5), phase: hash(p.id) * Math.PI * 2};
      });
      // the outer belt: memories in link order, so linked memories sit near each other
      const free = nodes.filter((n) => !n.orbit && n !== sun && !BIG(n));
      const order = [], seen = new Set();
      for (const start of free.slice().sort((a, b) => b.deg - a.deg)) { const q = [start];
        while (q.length) { const n = q.shift(); if (seen.has(n.id) || !free.includes(n)) continue; seen.add(n.id); order.push(n);
          for (const id of adj.get(n.id) || []) { const m = byId.get(id); if (m && !seen.has(m.id)) q.push(m); } } }
      belt = r + prevSoi + 60;
      const soft = (a, b) => { if (!a || !b || a === b) return; const k2 = a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id; if (edges.some((e) => e.k === k2)) return;
        edges.push({k: k2, a: a.id, b: b.id, soft: true}); adj.get(a.id).add(b.id); adj.get(b.id).add(a.id); };
      for (const e of edges.filter((x) => x.soft)) { adj.get(e.a)?.delete(e.b); adj.get(e.b)?.delete(e.a); }
      for (let i2 = edges.length - 1; i2 >= 0; i2--) if (edges[i2].soft) edges.splice(i2, 1);
      order.forEach((n, j) => { const jit = hash(n.id); n.orbit = {r: belt + (jit - .5) * 44, speed: 0.000022, phase: (j / Math.max(1, order.length)) * Math.PI * 2 + (jit - .5) * .12}; });
      order.forEach((n, j) => { soft(n, order[(j + 1) % order.length]); soft(n, order[(j + 3) % order.length]);
        const crew = [sun, ...planets].filter(Boolean); soft(n, crew[Math.floor(hash(n.id + "c") * crew.length)]); });
      updateSolar(clock);
    }
    function updateSolar(t) {
      const T = 0;   // the system holds still; only the background drifts
      const place = (n) => { if (n.pinned) { n.x = n.px; n.y = n.py; n.placed = true; return; } const ob = n.orbit; if (!ob) return; const c = ob.parent; if (c && !c.placed) place(c);
        const a = ob.phase + T * ob.speed, cx = c ? c.x : 0, cy = c ? c.y : 0; n.x = cx + Math.cos(a) * ob.r; n.y = cy + Math.sin(a) * ob.r * TILT; n.placed = true; };
      for (const n of nodes) n.placed = false;
      for (const n of nodes) place(n);
    }
    const mix = (hex, to, f) => { const h = String(hex).replace("#", ""), v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
      const ch = [v >> 16 & 255, v >> 8 & 255, v & 255].map((c) => Math.round(c + (to - c) * f)); return `rgb(${ch[0]},${ch[1]},${ch[2]})`; };
    /* Each crew member is a little vault: a dense scribble of dots and threads (teal memories, yellow work, violet
     * skills), generated once from its name so it never changes shape. Bigger vaults hold more. */
    const vaults = new Map();
    function vaultShape(n) {
      const key = n.id + ":" + (n.vault || 30); if (vaults.has(key)) return vaults.get(key);
      let seed = Math.floor(hash(n.id) * 2147483646) + 1; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const count = n.vault || 30, rad = (n.pr || 20) - 4, pts = [];
      for (let i = 0; i < count; i++) { const u = Math.max(1e-6, R()), v = R(), g = Math.sqrt(-2 * Math.log(u)) * .42, ang = v * Math.PI * 2;
        const d = Math.min(1, g) * rad, kind = R(); pts.push({x: Math.cos(ang) * d, y: Math.sin(ang) * d * .82, s: R() < .08 ? 1.7 : .55 + R() * .7,
          c: kind < .68 ? "#5fd4c4" : kind < .84 ? "#f2d06b" : kind < .97 ? "#b48cf7" : n.color || "#ffffff"}); }
      const lines = []; pts.forEach((p1, i) => { const near = pts.map((p2, j) => [j, (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2]).filter(([j]) => j !== i).sort((q, w) => q[1] - w[1]).slice(0, 3);
        for (const [j] of near) if (j > i || R() < .5) lines.push([i, j]); });
      const shape = {pts, lines}; vaults.set(key, shape); return shape;
    }
    function drawVault(n, x, y, a) {
      const v = vaultShape(n), k = view.k, s1 = Math.max(.6, Math.min(2, k));
      ctx.globalAlpha = a * .5; ctx.strokeStyle = "rgba(110,200,190,.55)"; ctx.lineWidth = .45; ctx.beginPath();
      for (const [i, j] of v.lines) { ctx.moveTo(x + v.pts[i].x * k, y + v.pts[i].y * k); ctx.lineTo(x + v.pts[j].x * k, y + v.pts[j].y * k); } ctx.stroke();
      for (const p of v.pts) { ctx.globalAlpha = a * .9; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(x + p.x * k, y + p.y * k, p.s * s1, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    /* Dev and every crew member: its vault, with its own dot and name in the middle. Identity comes later. */
    function drawBody(n, x, y, t, a, sunXY) {
      drawVault(n, x, y, a);
      const R = solarR(n) * Math.max(0.7, Math.min(2.2, view.k)), col = n.kind === "top" ? "#f4f1ea" : n.color || "#8ab4ff", on = active.has(n.id), sel = n === hover || n.id === hl;
      const dx = sunXY[0] - x, dy = sunXY[1] - y, L = Math.hypot(dx, dy) || 1, ux = n.kind === "top" ? -.4 : dx / L, uy = n.kind === "top" ? -.5 : dy / L;
      ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = a * (on ? .7 : .35); ctx.drawImage(sprite(col), x - R * 3, y - R * 3, R * 6, R * 6); ctx.globalCompositeOperation = "source-over";
      const g = ctx.createRadialGradient(x + ux * R * .45, y + uy * R * .45, R * .1, x, y, R);
      g.addColorStop(0, mix(col, 255, .75)); g.addColorStop(.5, col); g.addColorStop(1, mix(col, 0, .6));
      ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      if (on && !calm) { const k = (t % 1500) / 1500; ctx.globalAlpha = (1 - k) * .6 * a; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, R + 2 + k * 12, 0, Math.PI * 2); ctx.stroke(); }
      if (sel) { ctx.globalAlpha = a; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, R + 3, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = a * (sel ? 1 : Math.max(0, Math.min(1, (view.k - .3) / .15)) || (n.kind === "top" ? 1 : 0));
      if (ctx.globalAlpha > .02) { label(trim(n.label ?? n.id, 18), x, y + R + 11, "center", sel ? "#ffffff" : "#e6eefb", "600 11.5px " + FONT);
        if (on || n.sub) label(on ? "working" : trim(n.sub, 24), x, y + R + 25, "center", on ? col : "#8fa3c0", "10px " + FONT); }
      ctx.globalAlpha = 1;
    }
    /* Other systems far out in the sky: zoom out and the neighbourhood appears. Deterministic, so it never reshuffles. */
    let galaxy = null;
    function planGalaxy() { let seed = 4242; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const tints = ["#ffd9a0", "#bcd4ff", "#ffb3c7", "#a8f0e0", "#ffe9c4", "#c9b8ff"], out = [];
      for (let i = 0; i < 26; i++) { const ang = R() * Math.PI * 2, dist = belt * (3.2 + R() * 9), sz = .5 + R() * 1.1;
        out.push({x: Math.cos(ang) * dist, y: Math.sin(ang) * dist * .8, sz, tint: tints[i % tints.length], orbits: 1 + Math.floor(R() * 4),
          planets: Array.from({length: 1 + Math.floor(R() * 4)}, (_, j) => ({r: (55 + j * 42) * sz, ph: R() * 6.28, sp: .00012 / (1 + j), c: tints[(i + j + 2) % tints.length]}))}); }
      galaxy = {belt, out}; }
    function drawGalaxy(t) {
      if (!galaxy || galaxy.belt !== belt) planGalaxy();
      const k = view.k, T = 0;
      for (const g of galaxy.out) { const [x, y] = toScreen(g); const R = 30 * g.sz * k, reach = (g.planets.at(-1).r + 20) * k;
        if (x < -reach - 40 || y < -reach - 40 || x > W + reach + 40 || y > H + reach + 40) continue;
        const a = Math.min(1, .35 + .65 * (1 - Math.min(1, k / .6)));   // clearer the further out you are
        ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = .5 * a; ctx.drawImage(sprite(g.tint), x - Math.max(6, R * 4), y - Math.max(6, R * 4), Math.max(12, R * 8), Math.max(12, R * 8));
        ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = a; ctx.fillStyle = "#fff7e8"; ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, R * .45), 0, Math.PI * 2); ctx.fill();
        for (const p of g.planets) { ctx.globalAlpha = .07 * a; ctx.strokeStyle = "#b8c8ff"; ctx.lineWidth = .7; ctx.beginPath(); ctx.ellipse(x, y, p.r * k, p.r * k * TILT, 0, 0, Math.PI * 2); ctx.stroke();
          const pa = p.ph + T * p.sp, px = x + Math.cos(pa) * p.r * k, py = y + Math.sin(pa) * p.r * k * TILT;
          ctx.globalAlpha = .8 * a; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(px, py, Math.max(.8, 5 * g.sz * k), 0, Math.PI * 2); ctx.fill(); } }
      ctx.globalAlpha = 1;
    }
    function drawSolar(t) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawSky(t); drawGalaxy(t);
      const focus = hover?.id || hl; const nb = focus ? adj.get(focus) : null;
      const lit = (n) => light(n, !focus || n.id === focus || nb?.has(n.id) || (n.orbit?.parent && (n.orbit.parent.id === focus)) ? 1 : 0.16);
      const pos = new Map(); for (const n of nodes) pos.set(n.id, toScreen(n));
      const sun = nodes.find((n) => n.kind === "top"), sunXY = sun ? pos.get(sun.id) : toScreen({x: 0, y: 0}), mid = toScreen({x: 0, y: 0});
      const k = view.k;
      // orbits
      for (const n of nodes) { if (!BIG(n) || !n.orbit) continue; ctx.globalAlpha = .9 * (eased.get(n.id) ?? 1);
        ctx.strokeStyle = n.id === focus ? hexA(n.color || "#8ab4ff", .4) : "rgba(160,190,255,.065)"; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.ellipse(mid[0], mid[1], n.orbit.r * k, n.orbit.r * k * TILT, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = "rgba(140,200,255,.025)"; ctx.beginPath(); ctx.ellipse(mid[0], mid[1], (belt + 34) * k, (belt + 34) * k * TILT, 0, 0, Math.PI * 2);
      ctx.ellipse(mid[0], mid[1], (belt - 34) * k, (belt - 34) * k * TILT, 0, 0, Math.PI * 2, true); ctx.fill("evenodd");
      // lines: delegation from the Lead, moons to their planet, memories to each other
      for (const e of edges) { const a = byId.get(e.a), b = byId.get(e.b), [x1, y1] = pos.get(e.a), [x2, y2] = pos.get(e.b);
        const on = focus && (e.a === focus || e.b === focus), bridge = BIG(a) && BIG(b);
        const moon = (a.orbit?.parent === b || b.orbit?.parent === a), cross = !bridge && !moon && (a.group || "") !== (b.group || "");
        if (cross && !on && !e.soft) continue;
        ctx.globalAlpha = Math.min(eased.get(e.a) ?? 1, eased.get(e.b) ?? 1);
        ctx.strokeStyle = on ? "rgba(190,230,255,.7)" : e.soft ? "rgba(120,215,205,.075)" : bridge ? (active.has(e.a) || active.has(e.b) ? "rgba(127,220,255,.4)" : "rgba(127,200,255,.10)") : moon ? "rgba(200,220,255,.07)" : "rgba(120,215,205,.16)";
        ctx.lineWidth = on ? .9 : .55; if (bridge && !on) ctx.setLineDash([1.5, 6]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); }
      ctx.globalAlpha = 1;
      // bodies back to front, so nearer planets pass in front of farther ones
      const bodies = nodes.slice().sort((a, b) => pos.get(a.id)[1] - pos.get(b.id)[1]);
      for (const n of bodies) { const [x, y] = pos.get(n.id); if (x < -120 || y < -120 || x > W + 120 || y > H + 120) continue; const a = lit(n);
        if (BIG(n)) { drawBody(n, x, y, t, a, sunXY); continue; }
        const r = solarR(n) * Math.max(0.6, Math.min(2.4, k)), col = n === hover || n.id === hl ? "#ffffff" : dotColor(n), sel = n === hover || n.id === hl;
        ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = a * (sel ? .9 : n.named ? .55 : .3); ctx.drawImage(sprite(col), x - r * 5, y - r * 5, r * 10, r * 10); ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = a; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        const near = focus && nb?.has(n.id), show = sel || near || (!n.orbit?.parent && n.named && k > .55) || k > 1.6;
        if (show && a > .3) { ctx.globalAlpha = a; label(trim(n.label ?? n.id, 26), x + r + 6, y, "left", sel ? "#ffffff" : near ? "#d8e9ff" : "#9fb3d1", "11px " + FONT); }
        ctx.globalAlpha = 1; }
      // comets carrying work
      ctx.globalCompositeOperation = "lighter";
      for (let i = pulses.length - 1; i >= 0; i--) { const p = pulses[i]; p.t += p.v;
        const a = byId.get(p.a), b = byId.get(p.b); if (!a || !b) { pulses.splice(i, 1); continue; }
        if (p.t >= 1) { shocks.push({id: p.b, c: p.color, t0: t}); if (p.loop) { p.t = 0; p.trail = []; } else { pulses.splice(i, 1); continue; } }
        const [x1, y1] = pos.get(p.a), [x2, y2] = pos.get(p.b), u = p.t < .5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2, px = x1 + (x2 - x1) * u, py = y1 + (y2 - y1) * u;
        (p.trail = p.trail || []).push([px, py]); if (p.trail.length > 14) p.trail.shift();
        for (let j = 1; j < p.trail.length; j++) { const f = j / p.trail.length; ctx.strokeStyle = hexA(p.color, f * .5); ctx.lineWidth = f * 1.4; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(p.trail[j - 1][0], p.trail[j - 1][1]); ctx.lineTo(p.trail[j][0], p.trail[j][1]); ctx.stroke(); }
        ctx.globalAlpha = .9; ctx.drawImage(sprite(p.color), px - 5, py - 5, 10, 10); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py, 1.1, 0, Math.PI * 2); ctx.fill(); }
      for (let i = shocks.length - 1; i >= 0; i--) { const s2 = shocks[i], age = (t - s2.t0) / 700, n = byId.get(s2.id); if (age > 1 || !n) { shocks.splice(i, 1); continue; }
        const [x, y] = pos.get(n.id); ctx.globalAlpha = (1 - age) * .5; ctx.strokeStyle = s2.c; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, solarR(n) * k + 3 + age * 26, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.lineCap = "butt";
    }
    function draw(t) {
      if (o.layout === "solar") return drawSolar(t);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSky(t);
      const focus = hover?.id || hl; const nb = focus ? adj.get(focus) : null;
      const lit = (n) => light(n, !focus || n.id === focus || nb?.has(n.id) ? 1 : 0.14);
      const pos = new Map(); for (const n of nodes) { const [x, y] = toScreen(n), [dx, dy] = drift(n); pos.set(n.id, [x + dx, y + dy]); }
      // links: inside a chart, and the long bridges between charts
      for (const e of edges) { const a = byId.get(e.a), b = byId.get(e.b), [x1, y1] = pos.get(e.a), [x2, y2] = pos.get(e.b);
        const on = focus && (e.a === focus || e.b === focus), bridge = BIG(a) && BIG(b), working = bridge && (active.has(e.a) || active.has(e.b));
        const cross = !bridge && (a.group || a.id) !== (b.group || b.id);   // a task linked to an order in another chart
        if (cross && !on) continue;   // only shown while hovering, so the sky stays clean
        ctx.globalAlpha = Math.min(eased.get(e.a) ?? 1, eased.get(e.b) ?? 1);
        ctx.strokeStyle = on ? hexA(T.accent, .85) : working ? hexA(T.accent, .45) : bridge ? T.bridge : T.line; ctx.lineWidth = on ? 1.3 : 1;
        ctx.beginPath(); ctx.moveTo(x1, y1);
        if (bridge) { const [cx, cy] = bow(x1, y1, x2, y2, false); ctx.quadraticCurveTo(cx, cy, x2, y2); } else ctx.lineTo(x2, y2);
        ctx.stroke(); }
      ctx.globalAlpha = 1;
      // dots: memories and work first, then each chart's centre
      for (const pass of [0, 1]) for (const n of nodes) { if (BIG(n) !== !!pass) continue; const [x, y] = pos.get(n.id); if (x < -80 || y < -60 || x > W + 80 || y > H + 60) continue;
        const r = nodeR(n), sel = n === hover || n.id === hl, a = lit(n), on = active.has(n.id);
        ctx.globalAlpha = a;
        if (BIG(n)) { drawHolo(n, x, y, t, a < 0.5); ctx.globalAlpha = 1; continue; }
        if (false) {
          if (on && !calm) { const k = (t % 1600) / 1600; ctx.strokeStyle = hexA(n.color || T.accent, (1 - k) * .55); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 3 + k * 16, 0, Math.PI * 2); ctx.stroke(); }
          ctx.fillStyle = n.color || T.node; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          if (sel) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
          const ty = n.size ? y - n.size * view.k - 34 : y + r + 7;   // charts: a title above the circle; otherwise a name below the dot
          text(trim(n.label ?? n.id, 18), x, ty, sel ? "#ffffff" : T.text, "600 12.5px " + FONT, a);
          if (n.sub) text(trim(n.sub, 26), x, ty + 16, T.faintText, "11px " + FONT, a * .9);
        } else {
          const col = sel ? "#ffffff" : dotColor(n), big = (n.deg || 0) >= 3;
          if (big || sel) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = a * (sel ? .9 : .45); ctx.drawImage(sprite(col), x - r * 4, y - r * 4, r * 8, r * 8); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = a; }
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          const la = sel || (focus && nb?.has(n.id)) ? 1 : labelAlpha(n);
          if (a * la > 0.02) { ctx.globalAlpha = a * la; label(trim(n.label ?? n.id, 26), x, y + r + 9, "center", sel ? "#ffffff" : "#a9bcd6", "11px " + FONT); ctx.globalAlpha = 1; }
        }
        ctx.globalAlpha = 1; }
      // the little coloured balls that carry work between charts
      for (let i = pulses.length - 1; i >= 0; i--) { const p = pulses[i]; p.t += p.v;
        const a = byId.get(p.a), b = byId.get(p.b); if (!a || !b) { pulses.splice(i, 1); continue; }
        if (p.t >= 1) { shocks.push({id: p.b, c: p.color, t0: t}); if (p.loop) { p.t = 0; p.trail = []; } else { pulses.splice(i, 1); continue; } }
        const [x1, y1] = pos.get(p.a), [x2, y2] = pos.get(p.b), u = p.t < .5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2;
        const curved = BIG(a) && BIG(b), [cx, cy] = curved ? bow(x1, y1, x2, y2, false) : [(x1 + x2) / 2, (y1 + y2) / 2];
        const [px, py] = along(x1, y1, cx, cy, x2, y2, u);
        (p.trail = p.trail || []).push([px, py]); if (p.trail.length > 7) p.trail.shift();
        p.trail.forEach(([tx, ty], j) => { ctx.globalAlpha = (j + 1) / p.trail.length * .35; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(tx, ty, 2.2, 0, Math.PI * 2); ctx.fill(); });
        ctx.globalAlpha = 1; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(px, py, 3.6, 0, Math.PI * 2); ctx.fill(); }
      for (let i = shocks.length - 1; i >= 0; i--) { const s2 = shocks[i], age = (t - s2.t0) / 600, n = byId.get(s2.id); if (age > 1 || !n) { shocks.splice(i, 1); continue; }
        const [x, y] = pos.get(n.id); ctx.globalAlpha = (1 - age) * .6; ctx.strokeStyle = s2.c; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, nodeR(n) + 2 + age * 14, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    const HOLO = "#7fdcff";
    const holoR = (n) => (n.kind === "hub" ? 15 : n.kind === "top" ? 12 : Math.max(10, 14 - (n.rank || 2) * 0.45)) * Math.max(0.7, Math.min(1.35, view.k));
    function label(str, x, y, align, color, font) { ctx.font = font; ctx.textAlign = align; ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(1,3,10,.95)"; ctx.shadowBlur = 6; ctx.fillStyle = color; ctx.fillText(str, x, y); ctx.fillText(str, x, y); ctx.shadowBlur = 0; }
    function drawHolo(n, x, y, t, dim) {
      const R = holoR(n), on = active.has(n.id), sel = n === hover || n.id === hl, col = n.color || HOLO;
      ctx.globalAlpha = dim ? .22 : 1;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (dim ? .1 : on ? .55 : .3); ctx.drawImage(sprite(col), x - R * 2.6, y - R * 2.6, R * 5.2, R * 5.2);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = dim ? .22 : 1;
      // inner ring and core
      ctx.strokeStyle = hexA(col, sel ? .95 : .6); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = hexA(col, .12); ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, R * .26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, Math.max(1, R * .09), 0, Math.PI * 2); ctx.fill();
      // rotating arc segments: faster when this member is working
      const spin = calm ? 0 : t / (on ? 700 : 4200) * (n.kind === "hub" ? -1 : 1);
      ctx.strokeStyle = hexA(HOLO, on ? .9 : sel ? .7 : .38); ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) { const a0 = spin + i * 2.094; ctx.beginPath(); ctx.arc(x, y, R + 6, a0, a0 + .9); ctx.stroke(); }
      // tick ring
      ctx.strokeStyle = hexA(HOLO, on ? .5 : .2); ctx.lineWidth = 1;
      ctx.beginPath(); for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2 - spin * .25, r1 = R + 10, r2 = R + (i % 9 === 0 ? 15 : 12);
        ctx.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2); } ctx.stroke();
      if (n.kind === "hub") {   // the Lead: a targeting reticle
        const b = R + 22, k2 = 7; ctx.strokeStyle = hexA(HOLO, .55); ctx.lineWidth = 1.2; ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(x + sx * b, y + sy * (b - k2)); ctx.lineTo(x + sx * b, y + sy * b); ctx.lineTo(x + sx * (b - k2), y + sy * b); }
        ctx.stroke(); ctx.setLineDash([2, 6]); ctx.lineDashOffset = calm ? 0 : t / 60; ctx.strokeStyle = hexA(HOLO, .25); ctx.beginPath(); ctx.arc(x, y, R + 30, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      if (n.kind === "top") { ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.beginPath(); ctx.moveTo(x - R - 6, y); ctx.lineTo(x + R + 6, y); ctx.moveTo(x, y - R - 6); ctx.lineTo(x, y + R + 6); ctx.stroke(); }
      // name and status
      const ty = n.size ? y - n.size * view.k - 26 : y + R + 22;   // charts: a title above; otherwise a name below the rings
      label(trim(n.label ?? n.id, 18), x, ty, "center", sel ? "#ffffff" : "#e3ecfa", "600 12.5px " + FONT);
      if (on || n.sub) label(on ? "working" : trim(n.sub, 26), x, ty + 16, "center", on ? HOLO : "#8fa3c0", "11px " + FONT);
      ctx.globalAlpha = 1;
    }
    /* Colour by what a dot is: memories teal, finished work yellow, work in progress coral, skills violet. */
    function dotColor(n) { const i = String(n.info || "");
      if (n.kind === "note") return "#4fd1c5"; if (i.startsWith("skill")) return "#a78bfa"; if (i.startsWith("done")) return "#f6d36b"; return "#f59e7a"; }
    const n_is = (c, focus, nb) => focus && (c.id === focus || nb?.has(c.id));
    /* The control point that bows a bridge into an arc: up for some, down for others, so arcs don't stack. */
    function bow(x1, y1, x2, y2, up) { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, L = Math.abs(x2 - x1) || Math.hypot(x2 - x1, y2 - y1) || 1;
      return [mx, my + (up ? -1 : 1) * L * 0.55]; }   // nested rainbows: longer links swing wider
    const along = (x1, y1, cx, cy, x2, y2, u) => [(1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * cx + u * u * x2, (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * cy + u * u * y2];
    let last = 0, settledK = 1;
    function loop(t) {
      if (!alive) return; requestAnimationFrame(loop);
      clock = t; if (o.layout === "solar") updateSolar(t);
      const busy = alpha >= 0.002 || drag || pulses.length || shocks.length || active.size || dirty;
      if (typeof document !== "undefined" && document.hidden) return;
      // Busy: up to 30 frames a second. Idle: 12 a second keeps the stars twinkling and rings turning, lightly.
      // With reduced motion, only redraw when something changes.
      if (t - last < (busy ? 33 : calm ? 1e9 : 90)) return;   // idle: a gentle redraw for the drifting sky
      if (Math.abs(view.k - settledK) / settledK > 0.03) { settledK = view.k; alpha = Math.max(alpha, 0.12); }
      last = t; step(); draw(t); dirty = false;
    }
    requestAnimationFrame(loop);

    const clamp = (k) => Math.max(o.layout === "solar" ? 0.035 : 0.15, Math.min(3.2, k));
    function hit(sx, sy) { let best = null, bd = 1e9;
      for (const n of nodes) { const [x0, y0] = toScreen(n), [dx, dy] = drift(n), d = Math.hypot(x0 + dx - sx, y0 + dy - sy), reach = nodeR(n) + (BIG(n) ? 10 : 7);
        if (d < Math.max(reach, 10) && d < bd) { best = n; bd = d; } }
      return best; }
    const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function fit() { if (!nodes.length) return; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      if (o.layout === "solar") { const R = belt + 40; const ins = Object.assign({l: 0, r: 0, t: 0, b: 0}, typeof o.inset === "function" ? o.inset() : o.inset || {});
        const aw = Math.max(160, W - ins.l - ins.r), ah = Math.max(160, H - ins.t - ins.b);
        view.k = clamp(Math.min(aw / (R * 2 + 40), ah / (R * 2 * TILT + 120))); view.x = -((ins.l - ins.r) / 2) / view.k; view.y = 14 - ((ins.t - ins.b) / 2) / view.k; dirty = true; return; }
      for (const n of nodes) { const r = n.size || 0; x0 = Math.min(x0, n.x - r); y0 = Math.min(y0, n.y - r); x1 = Math.max(x1, n.x + r); y1 = Math.max(y1, n.y + r); }
      for (const e of edges) { const a = byId.get(e.a), b = byId.get(e.b); if (!a || !b || !BIG(a) || !BIG(b)) continue;   // arcs swing about a quarter of their span
        y1 = Math.max(y1, a.y + Math.abs(b.x - a.x) * 0.28); }
      for (const n of nodes) if (BIG(n) && n.size) y0 = Math.min(y0, n.y - n.size - 44);   // room for the titles
      const ins = Object.assign({l: 0, r: 0, t: 0, b: 0}, typeof o.inset === "function" ? o.inset() : o.inset || {});
      const aw = Math.max(160, W - ins.l - ins.r), ah = Math.max(160, H - ins.t - ins.b);
      view.k = clamp(Math.min((aw - 40) / Math.max(1, x1 - x0), (ah - 40) / Math.max(1, y1 - y0)));
      // centre the content in the open area, not the whole canvas
      view.x = (x0 + x1) / 2 - ((ins.l - ins.r) / 2) / view.k; view.y = (y0 + y1) / 2 - ((ins.t - ins.b) / 2) / view.k; dirty = true; }
    function select(n) { hl = n.id; dirty = true; if (n.kind === "note" && o.noteViewer !== false) openNote(n.note.id); if (o.onSelect) o.onSelect(n); }
    cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); const [sx, sy] = local(e); pointers.set(e.pointerId, [sx, sy]);
      if (pointers.size === 2) { const [p1, p2] = [...pointers.values()]; pinch = {d: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), k: view.k}; drag = pan = null; return; }
      const n = hit(sx, sy); if (n) { drag = {n, moved: false}; alpha = Math.max(alpha, .3); } else pan = {sx, sy, x: view.x, y: view.y, moved: false};
      cv.classList.add("bk-drag"); });
    cv.addEventListener("pointermove", (e) => { const [sx, sy] = local(e); dirty = true; if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [sx, sy]);
      if (pinch && pointers.size === 2) { const [p1, p2] = [...pointers.values()]; view.k = clamp(pinch.k * Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) / pinch.d); return; }
      if (drag) { const [wx, wy] = toWorld(sx, sy); drag.n.x = wx; drag.n.y = wy; drag.moved = true; alpha = Math.max(alpha, .25);
        if (o.layout === "solar") { drag.n.pinned = true; drag.n.px = wx; drag.n.py = wy; } return; }
      if (pan) { view.x = pan.x - (sx - pan.sx) / view.k; view.y = pan.y - (sy - pan.sy) / view.k; pan.moved = true; return; }
      const n = hit(sx, sy); hover = n; cv.style.cursor = n ? "pointer" : "grab";
      if (n) { tip.style.display = "block"; tip.innerHTML = `<b style="color:${esc(n.color)}">${esc(n.label ?? n.id)}</b><small>${esc(n.info || "")}${n.deg ? (n.info ? " · " : "") + n.deg + " links" : ""}</small>`;
        tip.style.left = Math.min(W - 270, sx + 14) + "px"; tip.style.top = Math.min(H - 70, sy + 14) + "px"; } else tip.style.display = "none"; });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
      if (drag && !drag.moved) select(drag.n); if (drag && drag.moved) { drag.n.fixed = true; drag.n.userMoved = true; }
      if (pan && !pan.moved) { hl = null; dirty = true; } drag = pan = null; cv.classList.remove("bk-drag"); };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", () => { hover = null; dirty = true; tip.style.display = "none"; });
    cv.addEventListener("dblclick", (e) => { const n = hit(...local(e)); if (n) { n.userMoved = false; n.fixed = false; build(); } });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); dirty = true; const [sx, sy] = local(e); const [wx, wy] = toWorld(sx, sy);
      view.k = clamp(view.k * Math.exp(-e.deltaY * 0.0015)); const [nx, ny] = toWorld(sx, sy); view.x += wx - nx; view.y += wy - ny; }, {passive: false});
    el.querySelector(".bk-zoom").addEventListener("click", (e) => { const z = e.target.dataset?.z; if (!z) return;
      if (z === "in") view.k = clamp(view.k * 1.25); else if (z === "out") view.k = clamp(view.k / 1.25); else fit(); dirty = true; });

    function openNote(id) { const nt = (o.notes || []).find((x) => x.id === id); if (!nt) return;
      noteEl.querySelector("b").textContent = nt.title || nt.id; noteEl.querySelector(".bk-nb").innerHTML = markdown(nt.text); noteEl.hidden = false; hl = "note:" + id; dirty = true; }
    noteEl.querySelector("button").onclick = () => { noteEl.hidden = true; hl = null; dirty = true; };
    noteEl.querySelector(".bk-nb").addEventListener("click", (e) => { const a = e.target.closest("a[data-note]"); if (a) openNote(a.dataset.note); });
    const onKey = (e) => { if (e.key === "Escape" && !noteEl.hidden) noteEl.querySelector("button").click(); };
    document.addEventListener("keydown", onKey);

    build(); setTimeout(fit, 900); setTimeout(fit, 3000);
    const api = {
      update(next) { const before = nodes.map((n) => n.id).sort().join(); o = {...o, ...next}; build(); if (nodes.map((n) => n.id).sort().join() !== before) setTimeout(fit, 700); },
      setActive(ids) { active.clear(); for (const id of ids || []) active.add(id); dirty = true; },
      pulse(a, b, color, loop = false) { const p = {a, b, t: 0, v: 0.018 + Math.random() * 0.01, color: color || byId.get(a)?.color || "#a68af9", loop}; pulses.push(p);
        return () => { const i = pulses.indexOf(p); if (i >= 0) pulses.splice(i, 1); }; },
      burst(id) { const n = byId.get(id); if (!n) return; for (const b of adj.get(id) || []) if (Math.random() < .6) api.pulse(id, b, n.color); alpha = Math.max(alpha, .15); },
      focus(id) { hl = id; dirty = true; }, fit, openNote,
      reset() { for (const n of nodes) { n.pinned = false; n.userMoved = false; } if (o.layout === "solar") planSolar(); else build(); hl = null; dirty = true; setTimeout(fit, 30); },
      /* How many pairs of things overlap on screen right now (cards, note icons with labels). Used by the layout tests. */
      overlaps() { let count = 0; const pairs = [];
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) { const a = nodes[i], b = nodes[j], fa = footprint(a), fb = footprint(b);
          const pad = 6 / (view.k || 1);   // the drawn shapes are smaller than their footprints; allow the spacing margin
          if (Math.abs(a.x + fa.ox - b.x - fb.ox) < fa.hw + fb.hw - pad * 2 && Math.abs(a.y + fa.oy - b.y - fb.oy) < fa.hh + fb.hh - pad * 2) { count++; if (pairs.length < 5) pairs.push([a.label || a.id, b.label || b.id]); } }
        return {count, pairs, nodes: nodes.length}; },
      destroy() { alive = false; ro.disconnect(); document.removeEventListener("keydown", onKey); el.innerHTML = ""; el.classList.remove("bk"); },
    };
    return api;
  }


  /* ---------- AI models: connectors + a chat panel ----------
   * An agent is {label, color, ask(messages, {onText, signal}) -> Promise<text>}; messages are [{role, content}].
   * Connectors make one:
   *   Brain.agents.claude(sample, {model:"claude-haiku-5-5"})       on a Claude page (sample = await claude.use("sample"))
   *   Brain.agents.openai({baseUrl, model, apiKey})                   any OpenAI-style API (DeepSeek, Gemini, OpenRouter, Ollama).
   *     Use it from your own server or a local app; never ship a real key inside a public web page.
   */
  const agents = {
    claude(sample, cfg = {}) {
      return async (messages, {onText, signal} = {}) => {
        const tier = cfg.modelTier || ({"claude-haiku-5-5": "quick", "claude-sonnet-5-5": "default"}[cfg.model] || "complex");
        const r = await sample(messages, {cache: false, model: cfg.model, modelTier: tier, signal, onText: onText ? ({text}) => onText(text) : undefined});
        return r.text;
      };
    },
    /* Firefly gateway (server/worker.js): keys stay on the server; it falls back to other AIs and counts usage.
     *   Brain.agents.gateway({url:"", passcode, model:"gemini:...", fallback:["cloudflare:..."]}) */
    gateway(cfg) {
      return async (messages, {signal} = {}) => {
        const res = await fetch(String(cfg.url || "").replace(/\/$/, "") + "/api/ask", {method: "POST", signal,
          headers: {"Content-Type": "application/json", Authorization: "Bearer " + (cfg.passcode || "")},
          body: JSON.stringify({model: cfg.model, fallback: cfg.fallback || [], messages, maxTokens: cfg.maxTokens || 1200})});
        let data = null; try { data = await res.json(); } catch (e) { data = null; }
        if (!res.ok) throw {code: data?.error || "HTTP " + res.status, tried: data?.tried};
        if (cfg.onAnswer) try { cfg.onAnswer(data); } catch (e) { /* display only */ }
        return data.text;
      };
    },
    openai(cfg) {
      return async (messages, {signal} = {}) => {
        const res = await fetch(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {method: "POST", signal,
          headers: {"Content-Type": "application/json", ...(cfg.apiKey ? {Authorization: "Bearer " + cfg.apiKey} : {})},
          body: JSON.stringify({model: cfg.model, messages, max_tokens: cfg.maxTokens || 1200})});
        if (!res.ok) throw new Error("HTTP " + res.status);
        return (await res.json()).choices[0].message.content;
      };
    },
  };

  /* chat(el, brain, {from:{id,label,color}, hub:"lead", agents:{id:{label,color,role,ask}}, rules:"...", delegate:true})
   * You talk to any agent; the hub can hand up to 3 tasks to the others (lines "ASSIGN <id>: task"), whose reports come back. */
  function chat(el, brain, cfg) {
    el.classList.add("bk-chat");
    el.innerHTML = `<div class="bk-msgs" aria-live="polite"></div><div class="bk-to" role="group" aria-label="Talk to"></div>
      <form class="bk-in"><textarea rows="1" placeholder="Message…  (Enter to send)" aria-label="Message"></textarea><button type="submit">Send</button></form><div class="bk-note2"></div>`;
    const box = el.querySelector(".bk-msgs"), to = el.querySelector(".bk-to"), form = el.querySelector("form"), ta = el.querySelector("textarea"), send = form.querySelector("button"), note = el.querySelector(".bk-note2");
    let A = cfg.agents || {}, ids = Object.keys(A); const log = [];
    let target = cfg.hub && A[cfg.hub] ? cfg.hub : ids[0], ctl = null; const busy = new Set();
    const who = (id) => id === cfg.from?.id ? cfg.from : A[id];
    const nameOf = (m) => (who(m.from)?.label) || m.fromLabel || m.from;
    const keepIt = (m) => { if (cfg.store?.save && m.text && !m.wait) try { Promise.resolve(cfg.store.save({id: m.id, from: m.from, to: m.to || null, text: m.text.replace(/^\s*\**\s*(ASSIGN|TASK)\s+.*$/gim, "").trim(), tag: m.tag || "", at: m.at, fromLabel: nameOf(m), copy: !!m.copy})).catch(() => {}); } catch (e) {} };
    function add(from, text, extra = {}) { const m = {id: "m-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8), from, text, at: new Date().toISOString(), ...extra}; log.push(m); draw(); if (!m.wait) keepIt(m); return m; }
    function draw() {
      box.innerHTML = ""; if (!log.length) { box.innerHTML = `<div class="bk-welcome"><h2>What are we making?</h2><p>Start with “we're making…” and the crew splits it into jobs and works them in parallel. Quick questions get a free answer.</p><p>Or pick a crew member below to talk to them directly.</p></div>`; }
      for (const m of log.slice(-150)) { const w = (m.from === cfg.from?.id && m.fromLabel) ? {label: m.fromLabel, color: cfg.from.color} : who(m.from) || {label: m.fromLabel || m.from, color: "#888"}; const d = document.createElement("div");
        d.className = "bk-m" + (m.from === cfg.from?.id ? " you" : "") + (m.wait ? " wait" : "");
        d.innerHTML = `<i style="background:${esc(w.color)}"></i><div style="min-width:0"><b style="color:${esc(w.color)}">${esc(w.label)}</b><small>${esc(m.tag || "")}</small><div class="t"></div></div>`;
        d.querySelector(".t").textContent = (m.text || "").replace(/^\s*\**\s*(ASSIGN|TASK)\s+.*$/gim, "").replace(/\n{3,}/g, "\n\n").trim() || (m.wait ? "Thinking…" : "");   // dispatch lines are for JEV, not for reading
        if (m.copy) { const b = document.createElement("button"); b.type = "button"; b.textContent = "Copy"; b.style.cssText = "margin-top:6px;background:none;border:1px solid #3a3a3a;border-radius:5px;color:#ddd;padding:3px 9px;cursor:pointer;font:inherit;font-size:12px";
          b.onclick = async () => { try { await navigator.clipboard.writeText(m.text.replace(/^Copy this into [^:]+:\n\n/, "")); b.textContent = "Copied"; } catch (x) { const r = document.createRange(); r.selectNodeContents(d.querySelector(".t")); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); b.textContent = "Selected: Ctrl/Cmd+C"; } };
          d.querySelector(".t").after(b); }
        box.append(d); }
      box.scrollTop = box.scrollHeight;
    }
    function chips() { to.innerHTML = ""; for (const id of ids) { const b = document.createElement("button"); b.type = "button";
      b.setAttribute("aria-pressed", String(id === target)); b.innerHTML = `<i style="background:${esc(A[id].color)}"></i>@${esc(A[id].label)}`;
      b.onclick = () => { target = id; chips(); brain.focus(id); ta.focus(); }; to.append(b); } }
    const history = (id) => log.filter((m) => !m.wait && m.text && (m.from === id || m.to === id)).slice(-10)
      .map((m) => ({role: m.from === id ? "assistant" : "user", content: m.text}));
    async function run(id, prompt, tag, from) {
      const ag = A[id]; busy.add(id); brain.setActive([...busy]); const stop = brain.pulse(from || cfg.from?.id || cfg.hub, id, ag.color, true);
      const m = add(id, "", {wait: true, tag}); ctl = new AbortController(); send.textContent = "Stop";
      const sys = `You are ${ag.label}${ag.role ? ", " + ag.role : ""}, on a team led by ${A[cfg.hub]?.label || "the lead"}. ${cfg.rules || ""} Plain English, short.`;
      const msgs = [{role: "user", content: sys}, {role: "assistant", content: "Understood."}, ...history(id), {role: "user", content: prompt}];
      const t0 = Date.now(); let ok = true;
      try { if (ag.relay) { m.text = `Copy this into ${ag.label}:\n\n${sys}\n\n${prompt}\n\n(Paste its answer here with /reply)`; m.copy = true; m.tag = "copy into " + ag.label; }
        else m.text = await ag.ask(msgs, {signal: ctl.signal, onText: (t) => { m.text = t; m.wait = false; draw(); }});
        m.wait = false; m.to = from || cfg.from?.id; }
      catch (e) { ok = false; m.wait = false; m.text = (e?.text || "") + (e?.code === "cancelled" || e?.name === "AbortError" ? " (stopped)" : ` (couldn't reach ${ag.label}${e?.code ? ": " + e.code : ""})`); }
      finally { stop(); busy.delete(id); brain.setActive([...busy]); ctl = null; send.textContent = "Send"; draw(); keepIt(m);
        try { cfg.onRun && !ag.relay && cfg.onRun({id, ok, ms: Date.now() - t0}); } catch (x) {} }
      return ok ? m.text : "";
    }
    form.addEventListener("submit", async (e) => { e.preventDefault(); if (ctl) { ctl.abort(); return; }
      const text = ta.value.trim(); if (!text || !A[target]) return; ta.value = "";
      if (/^\/reply\s/i.test(text) && A[target].relay) { add(target, text.replace(/^\/reply\s+/i, ""), {to: cfg.from?.id, tag: "reply"}); cfg.onRun && cfg.onRun({id: target, ok: true, ms: 0}); return; }
      add(cfg.from?.id || "you", text, {to: target, tag: "to " + A[target].label});
      /* Quick lane: before the Lead spends anything, a simple question may be answered for free (no AI, a remembered
       * answer, or a free model). cfg.quick(text) -> {text, tag, label} or null to carry on as normal. */
      /* Kitchen: an order ("we're making ...") goes to the server's kitchen. cfg.order(text, update) -> true if taken;
       * update(text, tag) rewrites the kitchen's message in place as tickets cook. */
      if (target === cfg.hub && cfg.order) {
        const k = add("kitchen", "", {wait: true, fromLabel: "Kitchen"}); let took = false;
        const update = (t, tag, id) => { if (id) k.id = id; k.text = t; k.wait = false; if (tag) k.tag = tag; k.to = cfg.from?.id; draw(); keepIt(k); };   // id: one saved message per order
        try { took = await cfg.order(text, update); } catch (x) { took = false; }
        if (took) return;
        log.splice(log.indexOf(k), 1); draw();
      }
      if (target === cfg.hub && cfg.quick) {
        const q = add("quick", "", {wait: true, fromLabel: "Quick answer"}); let r = null;
        try { r = await cfg.quick(text); } catch (x) { r = null; }
        if (r?.text) { q.text = r.text; q.wait = false; q.tag = r.tag || ""; q.fromLabel = r.label || "Quick answer"; q.to = cfg.from?.id; draw(); keepIt(q); return; }
        log.splice(log.indexOf(q), 1); draw();
      }
      const D = cfg.dispatch;
      const roster = ids.filter((x) => x !== cfg.hub).map((x) => `${x} = ${A[x].label}${A[x].role ? ": " + A[x].role : ""}`).join("\n");
      const hand = target === cfg.hub && cfg.delegate !== false && roster
        ? (D ? `\n\nYou lead the team. Reshape this into clear, precise tasks. If any part should be done by the team, end with up to 3 lines exactly "TASK <kind>: <task>", where kind is one of: ${D.kinds.join(", ")}. The dispatcher (JEV) picks who does each one.`
             : `\n\nYou lead the team. If part of this is better done by a member, end with up to 3 lines exactly "ASSIGN <id>: <task>" using:\n${roster}`) : "";
      const out = await run(target, text + hand, "", cfg.from?.id);
      if (!hand || !out) return;
      const jobs = []; const clean = out.split("\n").filter((l) => {
        const t = l.match(/^\s*\**\s*TASK\s+([\w-]+)\s*\**\s*:\s*(.+)$/i), a = l.match(/^\s*\**\s*ASSIGN\s+@?([\w-]+)\s*\**\s*:\s*(.+)$/i);
        if (jobs.length >= 3 || !(t || a)) return !(t || a);
        const task = (t || a)[2].replace(/^[\s*]+|[\s*]+$/g, "");
        if (t && D) { const kind = t[1].toLowerCase(); const r = D.route(kind, task) || {}; if (A[r.id]) jobs.push({id: r.id, task, kind, why: r.reason || ""}); }
        else if (a && A[a[1]] && a[1] !== cfg.hub) jobs.push({id: a[1], task, kind: "", why: ""});
        return false; }).join("\n").trim();
      const last = log.filter((m) => m.from === cfg.hub).pop(); if (last) { last.text = clean + (jobs.length ? `\n\nHanding out: ${jobs.map((j) => A[j.id].label + (j.kind ? " (" + j.kind + ")" : "")).join(", ")}.` : ""); draw(); keepIt(last); }
      for (const j of jobs) {
        const res = await run(j.id, `Task from ${A[cfg.hub].label}: ${j.task}\n(The original request: ${text.slice(0, 400)})\nReport back in under 150 words.`, (D ? "JEV → " : "report to ") + (D ? (j.kind || "task") : A[cfg.hub].label), cfg.hub);
        try { cfg.onTask && cfg.onTask({member: j.id, kind: j.kind, task: j.task, why: j.why, text: res, request: text.slice(0, 400), relay: !!A[j.id].relay}); } catch (x) {} }
    });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    chips(); draw();
    if (cfg.store?.load) Promise.resolve(cfg.store.load()).then((old) => { if (Array.isArray(old) && old.length) { log.unshift(...old.filter((m) => m && m.text)); draw(); } }).catch(() => {});
    return {say: (text) => { ta.value = text; form.requestSubmit(); }, status: (t) => { note.textContent = t || ""; },
      setTarget: (id) => { if (!A[id]) return; target = id; chips(); ta.focus(); },
      setFrom: (f) => { Object.assign(cfg.from, f); draw(); }, clear: () => { log.length = 0; draw(); },
      setAgents: (next, hub) => { A = next || {}; ids = Object.keys(A); if (hub) cfg.hub = hub; if (!A[target]) target = cfg.hub && A[cfg.hub] ? cfg.hub : ids[0]; chips(); draw(); },
      replaceLog: (msgs) => { log.length = 0; log.push(...(msgs || []).filter((m) => m && m.text)); draw(); }, log};
  }

  /* store({url, passcode, project, fetch?, pollMs?}): the Firefly server's database (server/store.js) with the same
   * shape as the storage a Claude page uses: db.collection(name).add / doc(id).set|update|delete / orderBy / limit /
   * get / onSnapshot. Changes show at once on this page and reach the server in order; other devices appear on the
   * next poll. */
  function store(cfg) {
    const f = cfg.fetch || ((...a) => fetch(...a));
    const base = String(cfg.url || "").replace(/\/$/, "") + "/api/db/" + encodeURIComponent(cfg.project);
    const headers = {"Content-Type": "application/json", Authorization: "Bearer " + (cfg.passcode || "")};
    const data = new Map(), subs = new Set(), queue = new Map(), sigs = new Map();
    let loaded = null, timer = null, pending = 0;
    const col = (name) => { if (!data.has(name)) data.set(name, new Map()); return data.get(name); };
    const newId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    function snap(name, order, limit) {
      let rows = [...col(name).entries()];
      if (order) rows.sort((a, b) => { const x = String(a[1][order.field] ?? ""), y = String(b[1][order.field] ?? ""); return order.dir === "desc" ? y.localeCompare(x) : x.localeCompare(y); });
      if (limit) rows = rows.slice(0, limit);
      return {docs: rows.map(([id, d]) => ({id, data: () => ({...d})})), size: rows.length, empty: !rows.length};
    }
    const tell = (name) => { for (const s of subs) if (!name || s.name === name) try { s.cb(snap(s.name, s.order, s.limit)); } catch (e) { /* a broken listener must not stop others */ } };
    async function load() {
      const r = await f(base, {headers});
      if (!r.ok) { let e = null; try { e = await r.json(); } catch (x) { e = null; } throw {code: e?.error || "HTTP " + r.status, status: r.status}; }
      const body = await r.json();
      if (pending) return;                     // don't overwrite changes still on their way to the server
      const changed = [];
      for (const [name, docs] of Object.entries(body.collections || {})) {
        const m = new Map(); for (const d of docs) m.set(d.id, d.data);
        const sig = sigOf(m);
        if (sigs.get(name) !== sig || !data.has(name)) { sigs.set(name, sig); data.set(name, m); changed.push(name); }
      }
      for (const name of changed) tell(name);   // only redraw what changed, so a half-typed form survives a poll
    }
    const ready = () => loaded || (loaded = load());
    function send(name, op, id, d) {
      pending++;
      const prev = queue.get(name) || Promise.resolve();
      const next = prev.catch(() => {}).then(async () => {
        const r = await f(base + "/" + encodeURIComponent(name), {method: "POST", headers, body: JSON.stringify({op, id, data: d})});
        if (!r.ok) { let e = null; try { e = await r.json(); } catch (x) { e = null; } throw {code: e?.error || "HTTP " + r.status}; }
        return r.json();
      }).finally(() => { pending--; });
      queue.set(name, next);
      next.catch(() => { if (cfg.onError) cfg.onError(name); loaded = null; ready().catch(() => {}); });
      return next;
    }
    function query(name, order, limit) {
      return {
        orderBy: (field, dir = "asc") => query(name, {field, dir}, limit),
        limit: (n) => query(name, order, n),
        get: async () => { await ready(); return snap(name, order, limit); },
        onSnapshot(cb, err) { const s = {name, order, limit, cb}; subs.add(s); ready().then(() => cb(snap(name, order, limit))).catch((e) => err && err(e)); return () => subs.delete(s); },
      };
    }
    const sigOf = (m) => JSON.stringify([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    const touched = (name) => { sigs.set(name, sigOf(col(name))); tell(name); };   // a change made here: redraw now; the next poll won't count it again
    function collection(name) {
      return Object.assign(query(name), {
        async add(d) { const id = newId(); col(name).set(id, {...d}); touched(name); await send(name, "set", id, d); return {id}; },
        doc: (id) => ({
          id,
          async set(d) { col(name).set(id, {...d}); touched(name); await send(name, "set", id, d); },
          async update(d) { col(name).set(id, {...(col(name).get(id) || {}), ...d}); touched(name); await send(name, "update", id, d); },
          async delete() { col(name).delete(id); touched(name); await send(name, "delete", id); },
          async get() { await ready(); const v = col(name).get(id); return {id, exists: !!v, data: () => (v ? {...v} : undefined)}; },
        }),
      });
    }
    function poll(ms) { clearInterval(timer); timer = setInterval(() => { if (typeof document === "undefined" || !document.hidden) load().catch(() => {}); }, ms); }
    if (cfg.pollMs) poll(cfg.pollMs);
    return {collection, ready, refresh: load, stop: () => clearInterval(timer)};
  }

  /* Escalation: a free model is told it may hand a job up instead of guessing. Its reply "ESCALATE: <why>" sends the
   * job to the hard tier. Anything else is a normal answer. */
  const escalation = {
    instruction: "If this job is beyond you (it needs careful reasoning, real code, exact numbers, or you are unsure), do not guess: reply with exactly one line, ESCALATE: <the reason in a few words>.",
    parse(text) {
      const m = /^\s*\**\s*ESCALATE\s*\**\s*:\s*(.*)$/im.exec(String(text || ""));
      if (!m) return null;
      const before = String(text).slice(0, m.index).trim();
      return before.length > 200 ? null : {reason: m[1].trim().slice(0, 160) || "needs a stronger model"};   // a long answer that merely mentions it is still an answer
    },
    withInstruction(messages) {
      const out = messages.map((m) => ({...m})); const i = out.findIndex((m) => m.role === "user");
      if (i >= 0) out[i].content = out[i].content + "\n\n" + escalation.instruction; else out.unshift({role: "user", content: escalation.instruction});
      return out;
    },
  };

  /* zip([{name, text}]) -> Uint8Array: a plain (uncompressed) .zip, e.g. a folder of notes for Obsidian. */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files, when = new Date()) {
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
    const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
    const date = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), body = enc.encode(f.text ?? ""), crc = crc32(body);
      const head = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, body.length, 4], [22, body.length, 4], [26, name.length, 2], [28, 0, 2]]
        .forEach(([o, v, n]) => (n === 4 ? head.setUint32(o, v, true) : head.setUint16(o, v, true)));
      const cen = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, body.length, 4], [24, body.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
        .forEach(([o, v, n]) => (n === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)));
      parts.push(new Uint8Array(head.buffer), name, body); central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const size = central.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4], [20, 0, 2]]
      .forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
    const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0; for (const p of all) { out.set(p, at); at += p.length; }
    return out;
  }
  /* A note title -> a safe file name Obsidian will still link to by the same title. */
  const noteFile = (title) => String(title || "note").replace(/[\\/:*?"<>|#^[\]]/g, "-").trim().slice(0, 120) + ".md";

  const Brain = {mount, markdown, chat, agents, store, escalation, zip, noteFile};
  if (typeof module !== "undefined" && module.exports) module.exports = Brain; else root.Brain = Brain;
})(typeof window !== "undefined" ? window : this);
