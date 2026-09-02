// Builds the SMS redesign artboards (.dc.html) + canvas.json from one source
// of truth, so the chrome (bar, strip, tokens) is identical on every board.
import { writeFileSync } from 'node:fs';

const C = {
  ink: '#16191C', gra: '#4A5057', mut: '#5F656C', grid: '#8C9298',
  rule: '#E7E8E4', rule2: '#D3D5D1', paper2: '#F2F2EF', paper3: '#F6F6F3',
  acc: '#A5330F', accPale: '#FBE9E4', ok: '#1E8757',
};
const fmt = (n) => n.toLocaleString('en-GB');

const CSS = `
body{margin:0;background:#fff;color:${C.ink};font-family:'Archivo','Segoe UI',system-ui,Arial,sans-serif;font-size:17px;line-height:1.5;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;font-feature-settings:'tnum'}
a{color:${C.ink};text-decoration:underline;text-underline-offset:3px;text-decoration-color:#B7BAB5}
a:hover{color:${C.acc};text-decoration-color:${C.acc}}
.bar{height:56px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;padding:0 32px;background:#fff}
.nav{display:flex;align-items:center;gap:26px;height:56px}
.brand{font-weight:600;letter-spacing:0.04em;margin-right:6px}
.nav a{text-decoration:none;color:${C.gra};height:56px;box-sizing:border-box;display:flex;align-items:center;border-bottom:2px solid transparent;padding-top:2px}
.nav a.on{color:${C.ink};border-bottom-color:${C.ink}}
.period{display:flex;gap:2px;background:${C.paper2};border-radius:4px;padding:2px}
.period span{padding:4px 11px;border-radius:3px;font-size:15px;color:${C.gra};white-space:nowrap}
.period span.on{background:#fff;color:${C.ink};box-shadow:0 0 0 1px ${C.rule}}
.right{display:flex;align-items:center;gap:16px;font-size:15px;color:${C.gra};white-space:nowrap}
.strip{height:32px;display:flex;align-items:center;justify-content:space-between;padding:0 32px;font-size:15px;color:${C.gra};background:${C.paper3}}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:${C.ok};margin-right:8px;vertical-align:1px}
.dot.bad{background:${C.acc}}
.btn{display:inline-block;border:1px solid ${C.rule2};border-radius:4px;padding:4px 12px;font-size:15px;color:${C.ink};background:#fff;text-decoration:none;white-space:nowrap;line-height:1.4}
.btn.primary{background:${C.ink};color:#fff;border-color:${C.ink}}
.page{max-width:1100px;margin:0 auto;padding:34px 32px 44px;box-sizing:border-box}
.q{font-size:15px;color:${C.mut};margin:0 0 6px}
h1{font-size:30px;line-height:1.3;font-weight:500;margin:0;letter-spacing:-0.01em;text-wrap:pretty}
.block{padding:28px 0;border-top:1px solid ${C.rule}}
.block.first{border-top:0;padding-top:26px}
.figs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px}
.figs.four{grid-template-columns:repeat(4,minmax(0,1fr))}
.figs.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.fig b{display:block;font-size:40px;line-height:1.1;font-weight:600;letter-spacing:-0.02em;white-space:nowrap}
.fig b small{font-size:22px;font-weight:500;color:${C.gra};margin-left:6px;letter-spacing:0}
.fig span{display:block;color:${C.gra};margin-top:6px}
.acc{color:${C.acc}}
.h2{font-size:15px;color:${C.mut};margin:0 0 14px;font-weight:500;display:flex;justify-content:space-between;align-items:baseline;gap:16px}
.attn{margin:0;padding:0;list-style:none}
.attn li{margin:0 0 10px;padding-left:18px;position:relative}
.attn li::before{content:'';position:absolute;left:0;top:10px;width:8px;height:8px;border-radius:50%;background:${C.acc}}
.stations{display:grid;grid-template-columns:repeat(14,minmax(0,1fr));gap:8px}
.st{border:1px solid ${C.rule};border-radius:4px;padding:9px 4px 8px;text-align:center}
.st i{display:block;font-style:normal;font-size:13px;color:${C.mut};white-space:nowrap}
.st b{display:block;font-weight:500;font-size:18px;margin-top:1px}
.st.dim{border-style:dashed}
.st.dim b,.st.dim i{color:${C.grid}}
.st.flag{border-color:${C.acc};box-shadow:inset 0 0 0 1px ${C.acc}}
.st.flag b{color:${C.acc}}
table{border-collapse:collapse;width:100%}
th{font-weight:500;font-size:15px;color:${C.mut};text-align:left;padding:0 12px 8px 0;border-bottom:1px solid ${C.rule2};white-space:nowrap}
td{padding:9px 12px 9px 0;border-bottom:1px solid ${C.rule};vertical-align:top}
td.n,th.n{text-align:right;padding-right:0;padding-left:18px;white-space:nowrap}
tr.hl td{background:${C.paper3}}
.mut{color:${C.mut}} .g{color:${C.gra}} .sm{font-size:15px}
.details{color:${C.gra};font-size:15px;padding-top:22px;border-top:1px solid ${C.rule}}
.chev{color:${C.grid};margin-left:8px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 28px}
.kv div:nth-child(odd){color:${C.mut}}
.chip{display:inline-block;border:1px solid ${C.rule2};border-radius:999px;padding:3px 12px;font-size:15px;color:${C.ink};white-space:nowrap;line-height:1.4}
.chip.on{background:${C.ink};color:#fff;border-color:${C.ink}}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.toggle{display:inline-flex;border:1px solid ${C.rule2};border-radius:4px;overflow:hidden}
.toggle span{padding:5px 14px;font-size:15px;color:${C.gra};border-right:1px solid ${C.rule2};white-space:nowrap}
.toggle span:last-child{border-right:0}
.toggle span.on{background:${C.ink};color:#fff}
.readout{font-size:15px;color:${C.gra}}
svg text{font-family:inherit}
.sheet{position:absolute;top:88px;right:0;bottom:0;width:440px;box-sizing:border-box;background:#fff;border-left:1px solid ${C.rule2};padding:28px 32px}
.sheet .x{position:absolute;top:24px;right:28px;color:${C.gra};font-size:15px}
.big{font-size:40px;font-weight:600;letter-spacing:-0.02em;line-height:1.1}
.bars div{display:grid;grid-template-columns:290px 1fr 120px 70px;gap:16px;align-items:center;padding:7px 0;border-bottom:1px solid ${C.rule}}
.bars i{display:block;height:12px;background:${C.gra};border-radius:2px;font-style:normal}
.bars em{font-style:normal;text-align:right;color:${C.gra};white-space:nowrap}
.cap{font-size:15px;color:${C.mut};padding:8px 32px 14px}
`;

