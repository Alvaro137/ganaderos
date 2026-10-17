// modules/views/sales_view.js
/**
 * Vista de Análisis Financiero y Liquidaciones de Carne y Pienso.
 * Aplica el principio de profundidad progresiva:
 * Nivel 1: Resumen de KPIs de rentabilidad, margen carne vs pienso, ratio económico y gráficos SVG.
 * Nivel 2: Exploración detallada con conmutador (Facturas de Liquidación vs Compras de Pienso).
 * Nivel 3: Desglose completo de canales individuales por factura con salto a la ficha del animal.
 */

import {
  AppState,
  escapeHtml,
  extraer4Digitos,
  formatearFecha,
  formatearKg,
  formatearMoneda,
  registrarPasoHistorial,
  obtenerTextoBotonVolver
} from '../config.js';
import {
  obtenerLiquidaciones,
  obtenerDetalleLiquidacion,
  obtenerResumenFinancieroGlobal,
  obtenerSerieMensualFinanciera,
  obtenerAniosDisponiblesFinancieros,
  obtenerComprasAlimento,
  obtenerMargenTecnicoCebo,
  obtenerRadarMateriasPrimas,
  obtenerRadarLonjaCarne,
  sincronizarBaseDatosAhora
} from '../db.js';
import { seleccionarAnimal } from './detail_view.js';
import {
  renderGraficoBarrasComparativas,
  renderGraficoCotizacionCanal,
  renderGraficoRadarMateriasPrimas,
  renderGraficoLonjaCarne
} from '../components/charts_svg.js';

// Estado local de la vista financiera
if (AppState.anioFinanciero === undefined) {
  AppState.anioFinanciero = "2026";
}
if (AppState.categoriaFinanciera === undefined) {
  AppState.categoriaFinanciera = "TODOS";
}
if (AppState.subtabFinanciera === undefined) {
  AppState.subtabFinanciera = "facturas"; // "facturas" o "piensos"
}
if (AppState.perspectivaFinanciera === undefined) {
  AppState.perspectivaFinanciera = "tesoreria"; // "tesoreria" | "devengo" | "radar"
}
if (AppState.subseccionRadar === undefined) {
  AppState.subseccionRadar = "carne"; // "carne" o "piensos"
}
if (AppState.graficosExpandidos === undefined) {
  AppState.graficosExpandidos = false; // Colapsado por defecto en móvil para máxima claridad
}

