// modules/components/trading_chart.js
/**
 * Componente de Gráficos Financieros Profesionales estilo TradingView.
 * Basado en la librería oficial Lightweight Charts (TradingView).
 * Proporciona:
 * - Zoom interactivo táctil y de rueda (pinch-to-zoom / scroll).
 * - Desplazamiento temporal fluido (pan / drag).
 * - Crosshair interactivo con lectura exacta de precios y fechas en tiempo real (HUD).
 * - Control de capas por serie con checkboxes y selección de series activas por defecto.
 * - Selectores de rango temporal (1M, 3M, 6M, 1A, Todo) y botón de auto-ajuste.
 */

import {
  createChart,
  LineSeries,
  AreaSeries,
  createSeriesMarkers,
  CrosshairMode
} from '../../vendor/lightweight-charts.mjs';
import { escapeHtml } from '../config.js';

// Registro de instancias activas para limpieza automática
const instanciasActivas = new Map();

/**
 * Destruye una instancia previa si existe para evitar fugas de memoria y eventos huérfanos.
 */
export function destruirTradingChart(containerId) {
  if (instanciasActivas.has(containerId)) {
    try {
      const { chart, resizeObserver } = instanciasActivas.get(containerId);
      if (resizeObserver) resizeObserver.disconnect();
      if (chart && typeof chart.remove === 'function') chart.remove();
    } catch (e) {
      console.warn(`[TradingView] Error destruyendo gráfico ${containerId}:`, e);
    }
    instanciasActivas.delete(containerId);
  }
}

/**
 * Genera el contenedor HTML del gráfico con su HUD de métricas, capas y botones de rango.
 * @param {Object} config
 * @returns {string} HTML string
 */
export function renderTradingChartContainer(config) {
  const {
    id = "tv-chart",
    titulo = "Evolución de Mercados",
    subtitulo = "",
    seriesDefs = [],
    mostrarRangos = true,
    altura = 300
  } = config;

  const checkboxesHtml = seriesDefs.map(s => {
    const checked = s.defaultVisible !== false;
    return `
      <label class="trading-layer-chip ${checked ? 'active' : ''}" data-series-id="${escapeHtml(s.id)}" style="--chip-color: ${s.color};">
        <input type="checkbox" id="${escapeHtml(id)}-chk-${escapeHtml(s.id)}" class="trading-layer-chk" data-series-id="${escapeHtml(s.id)}" ${checked ? 'checked' : ''} />
        <span class="trading-layer-dot" style="background: ${s.color};"></span>
        <span class="trading-layer-label">${escapeHtml(s.label)}</span>
      </label>
    `;
  }).join("");

  return `
    <div class="trading-chart-card" id="${escapeHtml(id)}-card">
      <!-- Cabecera del Gráfico: Título y Rango Temporal -->
      <div class="trading-chart-header">
        <div>
          <h4 class="trading-chart-title">${escapeHtml(titulo)}</h4>
          ${subtitulo ? `<p class="trading-chart-sub">${escapeHtml(subtitulo)}</p>` : ""}
        </div>
        ${mostrarRangos ? `
          <div class="trading-timeframe-selector">
            <button type="button" class="tv-range-btn" data-chart-id="${escapeHtml(id)}" data-range="1M">1M</button>
            <button type="button" class="tv-range-btn" data-chart-id="${escapeHtml(id)}" data-range="3M">3M</button>
            <button type="button" class="tv-range-btn" data-chart-id="${escapeHtml(id)}" data-range="6M">6M</button>
            <button type="button" class="tv-range-btn" data-chart-id="${escapeHtml(id)}" data-range="1Y">1A</button>
            <button type="button" class="tv-range-btn active" data-chart-id="${escapeHtml(id)}" data-range="ALL">Todo</button>
            <button type="button" class="tv-range-btn tv-fit-btn" data-chart-id="${escapeHtml(id)}" data-range="FIT" title="Ajustar escala al contenido">🔍</button>
          </div>
        ` : ""}
      </div>

      <!-- Selector de Capas por Checkbox -->
      <div class="trading-layers-bar">
        <span class="trading-layers-hint">Capas:</span>
        <div class="trading-layers-list">
          ${checkboxesHtml}
        </div>
      </div>

      <!-- HUD Interactivo: Valores en Tiempo Real del Cursor / Crosshair -->
      <div class="trading-hud-bar" id="${escapeHtml(id)}-hud">
        <span class="trading-hud-date" id="${escapeHtml(id)}-hud-date">---</span>
        <div class="trading-hud-values" id="${escapeHtml(id)}-hud-values">
          <!-- Valores dinámicos inyectados por el crosshair -->
        </div>
      </div>

      <!-- Canvas TradingView -->
      <div class="trading-canvas-wrap" id="${escapeHtml(id)}-canvas" style="height: ${altura}px; width: 100%; position: relative;"></div>
    </div>
  `;
}

