// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';

// 3D 西行世界：纯 WebGL，无第三方依赖。三种镜头：俯瞰 / 远处 / 第一视角（统一为"轨道相机 + 距离"模型，距离→0 即第一视角）。
const SKY = { dawn: [.91, .66, .5, .8], day: [.62, .78, .9, 1], dusk: [.85, .5, .36, .75], night: [.06, .08, .17, .45] };
const WX = { clear: [.0075], mist: [.02, [.8, .82, .84]], sandstorm: [.024, [.8, .64, .4]], snow: [.018, [.88, .91, .94]], divine_glow: [.009, [.96, .86, .55]] };
const PRE = { over: [-1.1, 46], far: [-.3, 26], fp: [-.06, .01] }; // [俯仰角, 距离]
const SC = 1.7, LIM = 105, G = 104;
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.substr(i, 2), 16) / 255);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pg = (x) => clamp((x + 80) / 160, 0, 1); // 西行进度：0=长安(西) → 1=灵山(东)
const rngf = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const mkN = (s) => { const r = rngf(s), a = Array.from({ length: 1024 }, r), h = (x, y) => a[(Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) & 1023];
  return (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v; }; };
const pers = (f, a, n, r) => { const t = 1 / Math.tan(f / 2), k = 1 / (n - r); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (n + r) * k, -1, 0, 0, 2 * n * r * k, 0]; };
const nrm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const look = (e, c) => { const z = nrm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = nrm(crs([0, 1, 0], z)), y = crs(z, x), d = (a) => -(a[0] * e[0] + a[1] * e[1] + a[2] * e[2]);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, d(x), d(y), d(z), 1]; };
const mul = (a, b) => { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };

const C = { sand: hex('#d9c590'), g1: hex('#8aa65f'), g2: hex('#5f8247'), rock: hex('#8d8478'), snow: hex('#f0eee8'), road: hex('#bf9d68'), water: hex('#4a86a8') };
const TY = { city: ['#c8a45c', '#a8362b', 2.6, 2.6], temple: ['#d8b86a', '#c98a1e', 2.2, 2.4], mountain: ['#8a8176', '#f0ede6', 0, 0], river: ['#6fb0d0', '#3f86ad', 2.4, .5], cave: ['#4d4640', '#c0392b', 2.6, 1.4], tribulation: ['#80603c', '#b8352a', 2.2, 1.8], shrine: ['#a9b596', '#5aa86b', 1.6, 1.8] };
const TYC = Object.fromEntries(Object.entries(TY).map(([k, v]) => [k, [hex(v[0]), hex(v[1]), v[2], v[3]]]));
const CH = { tang_sanzang: hex('#e0b252'), sun_wukong: hex('#e8963a'), zhu_bajie: hex('#e58fa5'), sha_wujing: hex('#5b86c4'), bai_long_ma: hex('#f4f1ea') };
const SKIN = hex('#e6c29a');

const VS = `attribute vec3 p;attribute vec3 n;attribute vec3 c;uniform mat4 VP;uniform mat4 M;uniform vec3 tn;uniform float lt;varying vec3 vc;varying float vd;varying float vl;
void main(){vec4 w=M*vec4(p,1.);gl_Position=VP*w;vec3 nn=normalize((M*vec4(n,0.)).xyz);vl=(.5+.55*max(dot(nn,normalize(vec3(.45,.8,.35))),0.))*lt;vc=c*tn;vd=gl_Position.w;}`;
const FS = `precision mediump float;varying vec3 vc;varying float vd;varying float vl;uniform vec3 fg;uniform float fd;
void main(){vec3 col=vc*vl;float f=clamp(1.-exp(-vd*fd),0.,1.);gl_FragColor=vec4(mix(col,fg,f),1.);}`;

export const HAS_GL = (() => { try { return !!document.createElement('canvas').getContext('webgl'); } catch (e) { return false; } })();

