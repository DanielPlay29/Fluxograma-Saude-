// Gráficos interativos (Chart.js, carregado em app.html)
const instancias = new Set();

export const CORES = {
  UBS: "#1b7a5c",
  UPA: "#3a7fc1",
  HOSPITAL: "#8a6fc9",
  EMERGENCIA: "#c93a3a",
  positivo: "#2fb67a",
  primaria: "#0f4a3a",
  azul: "#3a7fc1",
  neutro: "#a8b5af",
  grade: "#e6ebe8",
};

let configurado = false;
function prepararPadroes() {
  if (configurado || !window.Chart) return;
  const C = window.Chart;
  C.defaults.font.family = '"Manrope", system-ui, sans-serif';
  C.defaults.font.size = 12;
  C.defaults.color = "#4b5b54";
  C.defaults.plugins.legend.labels.boxWidth = 10;
  C.defaults.plugins.legend.labels.boxHeight = 10;
  C.defaults.plugins.legend.labels.usePointStyle = true;
  C.defaults.plugins.tooltip.backgroundColor = "#0b3b2e";
  C.defaults.plugins.tooltip.padding = 10;
  C.defaults.plugins.tooltip.cornerRadius = 8;
  C.defaults.animation.duration = 450;
  C.defaults.maintainAspectRatio = false;
  configurado = true;
}

/** Cria um gráfico num <canvas>. Retorna null se a biblioteca não carregou. */
export function grafico(canvas, config) {
  if (!window.Chart || !canvas) {
    if (canvas) canvas.replaceWith(Object.assign(document.createElement("p"), { className: "vazio", textContent: "Biblioteca de gráficos indisponível (verifique a internet)." }));
    return null;
  }
  prepararPadroes();
  const g = new window.Chart(canvas, config);
  instancias.add(g);
  return g;
}

export function destruirGraficos() {
  for (const g of instancias) g.destroy();
  instancias.clear();
}

export const eixos = (formatoY) => ({
  x: { grid: { display: false }, border: { display: false } },
  y: {
    beginAtZero: true,
    grid: { color: CORES.grade },
    border: { display: false },
    ticks: { precision: 0, ...(formatoY ? { callback: formatoY } : {}) },
  },
});