/**
 * Inicializa la instancia interactiva de TradingView sobre el contenedor renderizado.
 * @param {Object} config
 * @returns {Object|null} Controlador del gráfico
 */
export function initTradingChart(config) {
  const {
    containerId,
    seriesDefs = [],
    altura = 300,
    priceFormatter = null
  } = config;

  if (typeof window === "undefined" || !document) return null;

  const canvasEl = document.getElementById(`${containerId}-canvas`);
  if (!canvasEl) {
    console.warn(`[TradingView] Contenedor #${containerId}-canvas no encontrado`);
    return null;
  }

  // Destruir instancia anterior si existía
  destruirTradingChart(containerId);

  const anchoInicial = canvasEl.clientWidth || 600;

  // Formateador de precios
  const defaultFormatter = (price) => {
    if (priceFormatter) return priceFormatter(price);
    return `${Number(price).toFixed(2)} €`;
  };

  // Creación del gráfico TradingView
  const chart = createChart(canvasEl, {
    width: anchoInicial,
    height: altura,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#4b5563',
      fontSize: 11,
      fontFamily: 'system-ui, -apple-system, sans-serif'
    },
    grid: {
      vertLines: { color: 'rgba(229, 231, 235, 0.6)', style: 1 },
      horzLines: { color: 'rgba(229, 231, 235, 0.6)', style: 1 }
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        color: '#6b7280',
        width: 1,
        style: 3,
        labelBackgroundColor: '#1f2937'
      },
      horzLine: {
        color: '#6b7280',
        width: 1,
        style: 3,
        labelBackgroundColor: '#1f2937'
      }
    },
    rightPriceScale: {
      borderColor: '#e5e7eb',
      scaleMargins: { top: 0.1, bottom: 0.1 },
      alignLabels: true
    },
    timeScale: {
      borderColor: '#e5e7eb',
      timeVisible: false,
      secondsVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true
    },
    localization: {
      priceFormatter: defaultFormatter,
      dateFormat: 'dd/MM/yyyy'
    }
  });

  const seriesMap = new Map();
  const hudValuesEl = document.getElementById(`${containerId}-hud-values`);
  const hudDateEl = document.getElementById(`${containerId}-hud-date`);

  // Registrar y crear series
  seriesDefs.forEach(def => {
    const isArea = def.type === "area";
    const SeriesConstructor = isArea ? AreaSeries : LineSeries;

    const seriesOptions = {
      color: def.color || '#15803d',
      lineWidth: def.lineWidth || (isArea ? 2 : 2.5),
      priceFormat: {
        type: 'custom',
        formatter: (p) => `${Number(p).toFixed(def.decimales != null ? def.decimales : 2)} ${def.unit || '€'}`
      },
      lastValueVisible: true,
      priceLineVisible: false
    };

    if (isArea) {
      seriesOptions.topColor = def.topColor || 'rgba(21, 128, 61, 0.28)';
      seriesOptions.bottomColor = def.bottomColor || 'rgba(21, 128, 61, 0.02)';
      seriesOptions.lineColor = def.color || '#15803d';
    }

    const series = chart.addSeries(SeriesConstructor, seriesOptions);

    // Filtrar y ordenar datos válidos preservando metadatos (esReal, estimado, etc.)
    const dataLimpia = (def.data || [])
      .filter(d => d && d.time && d.value != null && !isNaN(d.value))
      .map(d => ({
        ...d,
        time: String(d.time).slice(0, 10),
        value: Number(d.value)
      }))
      .sort((a, b) => a.time.localeCompare(b.time));

    // Deduplicar timestamps idénticos (TradingView requiere timestamps estrictamente crecientes)
    const dataUnica = [];
    const timesVistos = new Set();
    dataLimpia.forEach(d => {
      if (!timesVistos.has(d.time)) {
        timesVistos.add(d.time);
        dataUnica.push(d);
      }
    });

    if (dataUnica.length > 0) {
      series.setData(dataUnica.map(d => ({ time: d.time, value: d.value })));

      // Generar marcadores visuales para distinguir datos reales de interpolaciones
      if (def.showMarkers !== false) {
        try {
          const markers = [];
          const esTransaccion = def.id.includes('granja') || def.id.includes('ingresos') || def.id.includes('gastos') || def.id.includes('margen') || def.showMarkers === true;

          if (esTransaccion) {
            dataUnica.forEach(d => {
              if (!d.estimado && d.esReal !== false) {
                markers.push({
                  time: d.time,
                  position: 'inBar',
                  color: def.color || '#ea580c',
                  shape: 'circle',
                  size: 1
                });
              }
            });
          }

          if (markers.length > 0) {
            createSeriesMarkers(series, markers);
          }
        } catch (err) {
          console.warn("[TradingView] No se pudieron aplicar marcadores a la serie:", def.id, err);
        }
      }
    }

    const isVisible = def.defaultVisible !== false;
    series.applyOptions({ visible: isVisible });

    seriesMap.set(def.id, {
      def,
      series,
      data: dataUnica,
      visible: isVisible
    });
  });

  // Función para actualizar el HUD con los últimos valores o los del crosshair
  const actualizarHUD = (timeHovered, mapValores) => {
    let fechaTexto = "---";
    if (timeHovered) {
      const [y, m, d] = String(timeHovered).split("-");
      if (y && m && d) {
        fechaTexto = `${d}/${m}/${y}`;
      } else {
        fechaTexto = String(timeHovered);
      }
    }
    if (hudDateEl) hudDateEl.textContent = `📅 ${fechaTexto}`;

    if (!hudValuesEl) return;

    const itemsHtml = [];
    seriesMap.forEach(({ def, series, data, visible }) => {
      if (!visible) return;

      let val = null;
      if (mapValores && mapValores.has(series)) {
        const item = mapValores.get(series);
        val = item ? item.value : null;
      } else if (data.length > 0) {
        // Último valor histórico disponible
        val = data[data.length - 1].value;
      }

      const valTexto = val != null
        ? `${Number(val).toFixed(def.decimales != null ? def.decimales : 2)} ${def.unit || '€'}`
        : "—";

      // Detectar si en esta fecha exacta hay un dato real de granja o tesorería
      const puntoExacto = data.find(p => p.time === timeHovered);
      let badgeInfo = "";
      if (puntoExacto) {
        if (puntoExacto.estimado) {
          badgeInfo = ` <span class="trading-hud-tag tag-est" style="font-size: 0.70rem; padding: 1px 5px; border-radius: 4px; background: rgba(148, 163, 184, 0.2); color: #475569; font-weight: 700;">Est.</span>`;
        } else if (puntoExacto.esReal !== false) {
          let detalle = "Real";
          if (puntoExacto.canales_total != null && puntoExacto.canales_total > 0) {
            detalle = `${puntoExacto.canales_total} can.`;
          } else if (puntoExacto.cabezas != null && puntoExacto.cabezas > 0) {
            detalle = `${puntoExacto.cabezas} cab.`;
          } else if (puntoExacto.kg_total != null && puntoExacto.kg_total > 0) {
            detalle = `${Math.round(puntoExacto.kg_total).toLocaleString('es-ES')} kg`;
          }
          badgeInfo = ` <span class="trading-hud-tag tag-real" style="font-size: 0.70rem; padding: 1px 5px; border-radius: 4px; background: rgba(34, 197, 94, 0.18); color: #15803d; font-weight: 800;">✓ ${detalle}</span>`;
        }
      } else if (timeHovered && (def.id.includes('granja') || def.id.includes('ingresos') || def.id.includes('gastos'))) {
        badgeInfo = ` <span class="trading-hud-tag tag-interp" style="font-size: 0.68rem; padding: 1px 4px; border-radius: 4px; background: rgba(203, 213, 225, 0.3); color: #64748b;">(interp.)</span>`;
      }

      itemsHtml.push(`
        <span class="trading-hud-item" style="color: ${def.color};">
          <span class="trading-hud-bullet">●</span>
          <span class="trading-hud-name">${escapeHtml(def.shortLabel || def.label)}:</span>
          <strong>${valTexto}</strong>${badgeInfo}
        </span>
      `);
    });

    hudValuesEl.innerHTML = itemsHtml.join("");
  };

  // Inicializar HUD con los últimos datos disponibles
  const obtenerUltimoTiempo = () => {
    let maxTime = "";
    seriesMap.forEach(({ data, visible }) => {
      if (visible && data.length > 0) {
        const t = data[data.length - 1].time;
        if (t > maxTime) maxTime = t;
      }
    });
    return maxTime || null;
  };
  actualizarHUD(obtenerUltimoTiempo(), null);

  // Crosshair move handler
  chart.subscribeCrosshairMove(param => {
    if (!param || !param.time) {
      actualizarHUD(obtenerUltimoTiempo(), null);
      return;
    }
    actualizarHUD(param.time, param.seriesData);
  });

  // Ajustar escala al contenido
  chart.timeScale().fitContent();

  // Gestión de Resize Responsivo
  let resizeObserver = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
      const { width } = entries[0].contentRect;
      if (width > 0) {
        chart.resize(width, altura);
      }
    });
    resizeObserver.observe(canvasEl);
  }

  // Enlazar eventos de checkboxes de capas
  const cardEl = document.getElementById(`${containerId}-card`);
  if (cardEl) {
    cardEl.querySelectorAll(`.trading-layer-chk`).forEach(chk => {
      chk.addEventListener("change", (e) => {
        const sId = e.target.dataset.seriesId;
        const entry = seriesMap.get(sId);
        if (entry) {
          entry.visible = e.target.checked;
          entry.series.applyOptions({ visible: entry.visible });

          const chip = e.target.closest('.trading-layer-chip');
          if (chip) chip.classList.toggle('active', entry.visible);

          actualizarHUD(obtenerUltimoTiempo(), null);
        }
      });
    });

    // Enlazar botones de rango temporal
    cardEl.querySelectorAll(`.tv-range-btn`).forEach(btn => {
      btn.addEventListener("click", () => {
        cardEl.querySelectorAll(`.tv-range-btn`).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const range = btn.dataset.range;
        if (range === "FIT" || range === "ALL") {
          chart.timeScale().fitContent();
          return;
        }

        // Calcular rango 'from' a partir del último punto
        const maxTimeStr = obtenerUltimoTiempo();
        if (!maxTimeStr) return;

        const maxDate = new Date(maxTimeStr);
        let fromDate = new Date(maxDate);

        if (range === "1M") fromDate.setMonth(fromDate.getMonth() - 1);
        else if (range === "3M") fromDate.setMonth(fromDate.getMonth() - 3);
        else if (range === "6M") fromDate.setMonth(fromDate.getMonth() - 6);
        else if (range === "1Y") fromDate.setFullYear(fromDate.getFullYear() - 1);

        const fromStr = fromDate.toISOString().slice(0, 10);
        try {
          chart.timeScale().setVisibleRange({
            from: fromStr,
            to: maxTimeStr
          });
        } catch (e) {
          console.warn("[TradingView] Error aplicando rango:", e);
          chart.timeScale().fitContent();
        }
      });
    });
  }

  const controller = {
    chart,
    seriesMap,
    resizeObserver,
    toggleSeries: (sId, visible) => {
      const entry = seriesMap.get(sId);
      if (entry) {
        entry.visible = !!visible;
        entry.series.applyOptions({ visible: entry.visible });
        const chk = document.getElementById(`${containerId}-chk-${sId}`);
        if (chk) chk.checked = entry.visible;
        const chip = chk ? chk.closest('.trading-layer-chip') : null;
        if (chip) chip.classList.toggle('active', entry.visible);
        actualizarHUD(obtenerUltimoTiempo(), null);
      }
    },
    fitContent: () => chart.timeScale().fitContent(),
    destroy: () => destruirTradingChart(containerId)
  };

  instanciasActivas.set(containerId, controller);
  return controller;
}