// 三角面（平面着色）；ctr 用于把法线翻向外侧
const P = (A, a, b, c, col, ctr) => {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (ctr) { const gx = (a[0] + b[0] + c[0]) / 3 - ctr[0], gy = (a[1] + b[1] + c[1]) / 3 - ctr[1], gz = (a[2] + b[2] + c[2]) / 3 - ctr[2]; if (nx * gx + ny * gy + nz * gz < 0) { nx = -nx; ny = -ny; nz = -nz; } }
  for (const q of [a, b, c]) A.push(q[0], q[1], q[2], nx, ny, nz, col[0], col[1], col[2]);
};
const cone = (A, cx, cy, cz, rd, hh, col, n = 6) => {
  const ap = [cx, cy + hh, cz], ring = Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(i / n * 6.2832) * rd, cy, cz + Math.sin(i / n * 6.2832) * rd]), ctr = [cx, cy + hh * .4, cz];
  for (let i = 0; i < n; i++) { P(A, ap, ring[i], ring[i + 1], col, ctr); P(A, [cx, cy, cz], ring[i + 1], ring[i], col, ctr); }
};
const cube = (A) => {
  const v = (x, y, z) => [x - .5, y, z - .5], c = [1, 1, 1], p = [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1), v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)];
  const q = (a, b, d, e) => { P(A, a, b, d, c, [0, .5, 0]); P(A, a, d, e, c, [0, .5, 0]); };
  q(p[0], p[1], p[2], p[3]); q(p[4], p[5], p[6], p[7]); q(p[0], p[1], p[5], p[4]); q(p[1], p[2], p[6], p[5]); q(p[2], p[3], p[7], p[6]); q(p[3], p[0], p[4], p[7]);
};

