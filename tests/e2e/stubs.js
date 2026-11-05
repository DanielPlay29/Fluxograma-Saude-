// Substitutos das bibliotecas de CDN usados SOMENTE nos testes offline.
// Chart: desenha um esboço simples no canvas e registra a configuração recebida.
window.__graficos = [];
class Chart {
  static defaults = { font: {}, plugins: { legend: { labels: {} }, tooltip: {} }, animation: {}, color: "" };
  constructor(canvas, cfg) {
    this.cfg = cfg;
    window.__graficos.push({ tipo: cfg.type, rotulos: cfg.data.labels, series: cfg.data.datasets.map((d) => ({ label: d.label, data: d.data })) });
    const c = canvas.getContext("2d");
    const w = (canvas.width = canvas.parentElement.clientWidth || 400);
    const h = (canvas.height = canvas.parentElement.clientHeight || 260);
    const ds = cfg.data.datasets;
    const vals = ds.flatMap((d) => d.data).filter((v) => typeof v === "number");
    const max = Math.max(1, ...vals);
    c.fillStyle = "#e6ebe8"; c.fillRect(0, h - 20, w, 1);
    if (cfg.type === "doughnut") {
      let a = -Math.PI / 2; const tot = vals.reduce((s, v) => s + v, 0) || 1;
      ds[0].data.forEach((v, i) => { c.beginPath(); c.moveTo(w / 2, h / 2); c.fillStyle = [].concat(ds[0].backgroundColor)[i] ?? "#1b7a5c"; c.arc(w / 2, h / 2, h / 2.4, a, (a += (v / tot) * 2 * Math.PI)); c.fill(); });
      c.fillStyle = "#fff"; c.beginPath(); c.arc(w / 2, h / 2, h / 4, 0, 2 * Math.PI); c.fill();
      return;
    }
    const n = cfg.data.labels.length || 1;
    ds.forEach((d, k) => {
      const cor = [].concat(d.borderColor ?? d.backgroundColor ?? "#1b7a5c")[0];
      c.strokeStyle = c.fillStyle = cor;
      if ((d.type ?? cfg.type) === "bar") {
        d.data.forEach((v, i) => { const bh = ((v ?? 0) / max) * (h - 30); c.fillRect((i + 0.15 + k * 0.35) * (w / n), h - 20 - bh, (w / n) * 0.3, bh); });
      } else {
        c.beginPath(); c.lineWidth = 2;
        d.data.forEach((v, i) => { const x = (i + 0.5) * (w / n), y = h - 20 - ((v ?? 0) / max) * (h - 30); i ? c.lineTo(x, y) : c.moveTo(x, y); });
        c.stroke();
      }
    });
  }
  destroy() {}
}
window.Chart = Chart;
