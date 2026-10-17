/**
 * Generador de Gráficos SVG Nativos y Reactivos (Offline-First, 0 dependencias).
 * Diseñado específicamente para móviles y uso en campo con Material Design 3.
 */

const NOMBRES_MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/**
 * Renderiza un gráfico SVG de barras comparativas mensuales (Ingresos Carne vs Gastos Pienso).
 *
 * @param {Array} datosMeses Array de objetos { mes: 'YYYY-MM', ingresos_carne, gasto_pienso, cabezas, kg_pienso, margen_mes }
 * @param {Object} opts Opciones de visualización (ancho, alto, etc.)
 * @returns {string} Fragmento HTML con SVG responsivo
 */
export function renderGraficoBarrasComparativas(datosMeses, opts = {}) {
  if (!datosMeses || datosMeses.length === 0) {
    return `
      <div class="chart-empty-notice" style="padding: 24px; text-align: center; color: var(--text-dim, #777); font-size: 0.9rem;">
        No hay transacciones comerciales registradas en el periodo seleccionado.
      </div>
    `;
  }

  const ancho = opts.ancho || 640;
  const alto = opts.alto || 230;
  const margen = { top: 30, right: 20, bottom: 40, left: 55 };
  const anchoPlot = ancho - margen.left - margen.right;
  const altoPlot = alto - margen.top - margen.bottom;

  // Encontrar el valor máximo para la escala Y
  const maxVal = Math.max(
    ...datosMeses.map(d => Math.max(d.ingresos_carne || 0, d.gasto_pienso || 0)),
    1000
  ) * 1.15;

  const barGroupWidth = anchoPlot / Math.max(1, datosMeses.length);
  const barWidth = Math.max(5, Math.min(18, (barGroupWidth - 8) / 2));

  let gridLines = "";
  // 4 líneas de referencia horizontales
  for (let i = 0; i <= 4; i++) {
    const yVal = (maxVal / 4) * i;
    const yPos = margen.top + altoPlot - (yVal / maxVal) * altoPlot;
    const etiqueta = yVal >= 1000 ? `${(yVal / 1000).toFixed(0)}k€` : `${yVal.toFixed(0)}€`;
    gridLines += `
      <line x1="${margen.left}" y1="${yPos.toFixed(1)}" x2="${ancho - margen.right}" y2="${yPos.toFixed(1)}" stroke="var(--md-outline-variant, #e5e7eb)" stroke-dasharray="3,3" stroke-width="1"/>
      <text x="${margen.left - 8}" y="${(yPos + 4).toFixed(1)}" font-size="10" font-family="system-ui, sans-serif" fill="var(--text-muted, #6b7280)" text-anchor="end">${etiqueta}</text>
    `;
  }

  let barsHtml = "";
  let labelsX = "";

  datosMeses.forEach((d, idx) => {
    const xCentro = margen.left + idx * barGroupWidth + (barGroupWidth / 2);

    const hIng = Math.max(0, ((d.ingresos_carne || 0) / maxVal) * altoPlot);
    const yIng = margen.top + altoPlot - hIng;

    const hGas = Math.max(0, ((d.gasto_pienso || 0) / maxVal) * altoPlot);
    const yGas = margen.top + altoPlot - hGas;

    const xIng = xCentro - barWidth - 1;
    const xGas = xCentro + 1;

    // Etiqueta del mes
    const partes = (d.mes || "").split("-");
    const mesNum = parseInt(partes[1], 10);
    const nombreMes = (mesNum >= 1 && mesNum <= 12) ? NOMBRES_MESES[mesNum - 1] : (partes[1] || d.mes);

    const ingFmt = Number(d.ingresos_carne || 0).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const gasFmt = Number(d.gasto_pienso || 0).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const marFmt = Number(d.margen_mes || 0).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    barsHtml += `
      <!-- Barra Ingreso Carne -->
      <rect class="chart-bar bar-carne chart-bar-carne" x="${xIng.toFixed(1)}" y="${yIng.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${hIng.toFixed(1)}" rx="3" fill="var(--chart-carne, #15803d)" style="cursor: pointer; transition: opacity 0.15s ease;">
        <title>${d.mes} | Venta Carne: ${ingFmt} € (${d.cabezas || 0} cabezas)\nMargen neto mes: ${marFmt} €</title>
      </rect>
      <!-- Barra Gasto Pienso -->
      <rect class="chart-bar bar-pienso chart-bar-pienso" x="${xGas.toFixed(1)}" y="${yGas.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${hGas.toFixed(1)}" rx="3" fill="var(--chart-pienso, #ea580c)" style="cursor: pointer; transition: opacity 0.15s ease;">
        <title>${d.mes} | Compra Pienso: ${gasFmt} € (${Number(d.kg_pienso || 0).toLocaleString('es-ES')} kg)\nMargen neto mes: ${marFmt} €</title>
      </rect>
    `;

    labelsX += `
      <text x="${xCentro.toFixed(1)}" y="${(alto - 14).toFixed(1)}" font-size="11" font-weight="600" font-family="system-ui, sans-serif" fill="var(--text-main, #374151)" text-anchor="middle">${nombreMes}</text>
    `;
  });

  return `
    <div class="chart-container-card" style="background: var(--md-surface-container-low, #ffffff); border: 1px solid var(--md-outline-variant, #e5e7eb); border-radius: var(--md-shape-lg, 16px); padding: 16px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
        <div style="font-weight: 800; font-size: 0.98rem; color: var(--brand-primary, #1e3a2b);">
          Balance Mensual: Ventas de Carne vs Compras de Pienso
        </div>
        <div style="display: flex; align-items: center; gap: 14px; font-size: 0.8rem; font-weight: 700;">
          <span style="display: inline-flex; align-items: center; gap: 6px; color: var(--chart-carne, #15803d);">
            <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: var(--chart-carne, #15803d);"></span>
            Venta Carne (€)
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px; color: var(--chart-pienso, #ea580c);">
            <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: var(--chart-pienso, #ea580c);"></span>
            Compra Pienso (€)
          </span>
        </div>
      </div>

      <div class="chart-scroll-box" style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;">
        <svg viewBox="0 0 ${ancho} ${alto}" style="width: 100%; min-width: 440px; height: auto; display: block;" preserveAspectRatio="xMidYMid meet">
          <g class="chart-grid">${gridLines}</g>
          <g class="chart-bars-group">${barsHtml}</g>
          <g class="chart-labels-x">${labelsX}</g>
        </svg>
      </div>
      <div style="font-size: 0.76rem; color: var(--text-dim, #777); margin-top: 6px; text-align: right;">
        Toca o posa el dedo sobre cualquier barra para ver el desglose en € y cabezas.
      </div>
    </div>
  `;
}