export function renderVistaLiquidaciones() {
  const container = document.getElementById("app-container");
  if (!container) return;

  AppState.tabActual = "ventas";
  AppState.crotalSeleccionado = null;
  AppState.corralSeleccionado = null;

  // Si hay una factura seleccionada, renderizar su vista de profundidad (Nivel 3)
  if (AppState.facturaSeleccionada) {
    verDetalleLiquidacion(AppState.facturaSeleccionada, false);
    return;
  }

  const aniosDisponibles = obtenerAniosDisponiblesFinancieros();
  // Si el año seleccionado no está en la lista y no es TODOS, usar el primer año
  if (AppState.anioFinanciero !== "TODOS" && !aniosDisponibles.includes(AppState.anioFinanciero)) {
    AppState.anioFinanciero = aniosDisponibles[0] || "TODOS";
  }

  const resumen = obtenerResumenFinancieroGlobal(AppState.anioFinanciero, AppState.categoriaFinanciera);
  const serieMensual = obtenerSerieMensualFinanciera(AppState.anioFinanciero);
  const filtro = AppState.filtroLiquidaciones || "";
  const facturas = obtenerLiquidaciones(filtro);
  const comprasPienso = (AppState.subtabFinanciera === "piensos") ? obtenerComprasAlimento(filtro) : [];

  // Opciones de selector de años
  const opcionesAnios = [
    `<option value="TODOS" ${AppState.anioFinanciero === "TODOS" ? "selected" : ""}>Todos los Años</option>`,
    ...aniosDisponibles.map(a => `<option value="${a}" ${AppState.anioFinanciero === a ? "selected" : ""}>Campaña ${a}</option>`)
  ].join("");

  // Ratio badge
  let badgeRatioHtml = "";
  if (resumen.ratio_carne_pienso != null) {
    const r = resumen.ratio_carne_pienso;
    const esRentable = r >= 1.5;
    badgeRatioHtml = `
      <span class="ratio-badge ${esRentable ? 'rentable' : 'alerta'}">
        ${esRentable ? '✓ Rentable' : '⚠️ Ajustado'}
      </span>
    `;
  }

  const devengo = (AppState.perspectivaFinanciera === "devengo")
    ? obtenerMargenTecnicoCebo(AppState.anioFinanciero, AppState.categoriaFinanciera)
    : null;
  const radarData = (AppState.perspectivaFinanciera === "radar")
    ? obtenerRadarMateriasPrimas(AppState.anioFinanciero)
    : null;
  const radarCarne = (AppState.perspectivaFinanciera === "radar")
    ? obtenerRadarLonjaCarne(AppState.anioFinanciero)
    : [];

  const html = `
    <div style="max-width: 1000px; margin: 0 auto; padding-bottom: 24px;">
      <!-- Cabecera con botón volver y título -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
        <div>
          <button class="btn-volver" id="btn-volver-desde-ventas" title="Volver a la vista anterior">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>${escapeHtml(obtenerTextoBotonVolver())}</span>
          </button>
          <h2 style="font-size: 1.45rem; font-weight: 800; color: var(--brand-primary); margin-top: 8px;">
            Análisis Económico y Liquidaciones
          </h2>
          <p style="font-size: 0.9rem; color: var(--text-muted); margin-top: 2px;">
            ${AppState.perspectivaFinanciera === "devengo" 
              ? "Margen técnico individual por ciclo de cebo y auditoría vs Lonja de Salamanca."
              : (AppState.perspectivaFinanciera === "radar" 
                  ? "Evolución comparada de Lonja Salamanca (Vacuno de Carne y Materias Primas) vs Explotación."
                  : "Rentabilidad de la explotación: Facturación de Carne vs Coste de Alimentación.")}
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="btn-action-small" id="btn-subir-factura-pdf" style="min-height: 44px; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; background: var(--brand-primary); color: #fff; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <span>Subir Factura PDF</span>
          </button>
          <input type="file" id="input-subir-pdf-factura" accept=".pdf,application/pdf" style="display: none;" />
        </div>
      </div>

      <!-- Selector de Perspectiva Analítica (Pills Material Design 3) -->
      <div class="financial-perspective-selector">
        <button class="perspective-pill-btn ${AppState.perspectivaFinanciera === 'tesoreria' ? 'active' : ''}" data-perspectiva="tesoreria">
          <span>💰 Tesorería (Cobros vs Pagos)</span>
        </button>
        <button class="perspective-pill-btn ${AppState.perspectivaFinanciera === 'devengo' ? 'active' : ''}" data-perspectiva="devengo">
          <span>🐄 Margen Técnico de Cebo</span>
        </button>
        <button class="perspective-pill-btn ${AppState.perspectivaFinanciera === 'radar' ? 'active' : ''}" data-perspectiva="radar">
          <span>🌾 Radar de Mercados y Lonja</span>
        </button>
      </div>

      <!-- Filtros de Campaña y Categoría -->
      <div class="financial-controls-row">
        <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">
          <span>📅 Campaña:</span>
          <select id="sel-anio-financiero" class="financial-select-pill">
            ${opcionesAnios}
          </select>
        </label>

        ${AppState.perspectivaFinanciera !== "radar" ? `
          <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">
            <span>🐄 Tipo:</span>
            <select id="sel-categoria-financiera" class="financial-select-pill">
              <option value="TODOS" ${AppState.categoriaFinanciera === "TODOS" ? "selected" : ""}>Todo el ganado</option>
              <option value="CEBO" ${AppState.categoriaFinanciera === "CEBO" ? "selected" : ""}>Cebo (Terneros/as)</option>
              <option value="DESVIEJE" ${AppState.categoriaFinanciera === "DESVIEJE" ? "selected" : ""}>Desvieje (Vacas/Toros)</option>
            </select>
          </label>
        ` : ""}
      </div>

      ${AppState.perspectivaFinanciera === "tesoreria" ? `
        <!-- Cuadrícula de 6 KPIs Financieros (Tesorería) -->
        <div class="kpis-liquidaciones-grid">
          <!-- 1. Ingresos Carne -->
          <div class="kpi-card-tonal">
            <div class="kpi-tonal-lbl">Venta de Carne</div>
            <div class="kpi-tonal-val" style="color: var(--chart-carne, #15803d);">${formatearMoneda(resumen.ingresos_carne)} €</div>
            <div class="kpi-tonal-sub">${resumen.total_cabezas_carne} cabezas · ${formatearKg(resumen.total_kilos_canal)} kg canal</div>
          </div>

          <!-- 2. Gasto Pienso -->
          <div class="kpi-card-tonal">
            <div class="kpi-tonal-lbl">Gasto en Pienso</div>
            <div class="kpi-tonal-val" style="color: var(--chart-pienso, #ea580c);">${formatearMoneda(resumen.gasto_pienso)} €</div>
            <div class="kpi-tonal-sub">${formatearKg(resumen.kilos_pienso)} kg concentrado</div>
          </div>

          <!-- 3. Margen Bruto sobre Alimentación -->
          <div class="kpi-card-tonal" style="border-left: 3px solid ${resumen.margen_bruto_alimentacion >= 0 ? 'var(--brand-primary)' : '#ba1a1a'};">
            <div class="kpi-tonal-lbl">Margen sobre Pienso</div>
            <div class="kpi-tonal-val" style="color: ${resumen.margen_bruto_alimentacion >= 0 ? '#1b5e20' : '#ba1a1a'};">
              ${resumen.margen_bruto_alimentacion >= 0 ? '+' : ''}${formatearMoneda(resumen.margen_bruto_alimentacion)} €
            </div>
            <div class="kpi-tonal-sub">Saldo bruto de tesorería</div>
          </div>

          <!-- 4. Cotización Media Canal -->
          <div class="kpi-card-tonal">
            <div class="kpi-tonal-lbl">Cotización Media Canal</div>
            <div class="kpi-tonal-val" style="color: var(--brand-primary);">
              ${resumen.cotizacion_media_canal > 0 ? `${resumen.cotizacion_media_canal.toFixed(2)} €/kg` : "—"}
            </div>
            <div class="kpi-tonal-sub">Peso medio: ${resumen.peso_medio_canal > 0 ? `${resumen.peso_medio_canal} kg` : "—"}</div>
          </div>

          <!-- 5. Coste Medio Pienso -->
          <div class="kpi-card-tonal">
            <div class="kpi-tonal-lbl">Coste Medio Pienso</div>
            <div class="kpi-tonal-val" style="color: var(--md-secondary, #b45309);">
              ${resumen.coste_medio_pienso_kg > 0 ? `${resumen.coste_medio_pienso_kg.toFixed(3)} €/kg` : "—"}
            </div>
            <div class="kpi-tonal-sub">${resumen.coste_medio_pienso_t > 0 ? `${resumen.coste_medio_pienso_t} €/t concentrado` : "Sin compras"}</div>
          </div>

          <!-- 6. Ratio Carne / Pienso -->
          <div class="kpi-card-tonal">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="kpi-tonal-lbl">Ratio Carne / Pienso</div>
              ${badgeRatioHtml}
            </div>
            <div class="kpi-tonal-val">
              ${resumen.ratio_carne_pienso != null ? resumen.ratio_carne_pienso.toFixed(2) : "—"}
            </div>
            <div class="kpi-tonal-sub">Euros facturados por euro de pienso</div>
          </div>
        </div>

        <!-- Botón Desplegable para Gráficos SVG Nativos -->
        <button class="btn-toggle-charts" id="btn-toggle-charts">
          <span>${AppState.graficosExpandidos ? "▲ Ocultar Gráficos de Balance" : "📊 Ver Gráficos de Balance y Precios"}</span>
          <span style="font-size: 0.8rem; color: var(--text-muted);">${serieMensual.length} meses analizados</span>
        </button>

        <!-- Bloque de Gráficos SVG (Colapsable con 1 toque) -->
        ${AppState.graficosExpandidos ? `
          <div class="financial-charts-section" style="animation: fadeIn 0.2s ease;">
            ${renderGraficoBarrasComparativas(serieMensual)}
            ${renderGraficoCotizacionCanal(serieMensual)}
          </div>
        ` : ""}

        <!-- Subpestañas de Exploración Detallada (Facturas vs Piensos) -->
        <div class="financial-subtabs">
          <button class="financial-subtab-btn ${AppState.subtabFinanciera === 'facturas' ? 'active' : ''}" data-subtab="facturas">
            Facturas de Liquidación (${facturas.length})
          </button>
          <button class="financial-subtab-btn ${AppState.subtabFinanciera === 'piensos' ? 'active' : ''}" data-subtab="piensos">
            Compras de Pienso (${comprasPienso.length || "Ver"})
          </button>
        </div>

        <!-- Contenido según la subpestaña seleccionada -->
        ${AppState.subtabFinanciera === 'facturas' ? `
          <!-- Buscador de facturas -->
          <div class="search-input-wrapper" style="margin-bottom: 14px;">
            <input 
              type="text" 
              id="txt-busqueda-liquidaciones" 
              class="search-input" 
              placeholder="Buscar factura (ej. G015/3, 1/51), fecha o cooperativa..." 
              value="${escapeHtml(filtro)}"
              autocomplete="off"
              spellcheck="false"
            />
            ${filtro ? '<button class="btn-input-clear" id="btn-clear-liquidaciones">✕</button>' : ""}
          </div>

          <div class="liquidaciones-lista">
            ${
              facturas.length === 0
                ? `<div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-muted);">
                    <p style="font-weight: 700; font-size: 1.05rem;">No se encontraron facturas</p>
                    <p style="font-size: 0.85rem; margin-top: 4px;">Comprueba el término de búsqueda o sube un PDF oficial de GANAVAEX.</p>
                  </div>`
                : facturas
                    .map((f) => {
                      const cabezas = f.total_cabezas != null ? `${f.total_cabezas} cabezas` : "Lote";
                      const kilos = f.total_kilos_canal != null && f.total_kilos_canal > 1 ? `${formatearKg(f.total_kilos_canal)} kg` : null;
                      return `
                        <div class="liquidacion-card" data-action="ver-factura" data-factura-id="${f.id}" style="cursor: pointer;">
                          <div class="card-header-row" style="margin-bottom: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                              <span class="badge-factura">Factura ${escapeHtml(f.numero_factura)}</span>
                              <span class="liquidacion-fecha">${formatearFecha(f.fecha_factura)}</span>
                            </div>
                            <span class="liquidacion-total">${formatearMoneda(f.total_factura)} €</span>
                          </div>

                          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px;">
                            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text-muted);">
                              <span class="chip-kpis-mini">🐄 ${escapeHtml(cabezas)}</span>
                              ${kilos ? `<span class="chip-kpis-mini">⚖️ ${escapeHtml(kilos)} canal</span>` : ""}
                              <span class="chip-kpis-mini">🏛️ ${escapeHtml(f.cliente_cooperativa || "GANAVAEX")}</span>
                            </div>
                            <button class="btn-profundizar btn-ver-canales" data-action="ver-factura" data-factura-id="${f.id}">
                              <span>Ver canales (${escapeHtml(f.total_cabezas != null ? String(f.total_cabezas) : "desglose")})</span>
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                <polyline points="12 5 19 12 12 19"></polyline>
                              </svg>
                            </button>
                          </div>
                        </div>
                      `;
                    })
                    .join("")
            }
          </div>
        ` : `
          <!-- Listado de Compras de Pienso -->
          <div class="liquidaciones-lista">
            ${
              comprasPienso.length === 0
                ? `<div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-muted);">
                    <p style="font-weight: 700; font-size: 1.05rem;">Sin compras de pienso registradas</p>
                    <p style="font-size: 0.85rem; margin-top: 4px;">No constan albaranes de alimentación en el periodo seleccionado.</p>
                  </div>`
                : comprasPienso.map(c => {
                    const tieneImporte = c.importe > 0;
                    const tieneKg = c.kg > 0;
                    const precioKg = c.precio_kg > 0 ? c.precio_kg : (tieneImporte && tieneKg ? c.importe / c.kg : 0);
                    const textoPrecio = precioKg > 0 ? `${formatearMoneda(precioKg, 4)} €/kg` : "—";
                    return `
                      <div class="liquidacion-card" style="padding: 14px 16px;">
                        <div class="card-header-row" style="margin-bottom: 8px;">
                          <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-weight: 800; font-size: 0.98rem; color: var(--text-main);">${escapeHtml(c.alimento || "Pienso")}</span>
                            <span class="liquidacion-fecha">${formatearFecha(c.fecha)}</span>
                          </div>
                          <span class="liquidacion-total" style="color: var(--md-secondary, #b45309);">${formatearMoneda(c.importe)} €</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 0.85rem; color: var(--text-muted);">
                          <div>
                            <span>⚖️ ${formatearKg(c.kg)} kg</span> • 
                            <span>🏷️ ${textoPrecio}</span>
                          </div>
                          <div>
                            <span>🏢 ${escapeHtml(c.proveedor || "Cooperativa")}</span>
                            ${c.albaran ? ` • <span style="font-size: 0.8rem;">Alb. ${escapeHtml(c.albaran)}</span>` : ""}
                          </div>
                        </div>
                      </div>
                    `;
                  }).join("")
            }
          </div>
        `}
      ` : (AppState.perspectivaFinanciera === "devengo" && devengo ? `
        <!-- PERSPECTIVA DE DEVENGO: Margen Técnico de Cebo -->
        <div class="info-banner-devengo">
          <strong>Perspectiva Técnica de Cebo (Devengo Real):</strong> Imputa a cada animal el concentrado consumido (índice FCR ≈ 5.0 kg pienso / kg vivo ganado) según sus días reales de estancia en el cebadero y el precio medio del pienso de sus albaranes. Además, audita el precio cobrado frente a la <strong>Lonja Oficial de Salamanca</strong> y detecta penalizaciones de mercado por sobrepeso (&gt;350 kg canal).
        </div>

        <!-- Cuadrícula de 6 KPIs de Margen Técnico -->
        <div class="kpis-liquidaciones-grid">
          <!-- 1. Margen Técnico Total -->
          <div class="kpi-card-tonal" style="border-left: 3px solid ${devengo.margen_tecnico_total >= 0 ? 'var(--brand-primary)' : '#ba1a1a'};">
            <div class="kpi-tonal-lbl">Margen Técnico Total</div>
            <div class="kpi-tonal-val" style="color: ${devengo.margen_tecnico_total >= 0 ? '#1b5e20' : '#ba1a1a'};">
              ${devengo.margen_tecnico_total >= 0 ? '+' : ''}${formatearMoneda(devengo.margen_tecnico_total)} €
            </div>
            <div class="kpi-tonal-sub">Resultado tras coste de pienso imputado</div>
          </div>

          <!-- 2. Margen Medio por Cabeza -->
          <div class="kpi-card-tonal">
            <div class="kpi-tonal-lbl">Margen / Cabeza</div>
            <div class="kpi-tonal-val" style="color: ${devengo.margen_medio_cabeza >= 0 ? '#1b5e20' : '#ba1a1a'};">
              ${devengo.margen_medio_cabeza >= 0 ? '+' : ''}${formatearMoneda(devengo.margen_medio_cabeza)} €
            </div>
            <div class="kpi-tonal-sub">Beneficio neto estimado por animal</div>
          </div>

          <!-- 3. Coste Pienso Imputado Medio -->
          <div class="kpi-card-tonal">
            <div class="kpi-tonal-lbl">Pienso Imputado / Cab.</div>
            <div class="kpi-tonal-val" style="color: var(--chart-pienso, #ea580c);">
              ${formatearMoneda(devengo.coste_pienso_medio_cabeza)} €
            </div>
            <div class="kpi-tonal-sub">Consumo acumulado en estancia</div>
          </div>

          <!-- 4. Estancia Media en Cebadero -->
          <div class="kpi-card-tonal">
            <div class="kpi-tonal-lbl">Estancia Media Cebadero</div>
            <div class="kpi-tonal-val" style="color: var(--brand-primary);">
              ${devengo.estancia_media_dias} días
            </div>
            <div class="kpi-tonal-sub">Ciclo biológico desde entrada 122</div>
          </div>

          <!-- 5. Prima Media s/ Lonja Salamanca -->
          <div class="kpi-card-tonal">
            <div class="kpi-tonal-lbl">Prima s/ Lonja Salamanca</div>
            <div class="kpi-tonal-val" style="color: ${(devengo.prima_media_lonja_kg || 0) >= 0 ? '#1b5e20' : '#ba1a1a'};">
              ${devengo.prima_media_lonja_kg != null ? `${devengo.prima_media_lonja_kg >= 0 ? '+' : ''}${devengo.prima_media_lonja_kg.toFixed(3)} €/kg` : "—"}
            </div>
            <div class="kpi-tonal-sub">Diferencial vs cotización oficial</div>
          </div>

          <!-- 6. Animales Auditados -->
          <div class="kpi-card-tonal">
            <div class="kpi-tonal-lbl">Terneros Auditados</div>
            <div class="kpi-tonal-val">${devengo.total_animales}</div>
            <div class="kpi-tonal-sub">Canales con ciclo de cebo trazado</div>
          </div>
        </div>

        <!-- Tabla Detallada de Animales con Margen Técnico y Lonja -->
        <div style="margin-top: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
            <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--brand-primary); margin: 0;">
              Auditoría Individual de Terneros (${devengo.animales.length})
            </h3>
            <span style="font-size: 0.82rem; color: var(--text-muted);">
              Cálculo FCR 5.0 · Cruce semanal con Lonja Salamanca
            </span>
          </div>

          <div class="canales-table-wrapper" style="background: var(--md-surface-container-low, #fff); border: 1px solid var(--md-outline-variant, #e5e7eb); border-radius: 12px; overflow-x: auto;">
            <table class="canales-table" style="width: 100%; border-collapse: collapse; font-size: 0.88rem; text-align: left;">
              <thead>
                <tr style="background: var(--md-surface-container-high, #f3f4f6); border-bottom: 1.5px solid var(--md-outline-variant, #e5e7eb);">
                  <th style="padding: 10px 12px;">Crotal</th>
                  <th style="padding: 10px 12px;">Factura / Sacrificio</th>
                  <th style="padding: 10px 12px;">Canal</th>
                  <th style="padding: 10px 12px;">Precio Cobrado</th>
                  <th style="padding: 10px 12px;">Estancia Cebo</th>
                  <th style="padding: 10px 12px;">Pienso Imputado</th>
                  <th style="padding: 10px 12px;">Margen Estimado</th>
                  <th style="padding: 10px 12px;">Lonja Salamanca & Alertas</th>
                </tr>
              </thead>
              <tbody>
                ${
                  devengo.animales.length === 0
                    ? `<tr><td colspan="8" style="padding: 30px; text-align: center; color: var(--text-muted);">No constan liquidaciones con trazabilidad de cebo en el periodo.</td></tr>`
                    : devengo.animales.map(a => {
                        const primaPositiva = a.prima_sobre_lonja_kg != null && a.prima_sobre_lonja_kg >= 0;
                        const badgePrima = a.prima_sobre_lonja_kg != null
                          ? `<span class="${primaPositiva ? 'badge-prima-positiva' : 'badge-prima-negativa'}" title="Precio Lonja: ${a.precio_lonja_salamanca} €/kg">
                              ${primaPositiva ? '▲ +' : '▼ '}${a.prima_sobre_lonja_kg.toFixed(2)} €/kg
                            </span>`
                          : `<span style="color: var(--text-dim); font-size: 0.8rem;">Sin cotiz.</span>`;

                        const badgeSobrepeso = a.penalizacion_sobrepeso
                          ? `<span class="badge-penalizacion-sobrepeso" title="Sobrepeso >350kg (+${a.penalizacion_sobrepeso.exceso_kg} kg)">
                              ⚠️ Sobrepeso (+${a.penalizacion_sobrepeso.exceso_kg}kg, -${a.penalizacion_sobrepeso.coste_penalizacion}€)
                            </span>`
                          : "";

                        return `
                          <tr style="border-bottom: 1px solid var(--md-outline-variant, #f0f0f0);">
                            <td style="padding: 10px 12px;">
                              ${a.crotal ? `
                                <button class="clickable-chip chip-animal-link" data-action="select-animal" data-crotal="${escapeHtml(a.crotal)}" style="padding: 4px 10px; font-size: 0.82rem;">
                                  <span style="font-weight: 800; color: var(--brand-primary);">${escapeHtml(a.crotal_4)}</span>
                                  <span class="chip-action">Ficha →</span>
                                </button>
                              ` : `<span style="color: var(--text-muted);">—</span>`}
                            </td>
                            <td style="padding: 10px 12px;">
                              <div style="font-weight: 700; color: var(--text-main); font-size: 0.85rem;">Fact. ${escapeHtml(a.numero_factura || "—")}</div>
                              <div style="font-size: 0.78rem; color: var(--text-muted);">${formatearFecha(a.fecha_sacrificio)}</div>
                            </td>
                            <td style="padding: 10px 12px; font-weight: 800; color: var(--brand-primary);">
                              ${formatearKg(a.peso_canal_kg)} kg
                            </td>
                            <td style="padding: 10px 12px; font-weight: 700;">
                              ${a.precio_unitario != null ? `${Number(a.precio_unitario).toFixed(3)} €/kg` : "—"}
                            </td>
                            <td style="padding: 10px 12px;">
                              <span style="font-weight: 700; color: var(--text-main);">${a.dias_cebo} d</span>
                              <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">GMD: ${a.gmd_estimada ? a.gmd_estimada.toFixed(2) : '1.30'} kg/d</span>
                            </td>
                            <td style="padding: 10px 12px;">
                              <span style="font-weight: 700; color: var(--chart-pienso, #ea580c);">${formatearMoneda(a.coste_pienso_imputado)} €</span>
                              <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">${formatearKg(a.kg_pienso_imputados)} kg FCR</span>
                            </td>
                            <td style="padding: 10px 12px; font-weight: 800; color: ${a.margen_tecnico >= 0 ? '#1b5e20' : '#ba1a1a'};">
                              ${a.margen_tecnico >= 0 ? '+' : ''}${formatearMoneda(a.margen_tecnico)} €
                            </td>
                            <td style="padding: 10px 12px;">
                              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                                ${badgePrima}
                                ${badgeSobrepeso}
                              </div>
                            </td>
                          </tr>
                        `;
                      }).join("")
                }
              </tbody>
            </table>
          </div>
        </div>
      ` : (AppState.perspectivaFinanciera === "radar" ? `
        <!-- Selector de Subsección del Radar: Carne vs Cereales -->
        <div class="financial-subtabs" style="margin-bottom: 16px;">
          <button class="financial-subtab-btn radar-subtab-btn ${AppState.subseccionRadar === 'carne' ? 'active' : ''}" data-radar-subtab="carne">
            🥩 Vacuno de Carne (Lonja vs Granja)
          </button>
          <button class="financial-subtab-btn radar-subtab-btn ${AppState.subseccionRadar === 'piensos' ? 'active' : ''}" data-radar-subtab="piensos">
            🌾 Materias Primas (Cereales vs Pienso)
          </button>
        </div>

        <!-- Banner descriptivo con botón de Sincronización en Vivo -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <div class="info-banner-devengo" style="margin: 0; flex: 1; min-width: 280px; background: var(--md-surface-container-high, #fffbeb); border-color: #fde68a; border-left-color: #d97706;">
            <strong>${AppState.subseccionRadar === 'carne' ? 'Radar Oficial de Vacuno de Carne:' : 'Radar Analítico de Materias Primas:'}</strong>
            ${AppState.subseccionRadar === 'carne'
              ? 'Evolución de las cotizaciones oficiales de la Lonja de Salamanca (€/kg canal: Añojo, Ternera, Vaca) frente al precio medio liquidado a la explotación ganadera.'
              : 'Seguimiento neutral de las cotizaciones oficiales de Salamanca (Cebada y Maíz en €/t) frente al precio medio efectivo del concentrado de cebo en albaranes.'}
          </div>
          <button id="btn-sync-lonja" class="btn-action-small" style="min-height: 42px; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; background: var(--brand-primary); color: #fff; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; white-space: nowrap;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            <span>Actualizar Lonja en Vivo</span>
          </button>
        </div>

        ${AppState.subseccionRadar === 'carne' ? `
          <!-- Gráfico SVG Responsivo de Vacuno de Carne -->
          <div style="margin-bottom: 24px;">
            ${renderGraficoLonjaCarne(radarCarne)}
          </div>

          <!-- Tabla de Evolución Mensual: Lonja Carne vs Liquidaciones Granja -->
          <div style="margin-top: 20px;">
            <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--brand-primary); margin-bottom: 12px;">
              Evolución Mensual: Lonja Salamanca vs Precio Cobrado Granja (€/kg Canal)
            </h3>

            <div class="canales-table-wrapper" style="background: var(--md-surface-container-low, #fff); border: 1px solid var(--md-outline-variant, #e5e7eb); border-radius: 12px; overflow-x: auto;">
              <table class="canales-table" style="width: 100%; border-collapse: collapse; font-size: 0.88rem; text-align: left;">
                <thead>
                  <tr style="background: var(--md-surface-container-high, #f3f4f6); border-bottom: 1.5px solid var(--md-outline-variant, #e5e7eb);">
                    <th style="padding: 10px 12px;">Mes</th>
                    <th style="padding: 10px 12px;">Añojo Extra (&lt;350kg)</th>
                    <th style="padding: 10px 12px;">Añojo Pesado (&gt;350kg)</th>
                    <th style="padding: 10px 12px;">Ternera Extra</th>
                    <th style="padding: 10px 12px;">Vaca Desvieje</th>
                    <th style="padding: 10px 12px;">Cobrado Granja</th>
                    <th style="padding: 10px 12px;">Canales</th>
                    <th style="padding: 10px 12px;">Diferencial vs Añojo Extra</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    radarCarne.length === 0
                      ? `<tr><td colspan="8" style="padding: 30px; text-align: center; color: var(--text-muted);">Sin cotizaciones de carne o ventas en el periodo seleccionado. Pulsa "Actualizar Lonja en Vivo" para cargar datos.</td></tr>`
                      : radarCarne.map(r => {
                          const dif = (r.precio_medio_granja != null && r.anojo_extra_lonja != null)
                            ? Number((r.precio_medio_granja - r.anojo_extra_lonja).toFixed(2))
                            : null;
                          const textoDif = dif != null
                            ? `${dif >= 0 ? '+' : ''}${dif.toFixed(2)} €/kg`
                            : "—";

                          return `
                            <tr style="border-bottom: 1px solid var(--md-outline-variant, #f0f0f0);">
                              <td style="padding: 10px 12px; font-weight: 700; color: var(--text-main);">${escapeHtml(r.mes)}</td>
                              <td style="padding: 10px 12px; color: #15803d; font-weight: 700;">${r.anojo_extra_lonja != null ? `${r.anojo_extra_lonja.toFixed(2)} €/kg` : "—"}</td>
                              <td style="padding: 10px 12px; color: #2563eb; font-weight: 600;">${r.anojo_pesado_lonja != null ? `${r.anojo_pesado_lonja.toFixed(2)} €/kg` : "—"}</td>
                              <td style="padding: 10px 12px; color: #7c3aed; font-weight: 600;">${r.ternera_extra_lonja != null ? `${r.ternera_extra_lonja.toFixed(2)} €/kg` : "—"}</td>
                              <td style="padding: 10px 12px; color: #64748b; font-weight: 600;">${r.vaca_desvieje_lonja != null ? `${r.vaca_desvieje_lonja.toFixed(2)} €/kg` : "—"}</td>
                              <td style="padding: 10px 12px; font-weight: 800; color: ${r.precio_medio_granja ? '#ea580c' : 'var(--text-dim)'};">
                                ${r.precio_medio_granja != null && r.precio_medio_granja > 0 ? `${r.precio_medio_granja.toFixed(2)} €/kg` : "Sin ventas"}
                              </td>
                              <td style="padding: 10px 12px; color: var(--text-muted);">
                                ${r.canales_vendidas > 0 ? `${r.canales_vendidas} cab.` : "—"}
                              </td>
                              <td style="padding: 10px 12px; font-weight: 700; color: ${dif != null ? (dif >= 0 ? '#1b5e20' : '#b45309') : 'var(--text-muted)'};">
                                ${textoDif}
                              </td>
                            </tr>
                          `;
                        }).join("")
                  }
                </tbody>
              </table>
            </div>
          </div>
        ` : `
          <!-- Gráfico SVG Responsivo de Materias Primas -->
          <div style="margin-bottom: 24px;">
            ${renderGraficoRadarMateriasPrimas(radarData || [])}
          </div>

          <!-- Tabla de Evolución Mensual de Cotizaciones e Insumos -->
          <div style="margin-top: 20px;">
            <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--brand-primary); margin-bottom: 12px;">
              Evolución Mensual: Lonja Salamanca vs Pienso Comprado (€/t)
            </h3>

            <div class="canales-table-wrapper" style="background: var(--md-surface-container-low, #fff); border: 1px solid var(--md-outline-variant, #e5e7eb); border-radius: 12px; overflow-x: auto;">
              <table class="canales-table" style="width: 100%; border-collapse: collapse; font-size: 0.88rem; text-align: left;">
                <thead>
                  <tr style="background: var(--md-surface-container-high, #f3f4f6); border-bottom: 1.5px solid var(--md-outline-variant, #e5e7eb);">
                    <th style="padding: 10px 12px;">Mes</th>
                    <th style="padding: 10px 12px;">Cebada Salamanca (€/t)</th>
                    <th style="padding: 10px 12px;">Maíz Salamanca (€/t)</th>
                    <th style="padding: 10px 12px;">Pienso Lonja (€/t)</th>
                    <th style="padding: 10px 12px;">Pienso Granja (€/t)</th>
                    <th style="padding: 10px 12px;">Volumen Comprado</th>
                    <th style="padding: 10px 12px;">Diferencial Real vs Lonja</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    !radarData || radarData.length === 0
                      ? `<tr><td colspan="7" style="padding: 30px; text-align: center; color: var(--text-muted);">Sin datos de cotización en el periodo seleccionado. Pulsa "Actualizar Lonja en Vivo" para cargar datos.</td></tr>`
                      : radarData.map(r => {
                          const dif = (r.pienso_real_t != null && r.pienso_lonja_t != null)
                            ? Number((r.pienso_real_t - r.pienso_lonja_t).toFixed(1))
                            : null;
                          const textoDif = dif != null
                            ? `${dif >= 0 ? '+' : ''}${dif} €/t`
                            : "—";

                          return `
                            <tr style="border-bottom: 1px solid var(--md-outline-variant, #f0f0f0);">
                              <td style="padding: 10px 12px; font-weight: 700; color: var(--text-main);">${escapeHtml(r.mes)}</td>
                              <td style="padding: 10px 12px; color: #b45309; font-weight: 600;">${r.cebada_lonja_t != null ? `${r.cebada_lonja_t} €/t` : "—"}</td>
                              <td style="padding: 10px 12px; color: #d97706; font-weight: 600;">${r.maiz_lonja_t != null ? `${r.maiz_lonja_t} €/t` : "—"}</td>
                              <td style="padding: 10px 12px; color: var(--chart-pienso, #ea580c); font-weight: 700;">${r.pienso_lonja_t != null ? `${r.pienso_lonja_t} €/t` : "—"}</td>
                              <td style="padding: 10px 12px; font-weight: 800; color: ${r.pienso_real_t ? 'var(--brand-primary)' : 'var(--text-dim)'};">
                                ${r.pienso_real_t != null && r.pienso_real_t > 0 ? `${r.pienso_real_t} €/t` : "Sin compras"}
                              </td>
                              <td style="padding: 10px 12px; color: var(--text-muted);">
                                ${r.kg_comprados > 0 ? `${formatearKg(r.kg_comprados)} kg` : "—"}
                              </td>
                              <td style="padding: 10px 12px; font-weight: 700; color: ${dif != null ? (dif <= 0 ? '#1b5e20' : '#b45309') : 'var(--text-muted)'};">
                                ${textoDif}
                              </td>
                            </tr>
                          `;
                        }).join("")
                  }
                </tbody>
              </table>
            </div>
          </div>
        `}
      ` : ""))}
    </div>
  `;

  container.innerHTML = html;
  adjuntarEventosLiquidaciones(container);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function verDetalleLiquidacion(facturaId, pushHistory = true) {
  const container = document.getElementById("app-container");
  if (!container) return;

  const factura = obtenerDetalleLiquidacion(facturaId);
  if (!factura) {
    console.warn(`[Ventas] Factura #${facturaId} no encontrada`);
    AppState.facturaSeleccionada = null;
    renderVistaLiquidaciones();
    return;
  }

  if (pushHistory) {
    registrarPasoHistorial("liquidaciones", facturaId, `Factura ${factura.numero_factura || facturaId}`, {
      numero_factura: factura.numero_factura
    });
  }
  AppState.facturaSeleccionada = facturaId;

  const canales = factura.canales || [];
  const gastos = factura.gastos || [];

  const html = `
    <div style="max-width: 960px; margin: 0 auto; padding-bottom: 24px;">
      <!-- Botón Volver y migas -->
      <div style="margin-bottom: 16px;">
        <button class="btn-volver btn-volver-liq" id="btn-volver-a-liquidaciones" title="Volver al panel económico">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Volver al Análisis Económico</span>
        </button>
      </div>

      <!-- Ficha técnica de la Factura -->
      <div class="ficha-factura-header">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="badge-factura" style="font-size: 0.92rem; padding: 4px 10px;">Factura ${escapeHtml(factura.numero_factura)}</span>
              <span style="font-size: 0.9rem; color: var(--text-muted);">${formatearFecha(factura.fecha_factura)}</span>
            </div>
            <div style="font-size: 1.15rem; font-weight: 800; color: var(--brand-primary); margin-top: 6px;">
              ${escapeHtml(factura.cliente_cooperativa || "GANAVAEX, S.COOP")}
            </div>
            ${factura.cif_cliente ? `<div style="font-size: 0.8rem; color: var(--text-muted);">CIF: ${escapeHtml(factura.cif_cliente)}</div>` : ""}
          </div>
          <div style="text-align: right;">
            <div class="liquidacion-total" style="font-size: 1.6rem; color: var(--brand-primary);">
              ${formatearMoneda(factura.total_factura)} €
            </div>
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 2px;">
              Base: ${formatearMoneda(factura.base_imponible)} € • IVA (${factura.porcentaje_iva || 10.5}%): ${formatearMoneda(factura.cuota_iva)} €
            </div>
          </div>
        </div>

        <div class="specs-grid-factura" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--md-outline-variant);">
          <div>
            <div class="spec-label">Total Canales</div>
            <div style="font-weight: 800; font-size: 1.1rem;">${factura.total_cabezas || canales.length} cabezas</div>
          </div>
          <div>
            <div class="spec-label">Kilos Canal</div>
            <div style="font-weight: 800; font-size: 1.1rem;">${formatearKg(factura.total_kilos_canal)} kg</div>
          </div>
          <div>
            <div class="spec-label">Deducciones / Portes</div>
            <div style="font-weight: 800; font-size: 1.1rem; color: #b45309;">-${formatearMoneda(factura.gastos_total)} €</div>
          </div>
          <div>
            <div class="spec-label">Fecha de Pago</div>
            <div style="font-weight: 700; font-size: 0.95rem;">${factura.fecha_pago ? formatearFecha(factura.fecha_pago) : "Pendiente"}</div>
          </div>
        </div>
      </div>

      <!-- Desglose de Canales Individuales Pesadas (Nivel 3) -->
      <div class="section-heading" style="margin: 20px 0 10px 0; font-weight: 800; font-size: 1.05rem; color: var(--brand-primary); display: flex; justify-content: space-between; align-items: center;">
        <span>Desglose de Canales (${canales.length})</span>
        <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">Pesos y cotizaciones individuales</span>
      </div>

      <div class="canales-table-wrapper" style="background: var(--md-surface-container-low, #fff); border: 1px solid var(--md-outline-variant, #e5e7eb); border-radius: 12px; overflow-x: auto;">
        <table class="canales-table" style="width: 100%; border-collapse: collapse; font-size: 0.88rem; text-align: left;">
          <thead>
            <tr style="background: var(--md-surface-container-high, #f3f4f6); border-bottom: 1.5px solid var(--md-outline-variant, #e5e7eb);">
              <th style="padding: 10px 12px;">#</th>
              <th style="padding: 10px 12px;">Artículo</th>
              <th style="padding: 10px 12px;">Peso Canal</th>
              <th style="padding: 10px 12px;">Precio (€/kg)</th>
              <th style="padding: 10px 12px;">Importe</th>
              <th style="padding: 10px 12px;">Animal (Crotal)</th>
            </tr>
          </thead>
          <tbody>
            ${
              canales.length === 0
                ? `<tr><td colspan="6" style="padding: 20px; text-align: center; color: var(--text-muted);">Sin líneas de canal registradas.</td></tr>`
                : canales.map(c => {
                    const c4 = c.crotal_4 || (c.crotal_asignado ? extraer4Digitos(c.crotal_asignado) : null);
                    return `
                      <tr style="border-bottom: 1px solid var(--md-outline-variant, #f0f0f0);">
                        <td style="padding: 10px 12px; font-weight: 700; color: var(--text-muted);">${c.linea_numero || "—"}</td>
                        <td style="padding: 10px 12px; font-weight: 600;">
                          ${escapeHtml(c.articulo || "TERNERO CEBO")}
                          ${c.referencia ? `<span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Ref: ${escapeHtml(c.referencia)}</span>` : ""}
                        </td>
                        <td style="padding: 10px 12px; font-weight: 800; color: var(--brand-primary);">${formatearKg(c.peso_canal_kg)} kg</td>
                        <td style="padding: 10px 12px; font-weight: 700;">${c.precio_unitario != null ? `${Number(c.precio_unitario).toFixed(3)} €` : "—"}</td>
                        <td style="padding: 10px 12px; font-weight: 800; color: var(--text-main);">${formatearMoneda(c.importe_linea)} €</td>
                        <td style="padding: 10px 12px;">
                          ${
                            c.crotal_asignado
                              ? `
                              <button class="clickable-chip chip-animal-link" data-action="select-animal" data-crotal="${escapeHtml(c.crotal_asignado)}" style="padding: 4px 10px; font-size: 0.82rem;">
                                <span style="font-weight: 800; color: var(--brand-primary);">${escapeHtml(c4 || "Ver")}</span>
                                <span class="chip-action">Ficha →</span>
                              </button>
                              `
                              : `<span style="color: var(--text-dim); font-size: 0.8rem;">No asignado</span>`
                          }
                        </td>
                      </tr>
                    `;
                  }).join("")
            }
          </tbody>
        </table>
      </div>

      <!-- Deducciones de la cooperativa -->
      ${gastos.length > 0 ? `
        <div style="margin-top: 20px;">
          <div class="section-heading" style="margin-bottom: 8px; font-weight: 800; font-size: 0.95rem; color: var(--text-muted);">
            Deducciones y Gastos de Cooperativa
          </div>
          <div style="background: var(--md-surface-container-low, #fff); border: 1px solid var(--md-outline-variant, #e5e7eb); border-radius: 8px; padding: 10px 14px;">
            ${gastos.map(g => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 0.86rem;">
                <span style="color: var(--text-main);">${escapeHtml(g.concepto || "Gastos / Portes")}</span>
                <span style="font-weight: 700; color: #b45309;">-${formatearMoneda(g.importe)} €</span>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;

  container.innerHTML = html;
  adjuntarEventosDetalleFactura(container);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function adjuntarEventosLiquidaciones(container) {
  // Botón Volver
  const btnVolver = container.querySelector("#btn-volver-desde-ventas");
  if (btnVolver) {
    btnVolver.addEventListener("click", () => {
      if (AppState.historial.length > 0) {
        const paso = AppState.historial.pop();
        if (paso.tipo === "movimientos") {
          window.location.hash = "#movimientos";
          return;
        }
      }
      window.location.hash = "#movimientos";
    });
  }

  // Selector de Año
  const selAnio = container.querySelector("#sel-anio-financiero");
  if (selAnio) {
    selAnio.addEventListener("change", (e) => {
      AppState.anioFinanciero = e.target.value;
      renderVistaLiquidaciones();
    });
  }

  // Selector de Categoría
  const selCat = container.querySelector("#sel-categoria-financiera");
  if (selCat) {
    selCat.addEventListener("change", (e) => {
      AppState.categoriaFinanciera = e.target.value;
      renderVistaLiquidaciones();
    });
  }

  // Selector de Perspectiva (Tesorería / Margen Técnico / Radar)
  container.querySelectorAll(".perspective-pill-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      AppState.perspectivaFinanciera = btn.dataset.perspectiva;
      renderVistaLiquidaciones();
    });
  });

  // Selección de Animal desde tablas de liquidación o devengo
  container.querySelectorAll('[data-action="select-animal"]').forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const crotal = el.dataset.crotal;
      if (crotal) {
        registrarPasoHistorial("liquidaciones", null, "Liquidaciones");
        seleccionarAnimal(crotal);
      }
    });
  });

  // Toggle de Gráficos SVG
  const btnToggleCharts = container.querySelector("#btn-toggle-charts");
  if (btnToggleCharts) {
    btnToggleCharts.addEventListener("click", () => {
      AppState.graficosExpandidos = !AppState.graficosExpandidos;
      renderVistaLiquidaciones();
    });
  }

  // Subpestañas (Facturas vs Piensos)
  container.querySelectorAll(".financial-subtab-btn:not(.radar-subtab-btn)").forEach(btn => {
    btn.addEventListener("click", () => {
      AppState.subtabFinanciera = btn.dataset.subtab;
      renderVistaLiquidaciones();
    });
  });

  // Subpestañas de Radar (Carne vs Piensos)
  container.querySelectorAll(".radar-subtab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      AppState.subseccionRadar = btn.dataset.radarSubtab;
      renderVistaLiquidaciones();
    });
  });

  // Botón Sincronizar Lonja en Vivo
  const btnSyncLonja = container.querySelector("#btn-sync-lonja");
  if (btnSyncLonja) {
    btnSyncLonja.addEventListener("click", async () => {
      btnSyncLonja.disabled = true;
      btnSyncLonja.innerHTML = `<span>⏳ Sincronizando...</span>`;
      let toast = document.getElementById("pwa-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "pwa-toast";
        toast.className = "pwa-toast";
        document.body.appendChild(toast);
      }
      toast.textContent = "🌾 Sincronizando con la Lonja de Salamanca...";
      toast.style.backgroundColor = "var(--brand-primary)";
      toast.style.color = "#ffffff";
      toast.classList.add("pwa-toast--visible");

      try {
        const token = localStorage.getItem("campo_pwa_token") || "";
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch("./api/lonja/sync", {
          method: "POST",
          headers
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Error (${res.status})`);
        }

        const data = await res.json();
        toast.textContent = `✓ ${data.message || "Cotizaciones actualizadas."}`;
        await sincronizarBaseDatosAhora(token).catch(() => {});
        setTimeout(() => {
          toast.classList.remove("pwa-toast--visible");
          renderVistaLiquidaciones();
        }, 1200);
      } catch (err) {
        console.error("[Lonja Sync] Error:", err);
        toast.textContent = `⚠️ Error al sincronizar: ${err.message}`;
        toast.style.backgroundColor = "var(--md-error, #ba1a1a)";
        setTimeout(() => toast.classList.remove("pwa-toast--visible"), 4000);
        btnSyncLonja.disabled = false;
        btnSyncLonja.innerHTML = `<span>🔄 Reintentar Lonja</span>`;
      }
    });
  }

  // Clic en tarjetas de facturas para ver detalle de canales (Nivel 3)
  container.querySelectorAll('[data-action="ver-factura"]').forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const facturaId = el.dataset.facturaId || el.closest('[data-factura-id]')?.dataset.facturaId;
      if (facturaId) {
        verDetalleLiquidacion(parseInt(facturaId, 10));
      }
    });
  });

  // Buscador de facturas
  const txtBusqueda = container.querySelector("#txt-busqueda-liquidaciones");
  if (txtBusqueda) {
    txtBusqueda.addEventListener("input", (e) => {
      AppState.filtroLiquidaciones = e.target.value;
      renderVistaLiquidaciones();
    });
  }

  const btnClear = container.querySelector("#btn-clear-liquidaciones");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      AppState.filtroLiquidaciones = "";
      renderVistaLiquidaciones();
    });
  }

  // Subir factura PDF
  const btnSubirPdf = container.querySelector("#btn-subir-factura-pdf");
  const inputPdf = container.querySelector("#input-subir-pdf-factura");
  if (btnSubirPdf && inputPdf) {
    btnSubirPdf.addEventListener("click", () => inputPdf.click());
    inputPdf.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".pdf")) {
        alert("Por favor selecciona un archivo PDF válido.");
        inputPdf.value = "";
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        alert("El archivo excede el tamaño máximo permitido (10 MB).");
        inputPdf.value = "";
        return;
      }

      let toast = document.getElementById("pwa-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "pwa-toast";
        toast.className = "pwa-toast";
        document.body.appendChild(toast);
      }
      toast.textContent = `📄 Procesando factura ${file.name}...`;
      toast.style.backgroundColor = "var(--brand-primary)";
      toast.style.color = "#ffffff";
      toast.classList.add("pwa-toast--visible");

      const fd = new FormData();
      fd.append("file", file);

      try {
        const token = localStorage.getItem("campo_pwa_token") || "";
        const headers = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch("./api/ventas/ingest-pdf", {
          method: "POST",
          headers,
          body: fd,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Error del servidor (${res.status})`);
        }

        const data = await res.json();
        toast.textContent = `✓ Factura ${data.numero_factura} subida (${data.total_cabezas} canales). Actualizando...`;

        await sincronizarBaseDatosAhora(token).catch(() => {});
        setTimeout(() => {
          toast.classList.remove("pwa-toast--visible");
          renderVistaLiquidaciones();
        }, 1500);
      } catch (err) {
        console.error("[Ventas] Error subiendo factura PDF:", err);
        toast.textContent = `⚠️ Error subiendo factura: ${err.message}`;
        toast.style.backgroundColor = "var(--md-error, #ba1a1a)";
        setTimeout(() => toast.classList.remove("pwa-toast--visible"), 4000);
      } finally {
        inputPdf.value = "";
      }
    });
  }
}

function adjuntarEventosDetalleFactura(container) {
  const btnVolver = container.querySelector("#btn-volver-a-liquidaciones");
  if (btnVolver) {
    btnVolver.addEventListener("click", () => {
      AppState.facturaSeleccionada = null;
      renderVistaLiquidaciones();
    });
  }

  container.querySelectorAll('[data-action="select-animal"]').forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const crotal = el.dataset.crotal;
      if (crotal) {
        registrarPasoHistorial("liquidaciones", AppState.facturaSeleccionada, "Liquidaciones");
        seleccionarAnimal(crotal);
      }
    });
  });
}
