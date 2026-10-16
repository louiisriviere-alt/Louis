import fs from 'fs';
// Sources (à télécharger dans outils/donnees/ avant de lancer) :
//  - communes.geojson et deps.geojson : github.com/gregoiredavid/france-geojson (versions simplifiées)
//  - rail.geojson : ne_10m_railroads.geojson de github.com/nvkelso/natural-earth-vector
//  - package/ : npm pack @etalab/decoupage-administratif@6.0.0
// Usage : node outils/construire.mjs [dossier-données]
import path from 'path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const D = (process.argv[2] || path.join(HERE, 'donnees')) + '/';
const rd = f => JSON.parse(fs.readFileSync(D + f));

// ---------- Communes ----------
const meta = new Map(rd('package/data/communes.json').filter(c => c.type === 'commune-actuelle').map(c => [c.code, c]));
const depNames = new Map(rd('package/data/departements.json').map(d => [d.code, d.nom]));
function ringCentroid(r) {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a += f; x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f;
  }
  return a ? { a: Math.abs(a / 2), x: x / (3 * a), y: y / (3 * a) } : { a: 0, x: r[0][0], y: r[0][1] };
}
const communes = [];
let missing = 0;
for (const f of rd('communes.geojson').features) {
  const { code, nom } = f.properties;
  if (!f.geometry) { missing++; continue; }
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const best = polys.map(p => ringCentroid(p[0])).sort((a, b) => b.a - a.a)[0];
  const m = meta.get(code);
  if (!m) { missing++; continue; }
  communes.push([code, m.nom || nom, m.departement, +best.y.toFixed(4), +best.x.toFixed(4), m.population || 0]);
}
communes.sort((a, b) => b[5] - a[5]);
console.log('communes', communes.length, 'sans méta', missing, communes.slice(0, 3));
const communesTxt = communes.map(c => c.join('|')).join('\n');

// ---------- Départements ----------
const deps = rd('deps.geojson');
const r3 = n => Math.round(n * 1000) / 1000;
for (const f of deps.features) {
  const simp = ring => { const o = []; for (const [x, y] of ring) { const p = [r3(x), r3(y)]; const l = o[o.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) o.push(p); } return o; };
  const g = f.geometry;
  g.coordinates = g.type === 'Polygon' ? g.coordinates.map(simp) : g.coordinates.map(p => p.map(simp));
  f.properties = { code: f.properties.code, nom: f.properties.nom };
}

// ---------- Réseau ferré ----------
const inFr = ([x, y]) => x > -5.3 && x < 9.7 && y > 41.3 && y < 51.15;
let lines = [];
for (const f of rd('rail.geojson').features) {
  const ls = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const l of ls) if (l.filter(inFr).length >= l.length / 2) lines.push(l);
}
const key = ([x, y]) => `${Math.round(y * 1e4)},${Math.round(x * 1e4)}`;
const nodeIdx = new Map(), nodes = [];
const id = p => { const k = key(p); if (!nodeIdx.has(k)) { nodeIdx.set(k, nodes.length); nodes.push([Math.round(p[1] * 1e4), Math.round(p[0] * 1e4)]); } return nodeIdx.get(k); };
lines = lines.map(l => l.map(id)).map(l => l.filter((n, i) => i === 0 || n !== l[i - 1])).filter(l => l.length > 1);
// degré de chaque nœud
const deg = new Uint16Array(nodes.length);
for (const l of lines) l.forEach((n, i) => { deg[n] += (i === 0 || i === l.length - 1) ? 1 : 2; });
// raccorder les extrémités libres au nœud le plus proche (trous dans les données)
const grid = new Map(), cell = n => `${Math.floor(nodes[n][0] / 200)},${Math.floor(nodes[n][1] / 200)}`;
lines.forEach((l, li) => l.forEach(n => { const c = cell(n); if (!grid.has(c)) grid.set(c, []); grid.get(c).push([n, li]); }));
let links = 0;
lines.forEach((l, li) => {
  for (const end of [l[0], l[l.length - 1]]) {
    if (deg[end] !== 1) continue;
    const [cy, cx] = cell(end).split(',').map(Number);
    let best = null, bd = 150 ** 2; // ~1,5 km
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const [n, lj] of grid.get(`${cy + dy},${cx + dx}`) || []) {
      if (lj === li || n === end) continue;
      const d = (nodes[n][0] - nodes[end][0]) ** 2 + ((nodes[n][1] - nodes[end][1]) * 0.7) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    if (best !== null) { lines.push([end, best]); deg[end]++; deg[best]++; links++; }
  }
});
// simplification Douglas-Peucker en gardant les jonctions
const keep = n => deg[n] !== 2;
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [nodes[pts[0]], nodes[pts[pts.length - 1]]];
  let md = 0, mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = nodes[pts[i]];
    const dx = b[1] - a[1], dy = b[0] - a[0];
    const t = Math.max(0, Math.min(1, ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(p[1] - a[1] - t * dx, p[0] - a[0] - t * dy);
    if (d > md) { md = d; mi = i; }
  }
  return md > tol ? [...dp(pts.slice(0, mi + 1), tol).slice(0, -1), ...dp(pts.slice(mi), tol)] : [pts[0], pts[pts.length - 1]];
}
let out = [];
for (const l of lines) {
  let start = 0;
  for (let i = 1; i < l.length; i++) if (keep(l[i]) || i === l.length - 1) { out.push(dp(l.slice(start, i + 1), 12)); start = i; }
}
// renuméroter les nœuds utilisés
const used = new Map(), nn = [];
out = out.map(l => l.map(n => { if (!used.has(n)) { used.set(n, nn.length); nn.push(nodes[n]); } return used.get(n); }));
// fusionner les morceaux qui se suivent pour un JSON plus court
console.log('rail: lignes', out.length, 'nœuds', nn.length, 'raccords', links);
const rail = { n: nn.flat(), l: out };

const data = `window.COMMUNES=${JSON.stringify(communesTxt)};\nwindow.DEPS=${JSON.stringify(deps)};\nwindow.DEP_NOMS=${JSON.stringify(Object.fromEntries(depNames))};\nwindow.RAIL=${JSON.stringify(rail)};\n`;
// ---------- Assemblage ----------
const leafletCss = fs.readFileSync(path.join(HERE, '../node_modules/leaflet/dist/leaflet.css'), 'utf8').replace(/url\(images\/[^)]*\)/g, 'none');
const page = fs.readFileSync(path.join(HERE, 'page.html'), 'utf8')
  .replace('/*LEAFLET_CSS*/', () => leafletCss)
  .replace('/*RAIL_JS*/', () => fs.readFileSync(path.join(HERE, 'rail.js'), 'utf8'))
  .replace('<!--DATA-->', () => '<script>' + data + '</script>');
// Version publiée en artifact (le squelette HTML est ajouté à la publication)
fs.writeFileSync(path.join(HERE, '../dist/artifact.html'), page);
// Version autonome à ouvrir directement dans un navigateur
fs.writeFileSync(path.join(HERE, '../index.html'), '<!doctype html>\n<html lang="fr">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head>\n<body>\n' + page + '\n</body>\n</html>\n');
console.log('tailles ko: communes', (communesTxt.length / 1024) | 0, 'deps', (JSON.stringify(deps).length / 1024) | 0, 'rail', (JSON.stringify(rail).length / 1024) | 0);