const gear = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${C.gra}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-label="Setup"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>`;

const NAV = ['Line', 'Readings', 'Weight', 'Rejects', 'Report'];
const PERIODS = ['This shift', 'Today', 'Yesterday', 'This week', 'This month', 'Pick dates'];

function bar({ active, period, range = null }) {
  return `<div class="bar">
  <div class="nav"><span class="brand">SMS</span>${NAV.map((n) => `<a href="#"${n === active ? ' class="on"' : ''}>${n}</a>`).join('')}</div>
  <div class="row"><div class="period">${PERIODS.map((p) => `<span${p === period ? ' class="on"' : ''}>${p}</span>`).join('')}</div>${range ? `<span class="chip">${range}</span>` : ''}</div>
  <div class="right"><a class="btn" href="#">Wall</a>${gear}</div>
</div>`;
}
function strip(state = 'ok') {
  const t = state === 'stale'
    ? `<span class="dot bad"></span><span class="acc">No new readings since 15:05 — the plant link may be down.</span> <a href="#">details</a>`
    : state === 'late'
      ? `<span class="dot bad"></span><span class="acc">Readings are arriving 2 h 10 min late — the line state below may be out of date.</span> <a href="#">details</a>`
      : `<span class="dot"></span>Readings to 16:39 · they reach this system about 16 min after weighing. <a href="#">details</a>`;
  return `<div class="strip"><span>TP1 · Line 3 · Unit 2</span><span>${t}</span></div>`;
}
const header = (o) => bar(o) + strip(o.lag || 'ok');

function doc(body, minH, extra = '', width = 1440) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&amp;display=swap">
  <style>${CSS}${extra}</style>
</helmet>
<div style="position: relative; width: ${width}px; min-height: ${minH}px; background: #ffffff; overflow: hidden;">
${body}
</div>
</x-dc>
</body>
</html>
`;
}

// ---------- shared pieces ----------
const shiftCounts = [65, 61, 63, 63, 64, 64, 62, 63, 65, 58, 64, 55, 65, 62]; // sums to 874
function stationRow(counts, { flag = [4, 7], dim = [12] } = {}) {
  return `<div class="stations">${counts.map((c, i) => {
    const n = i + 1;
    const cls = flag.includes(n) ? ' flag' : dim.includes(n) ? ' dim' : '';
    const val = dim.includes(n) ? `<b>${c}</b><i>quiet</i>` : `<b>${c}</b>`;
    return `<div class="st${cls}"><i>Station ${n}</i>${val}</div>`;
  }).join('')}</div>`;
}

const productBlock = `<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 32px;">
  <div>
    <div style="font-size: 22px; font-weight: 500;">201-IH0-SD</div>
    <div class="g">Target 1,960 g · limits 1,920 to 2,000 g · since 2 Sep 07:03, set by A. Sajid</div>
    <div class="mut sm" style="margin-top: 6px;">Recorded here for weight limits and reports. It is not sent to the machine.</div>
  </div>
  <a class="btn" href="#">Change</a>
</div>`;

const attentionList = `<ul class="attn">
  <li><span class="acc">Station 4 has read about 9 g lighter than the line for 6 days — check its scale first.</span> <a href="#">Weight</a></li>
  <li><span class="acc">Station 7 has read about 12 g heavier than the line for 4 days — check its scale first.</span> <a href="#">Weight</a></li>
  <li><span class="acc">Quality rejects have been rising since Tue 22:00 — 3.1% in the last four hours against a usual 2.0%.</span> <a href="#">Rejects</a></li>
</ul>`;

const lastReadings = `<table>
  <tr><td class="mut" style="width: 120px;">Last sack</td><td>47.3 kg · passed · 16:38:51<span class="chev">›</span></td></tr>
  <tr><td class="mut">Last cone</td><td>1,949 g · passed · Station 9 · 16:39:02<span class="chev">›</span></td></tr>
</table>`;