export function start3D(box, S) {
  const cv = document.createElement('canvas'), ov = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none';
  ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  const gl = cv.getContext('webgl', { antialias: true });
  if (!gl) return null;
  const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null; };
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const Lc = (n) => gl.getUniformLocation(pr, n), uVP = Lc('VP'), uM = Lc('M'), uTn = Lc('tn'), uLt = Lc('lt'), uFg = Lc('fg'), uFd = Lc('fd');
  const buf = (arr) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); return b; };
  const bind = (b) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); [['p', 0], ['n', 3], ['c', 6]].forEach(([k, o]) => { const a = gl.getAttribLocation(pr, k); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 36, o * 4); }); };

  // ---------- 世界生成 ----------
  const nodes = S.current.nodes, N = mkN(7), pts = nodes.map((n) => [(n.x - 50) * SC, (n.y - 50) * SC]);
  const lakes = pts.filter((_, i) => nodes[i].type === 'river');
  const dR = (x, z) => { let m = 1e9; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1); m = Math.min(m, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz)); } return m; };
  const H = (x, z) => {
    const d = dR(x, z), b = N(x / 26 + 5, z / 26) * .65 + N(x / 10, z / 10) * .35;
    const pp = pg(x); let h = b * 5 - 1.5 + Math.pow(Math.max(0, b - .52) * 2.4, 2) * (14 + 22 * pp) + sm(.75, 1.1, Math.hypot(x, z) / LIM) * (7 + 24 * pp);
    for (const [lx, lz] of lakes) { const l = 1 - Math.hypot(x - lx, z - lz) / 11; if (l > 0) h -= l * 5 * sm(2, 5, d); }
    const w = 1 - sm(2.2, 10, d);
    return Math.max(-4, h * (1 - w) + (1.1 + N(x / 6, z / 6) * .3) * w);
  };
  const colAt = (x, z, h, d) => {
    const sl = 9 + (1 - pg(x)) * 60; let c = h < .6 ? C.sand : h < 4 ? mix(C.g1, C.g2, h / 4) : h < 10 ? mix(C.g2, C.rock, (h - 4) / 6) : mix(C.rock, C.snow, clamp((h - sl) / 6, 0, 1));
    c = mix(c, C.road, 1 - sm(1.6, 3.2, d));
    const j = .88 + .24 * N(x * 1.3, z * 1.3); return c.map((v) => Math.min(1, v * j));
  };
  const Mx = [], U = [], step = 2 * LIM / G, hg = [];
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { const x = -LIM + i * step, z = -LIM + j * step; hg.push([x, H(x, z), z]); }
  const V = (i, j) => hg[j * (G + 1) + i];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const a = V(i, j), b = V(i, j + 1), c = V(i + 1, j), d = V(i + 1, j + 1), cx = (a[0] + d[0]) / 2, cz = (a[2] + d[2]) / 2, col = colAt(cx, cz, (a[1] + b[1] + c[1] + d[1]) / 4, dR(cx, cz));
    P(Mx, a, b, c, col); P(Mx, c, b, d, col);
  }
  const WL = LIM * 1.3; P(Mx, [-WL, 0, -WL], [-WL, 0, WL], [WL, 0, -WL], C.water); P(Mx, [WL, 0, -WL], [-WL, 0, WL], [WL, 0, WL], C.water);
  const r = rngf(11);
  for (let k = 0; k < 3200; k++) {
    const x = (r() * 2 - 1) * (LIM - 6), z = (r() * 2 - 1) * (LIM - 6), h = H(x, z);
    if (h < .7 || h > 7 || N(x / 7 + 40, z / 7) < .44 || dR(x, z) < 4.5 || pts.some((p) => Math.hypot(x - p[0], z - p[1]) < 5)) continue;
    const s = .8 + r() * 1.1, g = .85 + r() * .3;
    cone(Mx, x, h - .1, z, 1.1 * s, 2.8 * s, [.2 * g, .42 * g, .22 * g], 5); cone(Mx, x, h + 1.4 * s, z, .8 * s, 2.2 * s, [.27 * g, .52 * g, .28 * g], 5);
  }
  const LS = pts[pts.length - 1], lsx = LS[0] + 15, lsz = LS[1] - 4, lsy = Math.max(H(lsx, lsz), 1);
  cone(Mx, lsx, lsy - 3, lsz, 18, 28, hex('#d9d3c3'), 7); cone(Mx, lsx, lsy + 8, lsz, 11, 18, hex('#f2eee3'), 7); cone(Mx, lsx, lsy + 21, lsz, 4.2, 8, hex('#f0c24a'), 7);
  cube(U); const u1 = [0, U.length / 9]; cone(U, 0, 0, 0, .5, 1, [1, 1, 1], 6); const u2 = [u1[1], U.length / 9 - u1[1]];
  const bS = buf(Mx), nS = Mx.length / 9, bU = buf(U);
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const obj = (u, x, y, z, sx, sy, sz, rt, c) => { const cs = Math.cos(rt), sn = Math.sin(rt); gl.uniformMatrix4fv(uM, false, [sx * cs, 0, -sx * sn, 0, 0, sy, 0, 0, sz * sn, 0, sz * cs, 0, x, y, z, 1]); gl.uniform3f(uTn, c[0], c[1], c[2]); gl.drawArrays(gl.TRIANGLES, u[0], u[1]); };

  // ---------- 状态 ----------
  const idx = (id) => nodes.findIndex((n) => n.id === id);
  let cur = S.current.playerNodeId, i0 = Math.max(0, idx(cur));
  const lead = { x: pts[i0][0], z: pts[i0][1] }, trail = [], ni = i0 + 1 < pts.length ? i0 + 1 : i0 - 1;
  let path = [], hd = i0 + 1 < pts.length ? Math.atan2(pts[pts.length - 1][0] - pts[i0][0], pts[pts.length - 1][1] - pts[i0][1]) : Math.atan2(pts[i0][0] - pts[i0 - 1][0], pts[i0][1] - pts[i0 - 1][1]), moving = false, VP = I, hits = [], lastMode = '', dr = null, snap = 0, sY = null;
  const cam = { yaw: Math.PI, pit: PRE.over[0], dist: PRE.over[1] }, tgt = { pit: PRE.over[0], dist: PRE.over[1] };
  box.append(cv, ov);
  const cx = ov.getContext('2d');
  const proj = (x, y, z) => { const c = VP, w = c[3] * x + c[7] * y + c[11] * z + c[15]; if (w <= .1) return null; return [(c[0] * x + c[4] * y + c[8] * z + c[12]) / w * .5 + .5, (c[1] * x + c[5] * y + c[9] * z + c[13]) / w * .5 + .5, w]; };

  cv.onpointerdown = (e) => { dr = { x: e.clientX, y: e.clientY, m: 0 }; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => {
    if (!dr) return; const dx = e.clientX - dr.x, dy = e.clientY - dr.y; dr.x = e.clientX; dr.y = e.clientY; dr.m += Math.abs(dx) + Math.abs(dy);
    cam.yaw += dx * .005; cam.pit = tgt.pit = clamp(cam.pit + dy * .004, -1.45, S.current.mode === 'fp' ? 1 : -.05);
  };
  cv.onpointercancel = () => { dr = null; };
  cv.onpointerup = (e) => {
    const moved = dr ? dr.m : 99; dr = null; if (moved > 6) return;
    const rc = cv.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top; let best = null, bd = 34;
    hits.forEach((h) => { const d = Math.hypot(h.x - px, h.y - py); if (d < bd) { bd = d; best = h.n; } });
    if (best && S.current.onSelect) S.current.onSelect(best);
  };
  cv.addEventListener('wheel', (e) => { e.preventDefault(); if (S.current.mode !== 'fp') tgt.dist = clamp(tgt.dist * (1 + e.deltaY * .0012), 10, 90); }, { passive: false });

  gl.enable(gl.DEPTH_TEST);
  let last = 0, raf = 0;
  const frame = (ts) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (ts - last) / 1000 || 0); last = ts; const t = ts / 1000, s = S.current;
    const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth * dpr | 0, h = cv.clientHeight * dpr | 0; if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = ov.width = w; cv.height = ov.height = h; }
    gl.viewport(0, 0, w, h);
    // 行进
    if (s.playerNodeId !== cur) {
      const a = idx(cur), b = idx(s.playerNodeId); cur = s.playerNodeId; path = [];
      if (a < 0 || b < 0 || a === b) { if (b >= 0) { lead.x = pts[b][0]; lead.z = pts[b][1]; } } else { const st = a < b ? 1 : -1; for (let i = a + st; ; i += st) { path.push(pts[i]); if (i === b) break; } }
    }
    moving = false;
    if (path.length) { const [tx, tz] = path[0], dx = tx - lead.x, dz = tz - lead.z, dd = Math.hypot(dx, dz), st = Math.min(dd, dt * 12); if (dd < .05) path.shift(); else { lead.x += dx / dd * st; lead.z += dz / dd * st; hd = Math.atan2(dx, dz); moving = true; } }
    const tl = trail[0]; if (!tl || Math.hypot(lead.x - tl[0], lead.z - tl[1]) > .5) { trail.unshift([lead.x, lead.z]); trail.length = Math.min(trail.length, 60); }
    // 镜头
    if (s.mode !== lastMode) { lastMode = s.mode; [tgt.pit, tgt.dist] = PRE[s.mode] || PRE.over; snap = 1.5; sY = s.mode === 'over' ? Math.PI : null; }
    const k = 1 - Math.exp(-dt * 4); cam.pit += (tgt.pit - cam.pit) * k; cam.dist += (tgt.dist - cam.dist) * k;
    if (!dr && (snap > 0 || (moving && s.mode !== 'over'))) { snap -= dt; const ty = snap > 0 && sY !== null ? sY : hd; cam.yaw += (((ty - cam.yaw + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI) * Math.min(1, dt * 3); }
    const lh = H(lead.x, lead.z), T = [lead.x, lh + 1.6, lead.z], cp = Math.cos(cam.pit), f = [Math.sin(cam.yaw) * cp, Math.sin(cam.pit), Math.cos(cam.yaw) * cp];
    const e = [T[0] - f[0] * cam.dist, T[1] - f[1] * cam.dist, T[2] - f[2] * cam.dist]; e[1] = Math.max(e[1], H(e[0], e[2]) + 1.2);
    VP = mul(pers(1 + .2 * Math.max(0, 1 - cam.dist / 8), w / h, .3, 420), look(e, [e[0] + f[0], e[1] + f[1], e[2] + f[2]]));
    // 天色
    const sky = SKY[s.dayNight] || SKY.day, wx = WX[s.weather] || WX.clear, s3 = sky.slice(0, 3), fg = wx[1] ? mix(s3, wx[1].map((v) => v * sky[3]), .55) : s3;
    gl.clearColor(fg[0], fg[1], fg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(uVP, false, VP); gl.uniform3f(uFg, fg[0], fg[1], fg[2]); gl.uniform1f(uFd, wx[0]); gl.uniform1f(uLt, sky[3]);
    bind(bS); gl.uniformMatrix4fv(uM, false, I); gl.uniform3f(uTn, 1, 1, 1); gl.drawArrays(gl.TRIANGLES, 0, nS);
    bind(bU);
    // 地标
    const lab = [];
    nodes.forEach((n, i) => {
      const [x, z] = pts[i], g = H(x, z), ty = TYC[n.type] || TYC.shrine, trb = (s.tribulations || []).find((q) => q.locationId === n.id), act = trb && !trb.completed;
      let top;
      if (cam.dist < 3 && n.id === s.playerNodeId) top = g + 3;
      else if (n.type === 'mountain') { obj(u2, x, g - .3, z, 7, 8, 7, 0, ty[0]); obj(u2, x, g + 5.2, z, 2.8, 2.8, 2.8, 0, ty[1]); top = g + 8.5; }
      else { obj(u1, x, g, z, ty[2], ty[2] * .8, ty[2], .4, ty[0]); if (ty[3]) obj(u2, x, g + ty[2] * .8, z, ty[2] * 1.7, ty[3], ty[2] * 1.7, .4, ty[1]); top = g + ty[2] * .8 + ty[3]; }
      if (act) obj(u2, x, top + 1 + Math.sin(t * 3 + i) * .35, z, 1.5, 2.8, 1.5, 0, [1, .32, .22]); else if (trb) obj(u2, x, top + .5, z, 1, 1.5, 1, 0, [.37, .82, .54]);
      if (n.id === s.playerNodeId && cam.dist >= 3) obj(u1, x, g, z, .5, 22, .5, 0, [1, .82, .35]);
      if (n.id === s.selectedId) { const q = 1 + .08 * Math.sin(t * 4); obj(u1, x, g + .08, z, 7 * q, .2, 7 * q, t * .8, [1, .95, .7]); obj(u1, x, g + .08, z, 7 * q, .2, 7 * q, t * .8 + .785, [1, .95, .7]); }
      lab.push([n, x, g, z, top]);
    });
    if (Math.hypot(lead.x - LS[0], lead.z - LS[1]) < 90) obj(u1, lsx, lsy + 28, lsz, 1.4, 90, 1.4, 0, [1, .85, .4]); // 临近灵山，佛光显现
    // 取经队伍
    const party = s.activeParty && s.activeParty.length ? s.activeParty : ['tang_sanzang'];
    party.forEach((id, k2) => {
      if (k2 === 0 && cam.dist < 3) return;
      const q = k2 === 0 ? [lead.x, lead.z] : (trail[k2 * 6] || trail[trail.length - 1]), y = H(q[0], q[1]) + (moving ? Math.abs(Math.sin(t * 9 + k2)) * .18 : 0), col = CH[id] || CH.tang_sanzang;
      if (id === 'bai_long_ma') { obj(u1, q[0], y + .3, q[1], .8, .9, 1.6, hd, col); obj(u1, q[0] + Math.sin(hd) * .9, y + .9, q[1] + Math.cos(hd) * .9, .5, .7, .5, hd, col); }
      else { const sw = id === 'zhu_bajie' ? 1.25 : 1, sh2 = id === 'sun_wukong' ? .9 : 1; obj(u1, q[0], y, q[1], .8 * sw, 1.3 * sh2, .55 * sw, hd, col); obj(u1, q[0], y + 1.3 * sh2, q[1], .55, .55, .55, hd, SKIN); if (id === 'tang_sanzang') obj(u2, q[0], y + 1.85, q[1], .8, .5, .8, 0, [.9, .7, .2]); }
    });
    // 地标名称（2D 叠层）与点选命中点
    cx.clearRect(0, 0, w, h); cx.textAlign = 'center'; cx.font = `bold ${13 * dpr}px "Noto Serif SC",serif`; cx.lineWidth = 4 * dpr; cx.lineJoin = 'round'; hits = [];
    lab.forEach(([n, x, g, z, top]) => {
      const hp = proj(x, g + 3, z); if (hp) hits.push({ n, x: hp[0] * w / dpr, y: (1 - hp[1]) * h / dpr });
      const p = proj(x, top + 2.2, z), key = n.id === s.playerNodeId || n.id === s.selectedId; if (!p || (p[2] > 75 && !key)) return;
      const tx = p[0] * w, ty2 = (1 - p[1]) * h, txt = n.name.split(' · ')[0] + (n.id === s.playerNodeId ? ' ▼' : '');
      cx.strokeStyle = 'rgba(15,10,5,.85)'; cx.fillStyle = n.id === s.playerNodeId ? '#ffd25a' : n.id === s.selectedId ? '#ffffff' : '#f3e6c8';
      cx.strokeText(txt, tx, ty2); cx.fillText(txt, tx, ty2);
    });
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); cv.remove(); ov.remove(); const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); };
}

export const Scene3D = (props) => {
  const box = useRef(null), S = useRef({}), [mode, setMode] = useState('over');
  S.current = { ...props, mode };
  useEffect(() => { const stop = start3D(box.current, S); if (!stop && props.onFail) props.onFail(); return stop || undefined; }, []);
  const B = [['over', '俯瞰视角'], ['far', '远处视角'], ['fp', '第一视角']];
  return (
    <div className="absolute inset-0 z-10">
      <div ref={box} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
      <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
        <div className="flex gap-1 bg-stone-950/90 border border-stone-800 rounded-lg p-1">
          {B.map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${mode === k ? 'bg-amber-400 text-stone-950' : 'text-amber-100/80 hover:bg-stone-800'}`}>{l}</button>
          ))}
        </div>
        <div className="text-[11px] text-stone-300/80 bg-stone-950/70 px-2 py-1 rounded">拖动转向 · 滚轮缩放 · 点击地标选择</div>
      </div>
    </div>
  );
};
