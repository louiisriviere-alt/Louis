// Graphe ferroviaire + plus court chemin (Dijkstra)
function buildRail(R) {
  const N = R.n.length / 2;
  const lat = new Float64Array(N), lon = new Float64Array(N);
  for (let i = 0; i < N; i++) { lat[i] = R.n[2 * i] / 1e4; lon[i] = R.n[2 * i + 1] / 1e4; }
  const adj = Array.from({ length: N }, () => []);
  const km = (a, b) => {
    const r = Math.PI / 180, dLat = (lat[b] - lat[a]) * r, dLon = (lon[b] - lon[a]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat[a] * r) * Math.cos(lat[b] * r) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  for (const l of R.l) for (let i = 1; i < l.length; i++) {
    const d = km(l[i - 1], l[i]);
    adj[l[i - 1]].push(l[i], d); adj[l[i]].push(l[i - 1], d);
  }
  function nearest(la, lo) {
    let best = -1, bd = Infinity;
    const c = Math.cos(la * Math.PI / 180);
    for (let i = 0; i < N; i++) {
      if (!adj[i].length) continue;
      const d = (lat[i] - la) ** 2 + ((lon[i] - lo) * c) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return { node: best, km: Math.sqrt(bd) * 111.2 };
  }
  function route(a, b) {
    const s = nearest(a.lat, a.lon), t = nearest(b.lat, b.lon);
    if (s.km > 25 || t.km > 25) return null;
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const heap = [[0, s.node]]; dist[s.node] = 0;
    const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, u] = pop();
      if (u === t.node) break;
      if (d > dist[u]) continue;
      const e = adj[u];
      for (let k = 0; k < e.length; k += 2) { const v = e[k], nd = d + e[k + 1]; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); } }
    }
    if (dist[t.node] === Infinity) return null;
    const coords = [[b.lat, b.lon]];
    for (let u = t.node; u !== -1; u = prev[u]) coords.push([lat[u], lon[u]]);
    coords.push([a.lat, a.lon]);
    coords.reverse();
    return { coords, km: Math.round(dist[t.node] + s.km + t.km) };
  }
  return { route };
}