// ---------- charts ----------
function weightChart() {
  const W = 1036, H = 230, L = 8, R = 150, T = 16, B = 30;
  const vals = [1950, 1952, 1949, 1951, 1952, 1954, 1955, 1957, 1958, 1959, 1953, 1951, 1950, 1952, 1949, 1951, 1950, 1952, 1951, 1949, 1951, 1950];
  const x = (i) => L + (i / (vals.length - 1)) * (W - L - R);
  const y = (v) => T + ((2020 - v) / 120) * (H - T - B);
  const path = vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const hl = [[2000, 'upper limit 2,000 g'], [1960, 'target 1,960 g'], [1920, 'lower limit 1,920 g']];
  const ticks = [[0, '06:00'], [4, '08:00'], [8, '10:00'], [12, '12:00'], [16, '14:00'], [20, '16:00']];
  const marks = [4, 5, 6, 7, 8, 9];
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average cone weight per half hour today">
${hl.map(([v, l]) => `<line x1="${L}" x2="${W - R + 8}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${v === 1960 ? C.gra : C.grid}" stroke-width="1"${v === 1960 ? '' : ' stroke-dasharray="3 3"'}></line><text x="${W - R + 14}" y="${(y(v) + 4).toFixed(1)}" font-size="13" fill="${C.gra}">${l}</text>`).join('\n')}
<line x1="${x(7).toFixed(1)}" x2="${x(7).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="${C.rule2}" stroke-width="1"></line>
<path d="${path}" fill="none" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"></path>
${marks.map((i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(vals[i]).toFixed(1)}" r="4" fill="${C.acc}"></circle>`).join('')}
<circle cx="${x(7).toFixed(1)}" cy="${y(vals[7]).toFixed(1)}" r="7" fill="none" stroke="${C.ink}" stroke-width="1.5"></circle>
<text x="${x(6.5).toFixed(1)}" y="${y(1943).toFixed(1)}" font-size="13" fill="${C.acc}" text-anchor="middle">rising for 6 groups</text>
${ticks.map(([i, l]) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="13" fill="${C.mut}" text-anchor="${i === 0 ? 'start' : 'middle'}">${l}</text>`).join('')}
</svg>`;
}

function rejectChart() {
  const W = 1036, H = 230, L = 40, R = 130, T = 18, B = 30, n = 84;
  let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const q = [], w = [];
  for (let i = 0; i < n; i++) {
    let base = 2.0 + (rnd() - 0.5) * 0.7;
    if (i >= 79) base = [2.5, 2.8, 3.0, 3.1, 3.1][i - 79];
    q.push(+base.toFixed(2));
    w.push(+(0.3 + (rnd() - 0.5) * 0.2).toFixed(2));
  }
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (v) => T + ((4 - v) / 4) * (H - T - B);
  const p = (a) => a.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const bw = (W - L - R) / (n - 1);
  const ticks = [[8, '21 Aug'], [26, '24 Aug'], [44, '27 Aug'], [62, '30 Aug'], [82, 'today']];
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reject rate per four hours over the last 14 days">
<rect x="${(x(81) - bw / 2).toFixed(1)}" y="${T}" width="${(x(83) - x(81) + bw).toFixed(1)}" height="${H - T - B}" fill="${C.paper2}"></rect>
${[1, 2, 3].map((v) => `<line x1="${L}" x2="${W - R + 8}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.rule}" stroke-width="1"></line><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" font-size="13" fill="${C.mut}" text-anchor="end">${v}%</text>`).join('\n')}
<line x1="${L}" x2="${W - R + 8}" y1="${y(2.6).toFixed(1)}" y2="${y(2.6).toFixed(1)}" stroke="${C.grid}" stroke-width="1" stroke-dasharray="2 4"></line>
<line x1="${L}" x2="${W - R + 8}" y1="${y(1.5).toFixed(1)}" y2="${y(1.5).toFixed(1)}" stroke="${C.grid}" stroke-width="1" stroke-dasharray="2 4"></line>
<text x="${L + 6}" y="${(y(2.6) - 6).toFixed(1)}" font-size="13" fill="${C.mut}">usual range for quality rejects</text>
<line x1="${x(79.5).toFixed(1)}" x2="${x(79.5).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="${C.acc}" stroke-width="1"></line>
<text x="${(x(79.5) - 8).toFixed(1)}" y="${T + 11}" font-size="13" fill="${C.acc}" text-anchor="end">quality rejects rising from Tue 22:00</text>
<path d="${p(q)}" fill="none" stroke="${C.ink}" stroke-width="1.75" stroke-linejoin="round"></path>
<path d="${p(w)}" fill="none" stroke="${C.gra}" stroke-width="1.5" stroke-dasharray="4 3" stroke-linejoin="round"></path>
<text x="${W - R + 14}" y="${(y(q[n - 1]) + 4).toFixed(1)}" font-size="15" fill="${C.ink}">quality 3.1%</text>
<text x="${W - R + 14}" y="${(y(w[n - 1]) + 4).toFixed(1)}" font-size="15" fill="${C.gra}">weight 0.3%</text>
${ticks.map(([i, l]) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="13" fill="${C.mut}" text-anchor="middle">${l}</text>`).join('')}
</svg>`;
}

function conesChart() {
  const W = 1036, H = 240, L = 56, R = 8, T = 24, B = 30;
  const days = [['Wed 26 Aug', 5034], ['Thu 27 Aug', 7620], ['Fri 28 Aug', 7532], ['Sat 29 Aug', 7888], ['Sun 30 Aug', 7645], ['Mon 31 Aug', 7844], ['Tue 1 Sep', 7742]];
  const slot = (W - L - R) / days.length, bw = slot * 0.62;
  const y = (v) => T + ((8400 - v) / 8400) * (H - T - B);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cones per day">
${[2000, 4000, 6000].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.rule}"></line><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" font-size="13" fill="${C.mut}" text-anchor="end">${fmt(v)}</text>`).join('\n')}
${days.map(([d, v], i) => { const cx = L + slot * i + slot / 2; return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - y(v)).toFixed(1)}" fill="${i === 3 ? C.ink : C.gra}"></rect><text x="${cx.toFixed(1)}" y="${(y(v) - 6).toFixed(1)}" font-size="13" fill="${C.gra}" text-anchor="middle">${fmt(v)}</text><text x="${cx.toFixed(1)}" y="${H - 8}" font-size="13" fill="${C.mut}" text-anchor="middle">${d}</text>`; }).join('\n')}
<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="${C.rule2}"></line>
</svg>`;
}

function stationChart() {
  const W = 496, H = 200, L = 8, R = 96, T = 16, B = 28;
  const vals = [1950, 1952, 1949, 1951, 1950, 1951, 1952, 1950, 1951, 1953, 1955, 1958, 1961, 1963];
  const x = (i) => L + (i / (vals.length - 1)) * (W - L - R);
  const y = (v) => T + ((1980 - v) / 50) * (H - T - B);
  const seg = (a, from) => a.map((v, i) => (i ? 'L' : 'M') + x(from + i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Station 7 daily average over the last 14 days">
<line x1="${L}" x2="${W - R + 8}" y1="${y(1960).toFixed(1)}" y2="${y(1960).toFixed(1)}" stroke="${C.gra}" stroke-width="1"></line>
<text x="${W - R + 14}" y="${(y(1960) + 4).toFixed(1)}" font-size="13" fill="${C.gra}">target 1,960</text>
<line x1="${L}" x2="${W - R + 8}" y1="${y(1951).toFixed(1)}" y2="${y(1951).toFixed(1)}" stroke="${C.grid}" stroke-width="1" stroke-dasharray="3 3"></line>
<text x="${W - R + 14}" y="${(y(1951) + 4).toFixed(1)}" font-size="13" fill="${C.mut}">line 1,951</text>
<path d="${seg(vals.slice(0, 4), 0)}" fill="none" stroke="${C.grid}" stroke-width="2"></path>
<path d="${seg(vals.slice(3), 3)}" fill="none" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"></path>
<line x1="${x(3).toFixed(1)}" x2="${x(3).toFixed(1)}" y1="${H - B - 14}" y2="${H - B}" stroke="${C.acc}" stroke-width="2"></line>
<text x="${x(3).toFixed(1)}" y="${H - B - 19}" font-size="13" fill="${C.acc}" text-anchor="middle">adjusted −8 g</text>
${[10, 11, 12, 13].map((i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(vals[i]).toFixed(1)}" r="4" fill="${C.acc}"></circle>`).join('')}
<text x="${x(13).toFixed(1)}" y="${y(1972).toFixed(1)}" font-size="13" fill="${C.acc}" text-anchor="end">rising 4 days in a row</text>
<text x="${x(0).toFixed(1)}" y="${H - 6}" font-size="13" fill="${C.mut}">19 Aug</text>
<text x="${x(7).toFixed(1)}" y="${H - 6}" font-size="13" fill="${C.mut}" text-anchor="middle">26 Aug</text>
<text x="${x(13).toFixed(1)}" y="${H - 6}" font-size="13" fill="${C.mut}" text-anchor="end">1 Sep</text>
</svg>`;
}

// ---------- boards ----------
const H = { main: 1180, optb: 1180, readings: 1080, weight: 1460, rejects: 1280, report: 1220, wall: 810, sheet: 980, states: 330 };

const Main = doc(`${header({ active: 'Line', period: 'This shift' })}
<div class="page">
  <p class="q">Is the line running, what has it made this shift, and does anything need attention?</p>
  <h1>Line 3 is running — 2 h 55 min into the evening shift, 14:00 to 22:00.</h1>
  <div class="block first figs">
    <div class="fig"><b>874<small>cones</small></b><span>99.7% within weight limits</span></div>
    <div class="fig"><b>37<small>sacks</small></b><span>1,747 kg</span></div>
    <div class="fig"><b>28<small>rejected</small></b><span>25 quality, 3 weight · 3.1% of everything weighed</span></div>
  </div>
  <div class="block">
    <p class="h2"><span>Attention</span><span>judged over the last 14 production days</span></p>
    ${attentionList}
  </div>
  <div class="block">
    <p class="h2"><span>Product recorded in this system</span><span><a href="#">History</a></span></p>
    ${productBlock}
  </div>
  <div class="block">
    <p class="h2"><span>Stations — cones this shift</span><span>Station 12 has been quiet for 22 min</span></p>
    ${stationRow(shiftCounts)}
  </div>
  <div class="block">
    <p class="h2"><span>Last readings</span></p>
    ${lastReadings}
  </div>
  <div class="details"><a href="#">Details</a> · how the line state is judged · the shift rule · the three attention rules</div>
</div>`, H.main);

const LineOptionB = doc(`${header({ active: 'Line', period: 'This shift' })}
<div class="page">
  <div class="figs" style="margin-top: 2px;">
    <div class="fig panel"><b>874<small>cones</small></b><span>99.7% within weight limits</span></div>
    <div class="fig panel"><b>37<small>sacks</small></b><span>1,747 kg</span></div>
    <div class="fig panel"><b>28<small>rejected</small></b><span>25 quality, 3 weight · 3.1% of everything weighed</span></div>
  </div>
  <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 24px; margin: 26px 0 22px;">
    <div style="font-size: 22px; font-weight: 500;">Running · 2 h 55 min into the evening shift, 14:00 to 22:00</div>
    <div class="mut sm">Is the line running, what has it made, does anything need attention?</div>
  </div>
  <div class="two">
    <div class="panel">
      <p class="h2"><span>Attention</span><span>last 14 days</span></p>
      ${attentionList}
    </div>
    <div class="panel">
      <p class="h2"><span>Product recorded in this system</span><span><a href="#">History</a></span></p>
      ${productBlock}
    </div>
  </div>
  <div class="panel" style="margin-top: 20px;">
    <p class="h2"><span>Stations — cones this shift</span><span>Station 12 has been quiet for 22 min</span></p>
    ${stationRow(shiftCounts)}
  </div>
  <div class="panel" style="margin-top: 20px;">
    <p class="h2"><span>Last readings</span></p>
    ${lastReadings}
  </div>
</div>`, H.optb, `
.panel{background:${C.paper3};border-radius:4px;padding:22px 24px}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.fig.panel b{font-size:56px}
.panel table td{border-bottom-color:${C.rule2}}
.panel .st{background:#fff}
`);

const readingRows = [
  ['16:39:02', 'Station 9', '1,949 g', 'Passed'],
  ['16:38:51', 'Station 3', '1,956 g', 'Passed'],
  ['16:38:47', 'Station 11', '1,912 g', '<span class="acc">Rejected by the scale</span> · <span class="acc">outside product limits</span>', true],
  ['16:38:40', 'Station 7', '1,963 g', 'Passed'],
  ['16:38:33', 'Station 1', '1,947 g', 'Passed'],
  ['16:38:29', 'Station 14', '1,953 g', 'Passed'],
  ['16:38:20', 'Station 5', '1,944 g', 'Passed'],
  ['16:38:12', 'Station 8', '1,958 g', 'Passed'],
  ['16:38:04', 'Station 2', '1,950 g', 'Passed'],
  ['16:37:58', 'Station 10', '1,918 g', 'Passed · <span class="acc">outside product limits</span>'],
  ['16:37:51', 'Station 6', '1,952 g', 'Passed'],
  ['16:37:45', 'Station 13', '1,948 g', 'Passed'],
];
const Readings = doc(`${header({ active: 'Readings', period: 'Today' })}
<div class="page shifted">
  <p class="q">Every cone and every sack that was weighed, with the rejected ones flagged.</p>
  <h1>Today, 06:00 to 16:39 so far: 3,408 cones weighed, 11 rejected by the scale (0.3%).</h1>
  <div class="block first" style="padding-top: 22px; padding-bottom: 18px;">
    <div class="row" style="justify-content: space-between;">
      <div class="row">
        <div class="toggle"><span class="on">Cones</span><span>Sacks</span><span>Rejected cones</span></div>
        <span class="chip">Station ›</span><span class="chip">Rejected only</span><span class="chip">Shift ›</span><a class="sm" href="#">More filters</a>
      </div>
      <div class="row"><a class="btn" href="#">Export CSV</a><a class="btn" href="#">Print</a></div>
    </div>
  </div>
  <table>
    <tr><th style="width: 110px;">Time</th><th style="width: 120px;">Station</th><th class="n" style="width: 90px;">Weight</th><th style="padding-left: 32px;">Status</th><th></th></tr>
    ${readingRows.map(([t, s, w, st, hl]) => `<tr${hl ? ' class="hl"' : ''}><td>${t}</td><td>${s}</td><td class="n">${w}</td><td style="padding-left: 32px;">${st}</td><td class="n"><span class="chev">›</span></td></tr>`).join('\n    ')}
  </table>
  <p class="mut sm" style="margin: 14px 0 0;">25 a page, newest first · 3,408 today · new readings appear every 15 seconds &nbsp;·&nbsp; <a href="#">Next 25 ›</a></p>
</div>
<div class="sheet">
  <a class="x" href="#">Close · Esc</a>
  <p class="q">Cone · Station 11 · Evening shift</p>
  <div class="big">1,912 g</div>
  <div class="acc" style="margin-top: 8px; font-weight: 500;">Rejected by the scale</div>
  <div class="g" style="margin-top: 4px;">Also outside the product's limits: 1,960 ± 40 g at this time, so 8 g under the lower limit.</div>
  <div class="kv" style="margin-top: 24px;">
    <div>Weighed</div><div>Wed 2 Sep, 16:38:47</div>
    <div>Shift</div><div>Evening (14:00 to 22:00)</div>
    <div>Station</div><div>Station 11</div>
    <div>Record</div><div>C-2147483</div>
    <div>Product then</div><div>201-IH0-SD, recorded 2 Sep 07:03</div>
  </div>
  <div class="details" style="margin-top: 28px;"><a href="#">Provenance</a> · where this reading came from and when it arrived</div>
</div>`, H.readings, `
.page.shifted{margin:0;max-width:1000px;padding-left:64px}
`);

const stationRows = [
  ['Station 4', '1,942 g', '−9 g', '−18 g', 'low 6 of 14 days', '2.6%', 'Has read about 9 g lighter than the line for 6 days — check its scale first.', true],
  ['Station 7', '1,963 g', '+12 g', '+3 g', 'rising 4 days', '2.1%', 'Has read about 12 g heavier than the line for 4 days — check its scale first.', true],
  ['Station 11', '1,946 g', '−5 g', '−14 g', '—', '3.4%', 'Steady. Highest reject rate on the line, mostly quality codes — look at tubes before scales.'],
  ['Station 13', '1,950 g', '−1 g', '−10 g', '—', '2.2%', 'Steady.'],
  ['Station 1', '1,952 g', '+1 g', '−8 g', '—', '2.2%', 'Steady.'],
  ['Station 5', '1,952 g', '+1 g', '−8 g', '—', '2.3%', 'Adjusted 2 days ago by A. Sajid, steady since.'],
  ['Station 10', '1,953 g', '+2 g', '−7 g', '—', '2.4%', 'Steady.'],
];
const Weight = doc(`${header({ active: 'Weight', period: 'Today' })}
<div class="page">
  <p class="q">Are the cones at the right weight, and does any station's scale need attention?</p>
  <h1>Average recorded weight today is 1,951 g; the product target is 1,960 g (weight basis not yet confirmed). Two stations need a look.</h1>
  <div class="block first figs">
    <div class="fig"><b>1,951<small>g average</small></b><span>product target 1,960 g</span></div>
    <div class="fig"><b>0.3%<small>rejected by the scale</small></b><span>11 of 3,408 cones</span></div>
    <div class="fig"><b>1,934 to 1,967<small>g</small></b><span>95 of every 100 cones fall in this range</span></div>
  </div>
  <div class="block" style="padding-top: 18px; padding-bottom: 18px; border-top: 0;">
    <span class="acc">6 cones today were passed by the scale but sit outside the product's limits.</span> <a href="#">See them</a>
  </div>
  <div class="block">
    <div class="row" style="justify-content: space-between; margin-bottom: 12px;">
      <div class="toggle"><span class="on">Over time</span><span>Distribution</span></div>
      <div class="readout">09:30 · 1,958 g, the average of 187 cones · rising for 6 groups <span class="mut">(the readout follows the pointer)</span></div>
    </div>
    ${weightChart()}
  </div>
  <div class="block">
    <p class="h2"><span>Stations, judged over the last 14 production days</span><span>flagged first, then by distance from target</span></p>
    <table>
      <tr><th>Station</th><th class="n">Average</th><th class="n">vs line</th><th class="n">vs target</th><th style="padding-left: 28px;">Pattern</th><th class="n">Rejects</th><th style="padding-left: 28px;">What the data shows</th></tr>
      ${stationRows.map(([s, a, l, t, p, r, txt, f]) => `<tr><td${f ? ' class="acc"' : ''} style="font-weight: 500; white-space: nowrap;">${s}<span class="chev">›</span></td><td class="n">${a}</td><td class="n">${l}</td><td class="n">${t}</td><td style="padding-left: 28px; white-space: nowrap;"${f ? ' class="acc"' : ''}>${p}</td><td class="n">${r}</td><td style="padding-left: 28px;">${txt}${f ? ' <a href="#" style="white-space: nowrap;">Log an adjustment</a>' : ''}</td></tr>`).join('\n      ')}
      <tr><td colspan="7" class="g">and 7 more stations, all steady<span class="chev">›</span></td></tr>
    </table>
    <p class="sm g" style="margin: 16px 0 0;"><a href="#">Adjustment log</a> · 3 adjustments in the last 14 days. A logged adjustment restarts that station's pattern from that moment.</p>
  </div>
  <div class="details"><a href="#">Show the working</a> · the statistics behind this screen, the scale verdict against the product limits, and the drift rules</div>
</div>`, H.weight);

const reasons = [['Code 10/1 — not yet named', 1412, 56], ['Code 2/1 — not yet named', 630, 25], ['No code recorded', 227, 9], ['Code 1/2 — not yet named', 126, 5], ['Code 1/1 — not yet named', 76, 3], ['Code 2/2 — not yet named', 49, 2]]; // sums to 2,520
const Rejects = doc(`${header({ active: 'Rejects', period: 'Today' })}
<div class="page">
  <p class="q">How many cones are being rejected, why, is it getting worse, and where?</p>
  <h1>89 cones rejected today, 2.6% of everything weighed — 78 for quality, 11 for weight — and quality rejects have been rising since Tue 22:00.</h1>
  <div class="block first figs two">
    <div class="fig"><b>89<small>rejected</small></b><span>2.6% of everything weighed today</span></div>
    <div class="fig"><b>56%<small>Code 10/1</small></b><span>the top reason over the last 14 days — not yet named</span></div>
  </div>
  <div class="block">
    <div class="row" style="justify-content: space-between; margin-bottom: 12px;">
      <p class="h2" style="margin: 0;"><span>Reject rate per four hours, last 14 days · today shaded</span></p>
      <div class="readout">Tue 1 Sep, 20:00 to 24:00 · quality 2.5% · weight 0.4% · 1,398 cones weighed</div>
    </div>
    ${rejectChart()}
  </div>
  <div class="block">
    <p class="h2"><span>Reasons, last 14 days</span><span>Reason names are awaiting IFL. A manager can name a code here; the name applies to history.</span></p>
    <div class="bars">
      ${reasons.map(([l, n, pct], i) => `<div><span${i === 0 ? '' : ' class="g"'}>${l}<span class="chev">›</span></span><i style="width: ${Math.round((n / 1412) * 100)}%;${i === 0 ? '' : ` background: ${C.grid};`}"></i><em>${fmt(n)} · ${pct}%</em>${l === 'No code recorded' ? '<span></span>' : '<a class="sm" href="#">Name it</a>'}</div>`).join('\n      ')}
    </div>
  </div>
  <div class="block" style="padding-top: 22px; padding-bottom: 22px;">
    <a href="#">See the rejected cones themselves</a> <span class="mut">· opens Readings with the Rejected toggle and this period</span><br>
    <a href="#">By station</a> <span class="mut">· opens the Weight station table sorted by reject rate</span>
  </div>
  <div class="details"><a href="#">Details</a> · how a sustained rise is detected · the usual range per four-hour bucket · the code table</div>
</div>`, H.rejects);

const byShift = [['Morning', '2,534', '103', '4,867 kg', '61', '2.4%'], ['Evening', '2,638', '112', '5,275 kg', '66', '2.4%'], ['Night', '2,570', '110', '5,198 kg', '59', '2.2%']];
const byDay = [['Wed 26 Aug', '5,034', '241', '11,375 kg', '106'], ['Thu 27 Aug', '7,620', '319', '15,057 kg', '167'], ['Fri 28 Aug', '7,532', '370', '17,464 kg', '181'], ['Sat 29 Aug', '7,888', '367', '17,322 kg', '193'], ['Sun 30 Aug', '7,645', '330', '15,576 kg', '167'], ['Mon 31 Aug', '7,844', '375', '17,700 kg', '189'], ['Tue 1 Sep', '7,742', '325', '15,340 kg', '186']];
const Report = doc(`${header({ active: 'Report', period: 'Pick dates', range: '26 Aug – 1 Sep' })}
<div class="page">
  <div class="row" style="justify-content: space-between; align-items: flex-start;">
    <div>
      <p class="q">What did the line make over this period, on paper.</p>
      <h1>26 Aug to 1 Sep: all 7 days hold production data.</h1>
    </div>
    <div class="row" style="padding-top: 26px;"><a class="btn" href="#">Print</a><a class="btn" href="#">Export CSV</a></div>
  </div>
  <div class="block first figs four">
    <div class="fig"><b>51,305<small>cones</small></b><span>99.6% within weight limits</span></div>
    <div class="fig"><b>2,327<small>sacks</small></b><span>22 cones per sack</span></div>
    <div class="fig"><b>109,834<small>kg</small></b><span>47.2 kg average sack</span></div>
    <div class="fig"><b>1,189<small>rejected</small></b><span>2.3% of everything weighed</span></div>
  </div>
  <div class="block">
    <div class="row" style="justify-content: space-between; margin-bottom: 12px;">
      <p class="h2" style="margin: 0;"><span>Cones per day</span></p>
      <div class="readout">Sat 29 Aug · 7,888 cones · 367 sacks</div>
    </div>
    ${conesChart()}
    <p class="g" style="margin: 18px 0 0;">Time lost 3 h 40 min in 12 stops <span class="mut sm">(planned breaks and faults cannot be told apart in the data)</span>.</p>
    <p class="mut sm" style="margin: 10px 0 0;">Sack stock per machine is not shown: the plant's sack records carry no machine and no record of a sack leaving. IFL has been asked how sacks are linked to machines and how they leave stock.</p>
  </div>
  <div class="block" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 40px;">
    <div>
      <p class="h2"><span>By shift, 1 Sep</span></p>
      <table>
        <tr><th>Shift</th><th class="n">Cones</th><th class="n">Sacks</th><th class="n">Sack weight</th><th class="n">Rejected</th><th class="n">Rate</th></tr>
        ${byShift.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((c) => `<td class="n">${c}</td>`).join('')}</tr>`).join('\n        ')}
      </table>
    </div>
    <div>
      <p class="h2"><span>By day</span></p>
      <table>
        <tr><th>Day</th><th class="n">Cones</th><th class="n">Sacks</th><th class="n">Sack weight</th><th class="n">Rejected</th></tr>
        ${byDay.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((c) => `<td class="n">${c}</td>`).join('')}</tr>`).join('\n        ')}
      </table>
    </div>
  </div>
</div>`, H.report);

const Wall = doc(`<div class="wall">
  <div class="w-head">
    <div class="w-state">Line 3 is running</div>
    <div class="w-shift">Evening shift 14:00 to 22:00 &nbsp;·&nbsp; 16:55</div>
  </div>
  <div class="w-figs">
    <div class="w-fig"><b>874</b><span>cones · 99.7% within limits</span></div>
    <div class="w-fig"><b>37</b><span>sacks · 1,747 kg</span></div>
    <div class="w-fig"><b>28</b><span>rejected · 3.1%</span></div>
  </div>
  <div>
    <div class="w-sub">Last sack 47.3 kg at 16:38 &nbsp;·&nbsp; last cone 1,949 g at 16:39, Station 9</div>
    <div class="w-st">${shiftCounts.map((c, i) => { const n = i + 1; const cls = (n === 4 || n === 7) ? ' class="flag"' : n === 12 ? ' class="dim"' : ''; return `<div${cls}><i>${n}</i><b>${c}</b></div>`; }).join('')}</div>
  </div>
  <div class="w-foot">
    <span><span class="dot" style="width: 12px; height: 12px; margin-right: 12px;"></span>Readings to 16:39 · they arrive about 16 min after weighing</span>
    <span>Stations 4 and 7: check scales &nbsp;·&nbsp; Station 12 quiet 22 min</span>
  </div>
</div>`, H.wall, `
.wall{padding:44px 56px 40px;box-sizing:border-box;height:810px;display:flex;flex-direction:column;justify-content:space-between}
.w-head{display:flex;justify-content:space-between;align-items:baseline}
.w-state{font-size:60px;font-weight:600;letter-spacing:-0.02em;line-height:1.1}
.w-shift{font-size:28px;color:${C.gra}}
.w-figs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:48px}
.w-fig b{display:block;font-size:112px;line-height:1;font-weight:600;letter-spacing:-0.03em}
.w-fig span{display:block;font-size:28px;color:${C.gra};margin-top:10px}
.w-sub{font-size:26px;color:${C.gra};margin-bottom:16px}
.w-st{display:grid;grid-template-columns:repeat(14,minmax(0,1fr));gap:10px}
.w-st div{border:2px solid ${C.rule};border-radius:6px;text-align:center;padding:10px 4px 8px}
.w-st i{display:block;font-style:normal;font-size:18px;color:${C.mut}}
.w-st b{display:block;font-size:30px;font-weight:500;line-height:1.2}
.w-st .flag{border-color:${C.acc}} .w-st .flag b{color:${C.acc}}
.w-st .dim{border-style:dashed} .w-st .dim b,.w-st .dim i{color:${C.grid}}
.w-foot{display:flex;justify-content:space-between;font-size:24px;color:${C.gra}}
`);

const StationSheet = doc(`<div class="sp">
  <a class="x" href="#">Close · Esc</a>
  <p class="q">Station 7 · today</p>
  <h1 style="font-size: 26px;">Reads 12 g above the line and 3 g above the target today.</h1>
  <div class="kv" style="margin-top: 20px;">
    <div>Average today</div><div>1,963 g · 243 cones</div>
    <div>vs line</div><div>+12 g</div>
    <div>vs target</div><div>+3 g (target 1,960 g)</div>
    <div>Rejects</div><div>2.1% · line 2.7%</div>
  </div>
  <p class="h2" style="margin: 26px 0 8px;"><span>Daily average, last 14 days</span></p>
  ${stationChart()}
  <p class="acc" style="margin: 16px 0 0;">Has read about 12 g heavier than the line for 4 days. Weighing data cannot tell a heavy scale from heavy cones — check the scale with a reference weight first.</p>
  <p class="h2" style="margin: 26px 0 8px;"><span>Adjustments</span></p>
  <table>
    <tr><td style="width: 110px;">22 Aug 09:12</td><td>−8 g · A. Sajid · reference weight read 8 g high</td></tr>
  </table>
  <p class="mut sm" style="margin: 8px 0 0;">Days before an adjustment are drawn grey; the pattern is judged from the adjustment on.</p>
  <div style="margin-top: 24px;"><a class="btn primary" href="#">Log an adjustment</a></div>
