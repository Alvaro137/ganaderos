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

/**
 * Renderiza el gráfico de Radar de Materias Primas: Cereales en Lonja (Cebada / Maíz)
 * vs Precio Real del Pienso Compuesto (€/t) para análisis de compras.
 *
 * @param {Array} datosMeses Array con { mes, cebada_lonja_t, maiz_lonja_t, pienso_real_t }
 * @param {Object} opts Opciones de dimensiones
 * @returns {string} Fragmento HTML con SVG responsivo
 */
export function renderGraficoRadarMateriasPrimas(datosMeses, opts = {}) {
  if (!datosMeses || datosMeses.length === 0) {
    return `
      <div class="chart-empty-notice" style="padding: 24px; text-align: center; color: var(--text-dim, #777); font-size: 0.9rem;">
        No hay datos de cotizaciones o compras en el periodo seleccionado.
      </div>
    `;
  }

  const ancho = opts.ancho || 640;
  const alto = opts.alto || 220;
  const margen = { top: 30, right: 30, bottom: 40, left: 55 };
  const anchoPlot = ancho - margen.left - margen.right;
  const altoPlot = alto - margen.top - margen.bottom;

  const valoresTodos = [];
  datosMeses.forEach(d => {
    if (d.cebada_lonja_t) valoresTodos.push(d.cebada_lonja_t);
    if (d.maiz_lonja_t) valoresTodos.push(d.maiz_lonja_t);
    if (d.pienso_real_t) valoresTodos.push(d.pienso_real_t);
  });

  const minV = valoresTodos.length > 0 ? Math.floor(Math.min(...valoresTodos) * 0.95) : 180;
  const maxV = valoresTodos.length > 0 ? Math.ceil(Math.max(...valoresTodos) * 1.05) : 360;
  const rango = Math.max(20, maxV - minV);

  // Ejes y líneas de cuadrícula
  let gridLines = "";
  for (let i = 0; i <= 4; i++) {
    const yVal = minV + (rango / 4) * i;
    const yPos = margen.top + altoPlot - ((yVal - minV) / rango) * altoPlot;
    gridLines += `
      <line x1="${margen.left}" y1="${yPos.toFixed(1)}" x2="${ancho - margen.right}" y2="${yPos.toFixed(1)}" stroke="var(--md-outline-variant, #e5e7eb)" stroke-dasharray="3,3" stroke-width="1"/>
      <text x="${margen.left - 8}" y="${(yPos + 4).toFixed(1)}" font-size="10" font-family="system-ui, sans-serif" fill="var(--text-muted, #6b7280)" text-anchor="end">${yVal.toFixed(0)}€/t</text>
    `;
  }

  const stepX = anchoPlot / Math.max(1, datosMeses.length);

  let ptsCebada = [];
  let ptsMaiz = [];
  let barsPienso = "";
  let labelsX = "";

  datosMeses.forEach((d, idx) => {
    const xCentro = margen.left + idx * stepX + (stepX / 2);
    const partes = (d.mes || "").split("-");
    const mesNum = parseInt(partes[1], 10);
    const nombreMes = (mesNum >= 1 && mesNum <= 12) ? NOMBRES_MESES[mesNum - 1] : (partes[1] || d.mes);

    labelsX += `
      <text x="${xCentro.toFixed(1)}" y="${(alto - 14).toFixed(1)}" font-size="11" font-weight="600" font-family="system-ui, sans-serif" fill="var(--text-main, #374151)" text-anchor="middle">${nombreMes}</text>
    `;

    // 1. Barras de Pienso Real (€/t)
    if (d.pienso_real_t && d.pienso_real_t > 0) {
      const hP = Math.max(0, ((d.pienso_real_t - minV) / rango) * altoPlot);
      const yP = margen.top + altoPlot - hP;
      const bW = Math.max(8, Math.min(22, stepX * 0.45));
      barsPienso += `
        <rect x="${(xCentro - bW/2).toFixed(1)}" y="${yP.toFixed(1)}" width="${bW.toFixed(1)}" height="${hP.toFixed(1)}" rx="3" fill="#ea580c" fill-opacity="0.35" stroke="#ea580c" stroke-width="1.5">
          <title>${d.mes} | Pienso T-3 Comprado: ${d.pienso_real_t.toFixed(0)} €/t (${Number(d.kg_comprados || 0).toLocaleString('es-ES')} kg)</title>
        </rect>
        <text x="${xCentro.toFixed(1)}" y="${(yP - 6).toFixed(1)}" font-size="9" font-weight="700" fill="#c2410c" text-anchor="middle">${d.pienso_real_t.toFixed(0)}€</text>
      `;
    }

    // 2. Puntos Cebada
    if (d.cebada_lonja_t && d.cebada_lonja_t > 0) {
      const yC = margen.top + altoPlot - ((d.cebada_lonja_t - minV) / rango) * altoPlot;
      ptsCebada.push({ x: xCentro, y: yC, val: d.cebada_lonja_t, mes: d.mes });
    }

    // 3. Puntos Maíz
    if (d.maiz_lonja_t && d.maiz_lonja_t > 0) {
      const yM = margen.top + altoPlot - ((d.maiz_lonja_t - minV) / rango) * altoPlot;
      ptsMaiz.push({ x: xCentro, y: yM, val: d.maiz_lonja_t, mes: d.mes });
    }
  });

  const pathCebada = ptsCebada.reduce((acc, p, i) => i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");
  const pathMaiz = ptsMaiz.reduce((acc, p, i) => i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");

  let dotsHtml = "";
  ptsCebada.forEach(p => {
    dotsHtml += `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#d97706" stroke="#ffffff" stroke-width="1.5">
        <title>${p.mes} | Cebada Lonja Salamanca: ${p.val.toFixed(0)} €/t</title>
      </circle>
    `;
  });
  ptsMaiz.forEach(p => {
    dotsHtml += `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#2563eb" stroke="#ffffff" stroke-width="1.5">
        <title>${p.mes} | Maíz Lonja Salamanca: ${p.val.toFixed(0)} €/t</title>
      </circle>
    `;
  });

  return `
    <div class="chart-container-card" style="background: var(--md-surface-container-low, #ffffff); border: 1px solid var(--md-outline-variant, #e5e7eb); border-radius: var(--md-shape-lg, 16px); padding: 16px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
        <div style="font-weight: 800; font-size: 0.98rem; color: var(--brand-primary, #1e3a2b);">
          🌾 Radar de Materias Primas: Lonja Salamanca vs Pienso
        </div>
        <div style="display: flex; align-items: center; gap: 12px; font-size: 0.8rem; font-weight: 700; flex-wrap: wrap;">
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #d97706;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #d97706;"></span>
            Cebada Lonja (€/t)
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #2563eb;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #2563eb;"></span>
            Maíz Lonja (€/t)
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #ea580c;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: rgba(234, 88, 12, 0.4); border: 1px solid #ea580c;"></span>
            Pienso T-3 Comprado (€/t)
          </span>
        </div>
      </div>

      <div class="chart-scroll-box" style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;">
        <svg viewBox="0 0 ${ancho} ${alto}" style="width: 100%; min-width: 440px; height: auto; display: block;" preserveAspectRatio="xMidYMid meet">
          <g class="chart-grid">${gridLines}</g>
          <g class="chart-bars">${barsPienso}</g>
          ${pathCebada ? `<path d="${pathCebada}" fill="none" stroke="#d97706" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />` : ""}
          ${pathMaiz ? `<path d="${pathMaiz}" fill="none" stroke="#2563eb" stroke-width="2" stroke-dasharray="4,3" stroke-linecap="round" stroke-linejoin="round" />` : ""}
          <g class="chart-dots">${dotsHtml}</g>
          <g class="chart-labels-x">${labelsX}</g>
        </svg>
      </div>
      <div style="font-size: 0.76rem; color: var(--text-dim, #777); margin-top: 6px; text-align: right;">
        Herramienta de seguimiento: compara la tendencia de la lonja con las revisiones tarifarias de tu proveedor de pienso.
      </div>
    </div>
  `;
}

/**
 * Renderiza el gráfico de Evolución de Precios de Vacuno de Carne:
 * Cotización Lonja de Salamanca (Añojo Extra, Añojo Pesado, Ternera Extra, Vaca Desvieje)
 * vs Precio Medio Efectivo Cobrado en Matadero (€/kg Canal).
 *
 * @param {Array} datosMeses Array con datos mensuales de cotización y ventas
 * @param {Object} opts Opciones de dimensiones
 * @returns {string} Fragmento HTML con SVG responsivo
 */
export function renderGraficoLonjaCarne(datosMeses, opts = {}) {
  if (!datosMeses || datosMeses.length === 0) {
    return `
      <div class="chart-empty-notice" style="padding: 24px; text-align: center; color: var(--text-dim, #777); font-size: 0.9rem;">
        No hay datos de cotizaciones de carne en el periodo seleccionado.
      </div>
    `;
  }

  const ancho = opts.ancho || 640;
  const alto = opts.alto || 230;
  const margen = { top: 32, right: 30, bottom: 40, left: 55 };
  const anchoPlot = ancho - margen.left - margen.right;
  const altoPlot = alto - margen.top - margen.bottom;

  const valoresTodos = [];
  datosMeses.forEach(d => {
    if (d.anojo_extra_lonja) valoresTodos.push(d.anojo_extra_lonja);
    if (d.anojo_pesado_lonja) valoresTodos.push(d.anojo_pesado_lonja);
    if (d.ternera_extra_lonja) valoresTodos.push(d.ternera_extra_lonja);
    if (d.vaca_desvieje_lonja) valoresTodos.push(d.vaca_desvieje_lonja);
    if (d.precio_medio_granja) valoresTodos.push(d.precio_medio_granja);
  });

  const minV = valoresTodos.length > 0 ? Math.floor(Math.min(...valoresTodos) * 0.92 * 10) / 10 : 3.8;
  const maxV = valoresTodos.length > 0 ? Math.ceil(Math.max(...valoresTodos) * 1.05 * 10) / 10 : 8.0;
  const rango = Math.max(1.0, maxV - minV);

  // Ejes y líneas de cuadrícula
  let gridLines = "";
  for (let i = 0; i <= 4; i++) {
    const yVal = minV + (rango / 4) * i;
    const yPos = margen.top + altoPlot - ((yVal - minV) / rango) * altoPlot;
    gridLines += `
      <line x1="${margen.left}" y1="${yPos.toFixed(1)}" x2="${ancho - margen.right}" y2="${yPos.toFixed(1)}" stroke="var(--md-outline-variant, #e5e7eb)" stroke-dasharray="3,3" stroke-width="1"/>
      <text x="${margen.left - 8}" y="${(yPos + 4).toFixed(1)}" font-size="10" font-family="system-ui, sans-serif" fill="var(--text-muted, #6b7280)" text-anchor="end">${yVal.toFixed(2)}€</text>
    `;
  }

  const stepX = anchoPlot / Math.max(1, datosMeses.length);

  let ptsAnojo = [];
  let ptsAnojoPes = [];
  let ptsTernera = [];
  let ptsVaca = [];
  let barsGranja = "";
  let labelsX = "";

  datosMeses.forEach((d, idx) => {
    const xCentro = margen.left + idx * stepX + (stepX / 2);
    const partes = (d.mes || "").split("-");
    const mesNum = parseInt(partes[1], 10);
    const nombreMes = (mesNum >= 1 && mesNum <= 12) ? NOMBRES_MESES[mesNum - 1] : (partes[1] || d.mes);

    labelsX += `
      <text x="${xCentro.toFixed(1)}" y="${(alto - 14).toFixed(1)}" font-size="11" font-weight="600" font-family="system-ui, sans-serif" fill="var(--text-main, #374151)" text-anchor="middle">${nombreMes}</text>
    `;

    // 1. Barras o marcadores del Precio Cobrado por la Granja (€/kg)
    if (d.precio_medio_granja && d.precio_medio_granja > 0) {
      const hG = Math.max(0, ((d.precio_medio_granja - minV) / rango) * altoPlot);
      const yG = margen.top + altoPlot - hG;
      const bW = Math.max(10, Math.min(22, stepX * 0.4));
      barsGranja += `
        <rect x="${(xCentro - bW/2).toFixed(1)}" y="${yG.toFixed(1)}" width="${bW.toFixed(1)}" height="${hG.toFixed(1)}" rx="3" fill="#ea580c" fill-opacity="0.25" stroke="#ea580c" stroke-width="1.5">
          <title>${d.mes} | Precio Cobrado Granja: ${d.precio_medio_granja.toFixed(2)} €/kg (${d.canales_vendidas || 0} canales)</title>
        </rect>
        <text x="${xCentro.toFixed(1)}" y="${(yG - 6).toFixed(1)}" font-size="9" font-weight="800" fill="#c2410c" text-anchor="middle">${d.precio_medio_granja.toFixed(2)}€</text>
      `;
    }

    // 2. Puntos Añojo Extra
    if (d.anojo_extra_lonja && d.anojo_extra_lonja > 0) {
      const yA = margen.top + altoPlot - ((d.anojo_extra_lonja - minV) / rango) * altoPlot;
      ptsAnojo.push({ x: xCentro, y: yA, val: d.anojo_extra_lonja, mes: d.mes });
    }

    // 3. Puntos Añojo Pesado
    if (d.anojo_pesado_lonja && d.anojo_pesado_lonja > 0) {
      const yAP = margen.top + altoPlot - ((d.anojo_pesado_lonja - minV) / rango) * altoPlot;
      ptsAnojoPes.push({ x: xCentro, y: yAP, val: d.anojo_pesado_lonja, mes: d.mes });
    }

    // 4. Puntos Ternera Extra
    if (d.ternera_extra_lonja && d.ternera_extra_lonja > 0) {
      const yT = margen.top + altoPlot - ((d.ternera_extra_lonja - minV) / rango) * altoPlot;
      ptsTernera.push({ x: xCentro, y: yT, val: d.ternera_extra_lonja, mes: d.mes });
    }

    // 5. Puntos Vaca Desvieje
    if (d.vaca_desvieje_lonja && d.vaca_desvieje_lonja > 0) {
      const yV = margen.top + altoPlot - ((d.vaca_desvieje_lonja - minV) / rango) * altoPlot;
      ptsVaca.push({ x: xCentro, y: yV, val: d.vaca_desvieje_lonja, mes: d.mes });
    }
  });

  const pathAnojo = ptsAnojo.reduce((acc, p, i) => i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");
  const pathAnojoPes = ptsAnojoPes.reduce((acc, p, i) => i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");
  const pathTernera = ptsTernera.reduce((acc, p, i) => i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");
  const pathVaca = ptsVaca.reduce((acc, p, i) => i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");

  let dotsHtml = "";
  ptsAnojo.forEach(p => {
    dotsHtml += `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#15803d" stroke="#ffffff" stroke-width="1.5">
        <title>${p.mes} | Añojo Extra Lonja: ${p.val.toFixed(2)} €/kg</title>
      </circle>
    `;
  });
  ptsTernera.forEach(p => {
    dotsHtml += `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#7c3aed" stroke="#ffffff" stroke-width="1">
        <title>${p.mes} | Ternera Extra Lonja: ${p.val.toFixed(2)} €/kg</title>
      </circle>
    `;
  });

  return `
    <div class="chart-container-card" style="background: var(--md-surface-container-low, #ffffff); border: 1px solid var(--md-outline-variant, #e5e7eb); border-radius: var(--md-shape-lg, 16px); padding: 16px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
        <div style="font-weight: 800; font-size: 0.98rem; color: var(--brand-primary, #1e3a2b);">
          🥩 Cotización Vacuno de Carne (€/kg Canal): Lonja Salamanca vs Granja
        </div>
        <div style="display: flex; align-items: center; gap: 12px; font-size: 0.8rem; font-weight: 700; flex-wrap: wrap;">
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #15803d;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #15803d;"></span>
            Añojo Extra (&lt;350kg)
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #2563eb;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #2563eb;"></span>
            Añojo Pesado (&gt;350kg)
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #7c3aed;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #7c3aed;"></span>
            Ternera Extra
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #64748b;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #64748b;"></span>
            Vaca Desvieje
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #ea580c;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: rgba(234, 88, 12, 0.4); border: 1px solid #ea580c;"></span>
            Precio Cobrado Granja
          </span>
        </div>
      </div>

      <div class="chart-scroll-box" style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;">
        <svg viewBox="0 0 ${ancho} ${alto}" style="width: 100%; min-width: 440px; height: auto; display: block;" preserveAspectRatio="xMidYMid meet">
          <g class="chart-grid">${gridLines}</g>
          <g class="chart-bars">${barsGranja}</g>
          ${pathAnojo ? `<path d="${pathAnojo}" fill="none" stroke="#15803d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />` : ""}
          ${pathAnojoPes ? `<path d="${pathAnojoPes}" fill="none" stroke="#2563eb" stroke-width="2" stroke-dasharray="4,3" stroke-linecap="round" stroke-linejoin="round" />` : ""}
          ${pathTernera ? `<path d="${pathTernera}" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />` : ""}
          ${pathVaca ? `<path d="${pathVaca}" fill="none" stroke="#64748b" stroke-width="1.8" stroke-dasharray="3,3" stroke-linecap="round" stroke-linejoin="round" />` : ""}
          <g class="chart-dots">${dotsHtml}</g>
          <g class="chart-labels-x">${labelsX}</g>
        </svg>
      </div>
      <div style="font-size: 0.76rem; color: var(--text-dim, #777); margin-top: 6px; text-align: right;">
        Cotizaciones oficiales de los lunes en la Lonja de Salamanca (Diputación) contrastadas con liquidaciones de la explotación.
      </div>
    </div>
  `;
}

/**
 * Renderiza el gráfico SVG de Estacionalidad Histórica Anual de la Lonja de Salamanca (12 meses).
 * Muestra el ciclo estacional de precios (€/kg canal) para apoyar decisiones de timing de venta.
 */
export function renderGraficoEstacionalidadCarne(datosMeses, opts = {}) {
  if (!datosMeses || datosMeses.length === 0) {
    return `
      <div class="chart-empty-notice" style="padding: 24px; text-align: center; color: var(--text-dim, #777); font-size: 0.9rem;">
        No hay datos suficientes de estacionalidad histórica.
      </div>
    `;
  }

  const ancho = opts.ancho || 640;
  const alto = opts.alto || 230;
  const margen = { top: 32, right: 30, bottom: 40, left: 55 };
  const anchoPlot = ancho - margen.left - margen.right;
  const altoPlot = alto - margen.top - margen.bottom;

  const valoresTodos = [];
  datosMeses.forEach(d => {
    if (d.anojo_extra) valoresTodos.push(d.anojo_extra);
    if (d.anojo_pesado) valoresTodos.push(d.anojo_pesado);
    if (d.ternera_extra) valoresTodos.push(d.ternera_extra);
  });

  const minV = valoresTodos.length > 0 ? Math.floor(Math.min(...valoresTodos) * 0.94 * 10) / 10 : 5.0;
  const maxV = valoresTodos.length > 0 ? Math.ceil(Math.max(...valoresTodos) * 1.05 * 10) / 10 : 8.0;
  const rango = Math.max(1.0, maxV - minV);

  let gridLines = "";
  for (let i = 0; i <= 4; i++) {
    const yVal = minV + (rango / 4) * i;
    const yPos = margen.top + altoPlot - ((yVal - minV) / rango) * altoPlot;
    gridLines += `
      <line x1="${margen.left}" y1="${yPos.toFixed(1)}" x2="${ancho - margen.right}" y2="${yPos.toFixed(1)}" stroke="var(--md-outline-variant, #e5e7eb)" stroke-dasharray="3,3" stroke-width="1"/>
      <text x="${margen.left - 8}" y="${(yPos + 4).toFixed(1)}" font-size="10" font-family="system-ui, sans-serif" fill="var(--text-muted, #6b7280)" text-anchor="end">${yVal.toFixed(2)}€</text>
    `;
  }

  const stepX = anchoPlot / Math.max(1, datosMeses.length);

  let ptsAnojo = [];
  let ptsAnojoPes = [];
  let ptsTernera = [];
  let labelsX = "";
  let shadePeak = "";

  datosMeses.forEach((d, idx) => {
    const xCentro = margen.left + idx * stepX + (stepX / 2);
    labelsX += `
      <text x="${xCentro.toFixed(1)}" y="${(alto - 14).toFixed(1)}" font-size="11" font-weight="600" font-family="system-ui, sans-serif" fill="var(--text-main, #374151)" text-anchor="middle">${d.nombre_mes || d.mes_num}</text>
    `;

    // Sombra para meses pico típicos (Nov-Ene: 11, 12, 01)
    const mNum = parseInt(d.mes_num, 10);
    if (mNum === 11 || mNum === 12 || mNum === 1) {
      shadePeak += `
        <rect x="${(xCentro - stepX/2).toFixed(1)}" y="${margen.top}" width="${stepX.toFixed(1)}" height="${altoPlot}" fill="#15803d" fill-opacity="0.06">
          <title>${d.nombre_mes}: Periodo histórico de alta demanda</title>
        </rect>
      `;
    }

    if (d.anojo_extra && d.anojo_extra > 0) {
      const yA = margen.top + altoPlot - ((d.anojo_extra - minV) / rango) * altoPlot;
      ptsAnojo.push({ x: xCentro, y: yA, val: d.anojo_extra, mes: d.nombre_mes });
    }
    if (d.anojo_pesado && d.anojo_pesado > 0) {
      const yAP = margen.top + altoPlot - ((d.anojo_pesado - minV) / rango) * altoPlot;
      ptsAnojoPes.push({ x: xCentro, y: yAP, val: d.anojo_pesado, mes: d.nombre_mes });
    }
    if (d.ternera_extra && d.ternera_extra > 0) {
      const yT = margen.top + altoPlot - ((d.ternera_extra - minV) / rango) * altoPlot;
      ptsTernera.push({ x: xCentro, y: yT, val: d.ternera_extra, mes: d.nombre_mes });
    }
  });

  const pathAnojo = ptsAnojo.reduce((acc, p, i) => i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");
  const pathAnojoPes = ptsAnojoPes.reduce((acc, p, i) => i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");
  const pathTernera = ptsTernera.reduce((acc, p, i) => i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");

  let dotsHtml = "";
  ptsAnojo.forEach(p => {
    dotsHtml += `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#15803d" stroke="#ffffff" stroke-width="1.5">
        <title>${p.mes} | Añojo Extra: ${p.val.toFixed(2)} €/kg</title>
      </circle>
    `;
  });

  return `
    <div class="chart-container-card" style="background: var(--md-surface-container-low, #ffffff); border: 1px solid var(--md-outline-variant, #e5e7eb); border-radius: var(--md-shape-lg, 16px); padding: 16px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
        <div style="font-weight: 800; font-size: 0.98rem; color: var(--brand-primary, #1e3a2b);">
          🧭 Estacionalidad Anual del Vacuno (€/kg Canal): Patrón Enero a Diciembre
        </div>
        <div style="display: flex; align-items: center; gap: 12px; font-size: 0.8rem; font-weight: 700; flex-wrap: wrap;">
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #15803d;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #15803d;"></span>
            Añojo Extra (&lt;350kg)
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #2563eb;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #2563eb;"></span>
            Añojo Pesado (&gt;350kg)
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #7c3aed;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #7c3aed;"></span>
            Ternera Extra
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px; color: #15803d;">
            <span style="display: inline-block; width: 12px; height: 10px; background: rgba(21, 128, 61, 0.15); border: 1px dashed #15803d;"></span>
            Meses Pico Demanda
          </span>
        </div>
      </div>

      <div class="chart-scroll-box" style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;">
        <svg viewBox="0 0 ${ancho} ${alto}" style="width: 100%; min-width: 440px; height: auto; display: block;" preserveAspectRatio="xMidYMid meet">
          <g class="chart-shades">${shadePeak}</g>
          <g class="chart-grid">${gridLines}</g>
          ${pathAnojo ? `<path d="${pathAnojo}" fill="none" stroke="#15803d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />` : ""}
          ${pathAnojoPes ? `<path d="${pathAnojoPes}" fill="none" stroke="#2563eb" stroke-width="2" stroke-dasharray="4,3" stroke-linecap="round" stroke-linejoin="round" />` : ""}
          ${pathTernera ? `<path d="${pathTernera}" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />` : ""}
          <g class="chart-dots">${dotsHtml}</g>
          <g class="chart-labels-x">${labelsX}</g>
        </svg>
      </div>
      <div style="font-size: 0.76rem; color: var(--text-dim, #777); margin-top: 6px; text-align: right;">
        Media histórica mensual por categoría de carne en las sesiones de la Lonja de Salamanca.
      </div>
    </div>
  `;
}