/**
 * Renderiza un gráfico SVG de tendencia de cotización media (€/kg canal) por mes.
 *
 * @param {Array} datosMeses Array de meses con precio_canal_medio
 * @returns {string} Fragmento HTML con SVG de línea suave
 */
export function renderGraficoCotizacionCanal(datosMeses, opts = {}) {
  const mesesValidos = (datosMeses || [])
    .map(d => ({ ...d, valor: d.precio_canal_medio != null ? d.precio_canal_medio : d.precio_medio_kg }))
    .filter(d => d.valor != null && d.valor > 0);
  if (mesesValidos.length < 2) return "";

  const ancho = opts.ancho || 640;
  const alto = opts.alto || 160;
  const margen = { top: 20, right: 25, bottom: 35, left: 45 };
  const anchoPlot = ancho - margen.left - margen.right;
  const altoPlot = alto - margen.top - margen.bottom;

  const minP = Math.min(...mesesValidos.map(d => d.valor)) * 0.95;
  const maxP = Math.max(...mesesValidos.map(d => d.valor)) * 1.05;
  const rangoP = Math.max(0.5, maxP - minP);

  const stepX = anchoPlot / Math.max(1, mesesValidos.length - 1);
  const puntos = mesesValidos.map((d, i) => {
    const x = margen.left + i * stepX;
    const y = margen.top + altoPlot - ((d.valor - minP) / rangoP) * altoPlot;
    return { x, y, valor: d.valor, mes: d.mes };
  });

  const pathD = puntos.reduce((acc, pt, i) => {
    return i === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }, "");

  // Área bajo la curva
  const areaD = `${pathD} L ${puntos[puntos.length - 1].x.toFixed(1)} ${(margen.top + altoPlot).toFixed(1)} L ${puntos[0].x.toFixed(1)} ${(margen.top + altoPlot).toFixed(1)} Z`;

  let dotsHtml = "";
  let labelsX = "";

  puntos.forEach(pt => {
    const partes = pt.mes.split("-");
    const mesNum = parseInt(partes[1], 10);
    const nombreMes = (mesNum >= 1 && mesNum <= 12) ? NOMBRES_MESES[mesNum - 1] : partes[1];

    dotsHtml += `
      <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.5" fill="#ffffff" stroke="var(--brand-primary, #1e3a2b)" stroke-width="2.5">
        <title>${pt.mes}: ${pt.valor.toFixed(2)} €/kg canal</title>
      </circle>
      <text x="${pt.x.toFixed(1)}" y="${(pt.y - 8).toFixed(1)}" font-size="10" font-weight="700" fill="var(--brand-primary, #1e3a2b)" text-anchor="middle">${pt.valor.toFixed(2)}€</text>
    `;

    labelsX += `
      <text x="${pt.x.toFixed(1)}" y="${(alto - 10).toFixed(1)}" font-size="10" font-weight="600" fill="var(--text-muted, #757575)" text-anchor="middle">${nombreMes}</text>
    `;
  });

  return `
    <div class="chart-container-card" style="background: var(--md-surface-container-low, #ffffff); border: 1px solid var(--md-outline-variant, #e5e7eb); border-radius: var(--md-shape-lg, 16px); padding: 14px 16px; margin-bottom: 20px;">
      <div style="font-weight: 800; font-size: 0.94rem; color: var(--brand-primary, #1e3a2b); margin-bottom: 10px;">
        📈 Evolución de Cotización Media (€/kg Canal)
      </div>
      <div class="chart-scroll-box" style="width: 100%; overflow-x: auto;">
        <svg viewBox="0 0 ${ancho} ${alto}" style="width: 100%; min-width: 440px; height: auto; display: block;" preserveAspectRatio="xMidYMid meet">
          <path d="${areaD}" fill="var(--brand-primary, #1e3a2b)" fill-opacity="0.08" />
          <path d="${pathD}" fill="none" stroke="var(--brand-primary, #1e3a2b)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          <g class="chart-dots">${dotsHtml}</g>
          <g class="chart-labels-x">${labelsX}</g>
        </svg>
      </div>
    </div>
  `;
}