</div>`, H.sheet, `
.sp{position:relative;padding:28px 32px;box-sizing:border-box;min-height:${H.sheet}px}
.sp .x{position:absolute;top:24px;right:28px;color:${C.gra};font-size:15px}
`, 560);

const HeaderStates = doc(`${bar({ active: 'Line', period: 'This shift' })}
${strip('ok')}
<div class="cap">Healthy: the newest reading's time and the measured lag, in words. The whole sentence opens sync health.</div>
${strip('stale')}
<div class="cap">Sync stale (no successful pass for three cadences): the Line headline becomes "Cannot tell whether the line is running." Nothing asserts Running or Stopped.</div>
${strip('late')}
<div class="cap">Lag beyond the credible ceiling: the figures stay, with the warning that the state may be out of date. The lag is always the measured value, never a constant.</div>`, H.states);

const boards = { 'Main.dc.html': Main, 'LineOptionB.dc.html': LineOptionB, 'Readings.dc.html': Readings, 'Weight.dc.html': Weight, 'Rejects.dc.html': Rejects, 'Report.dc.html': Report, 'Wall.dc.html': Wall, 'StationSheet.dc.html': StationSheet, 'HeaderStates.dc.html': HeaderStates };
for (const [f, s] of Object.entries(boards)) writeFileSync(f, s);

const row2 = H.main + 120, row3 = row2 + Math.max(H.readings, H.weight) + 120, row4 = row3 + Math.max(H.rejects, H.report) + 120;
const canvas = {
  artboards: [
    { file: 'Main.dc.html', title: 'Line (home)', x: 0, y: 0, w: 1440, h: H.main },
    { file: 'LineOptionB.dc.html', title: 'Line - Option B (figures first)', x: 1520, y: 0, w: 1440, h: H.optb },
    { file: 'Readings.dc.html', title: 'Readings, with a reading sheet open', x: 0, y: row2, w: 1440, h: H.readings },
    { file: 'Weight.dc.html', title: 'Weight', x: 1520, y: row2, w: 1440, h: H.weight },
    { file: 'Rejects.dc.html', title: 'Rejects', x: 0, y: row3, w: 1440, h: H.rejects },
    { file: 'Report.dc.html', title: 'Report', x: 1520, y: row3, w: 1440, h: H.report },
    { file: 'Wall.dc.html', title: 'Wall (TV, 1080p at 0.75)', x: 0, y: row4, w: 1440, h: H.wall },
    { file: 'StationSheet.dc.html', title: 'Station sheet', x: 1520, y: row4, w: 560, h: H.sheet },
    { file: 'HeaderStates.dc.html', title: 'Header - the three states', x: 2160, y: row4, w: 1440, h: H.states },
  ],
  annotations: [
    { id: 'read-me', x: 0, y: -270, w: 640, text: 'PROPOSAL FOR SIGN-OFF. Nothing here is built.\nOne period control in the header for the whole app. Each screen opens with one sentence that answers its question. Statistics live behind "Show the working".\nNumbers are sample values shaped from the simulator\'s last complete day (1 Sep): 1,951 g average, 47.2 kg sacks, 2.3% rejected, product 201-IH0-SD at 1,960 ± 40 g.\nOption B (to the right) is the one alternative on the table: figures before the sentence, grey panels instead of rules. Quicker to scan for numbers, one step back toward tiles.' },
    { id: 'weight-note', x: 3040, y: row2, w: 440, text: 'Weight, after both critics\' corrections: the over-time chart is primary (distribution is a toggle); every station shows bias vs target AND vs line; the recommendation states what the data shows and stops; drift is judged over a fixed 14-day window, never the selected period; the headline does not state a difference from target until the weight basis is confirmed.' },
    { id: 'header-note', x: 3680, y: row4, w: 440, text: 'The lag sentence has three states, all measured from the live endpoint. Never a hard-coded "about 18 minutes". When the sync is stale, no screen asserts Running or Stopped.' },
    { id: 'sheet-note', x: 1520, y: row4 + H.sheet + 40, w: 560, text: 'The station sheet opens from Line\'s station row, the Weight table and the Rejects link. It is where the evidence behind any recommendation lives, one tap away.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2));
console.log('built', Object.keys(boards).length, 'boards; rows at', row2, row3, row4);
