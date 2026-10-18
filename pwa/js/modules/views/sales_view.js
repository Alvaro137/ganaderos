// modules/views/sales_view.js
/**
 * Cuadro de Mando Financiero y Estratégico de Explotación Ganadera.
 * Arquitectura Funcional de Alto Valor (CFO & BI):
 * 1. Liquidaciones y Ventas: Auditoría contable estricta de ingresos reales, primas vs Lonja y control de sobrepeso.
 * 2. Cebadero y Salidas: Monitorización de ganado activo en cebo, coste diario de concentrado y alerta de salida óptima.
 * 3. Tesorería y Proveedores: Cash flow bancario, auditoría de coste de piensos y gráfico de tijera agropecuaria.
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
  obtenerDistribucionPesosCanal,
  obtenerCebaderoActivo,
  obtenerSeriesTradingCarne,
  obtenerSeriesTradingTesoreria,
  calcularSimulacionTimingVenta,
  sincronizarBaseDatosAhora
} from '../db.js';
import { seleccionarAnimal } from './detail_view.js';
import {
  renderTradingChartContainer,
  initTradingChart,
  destruirTradingChart
} from '../components/trading_chart.js';

// Inicialización de estado en AppState
if (AppState.anioFinanciero === undefined) {
  AppState.anioFinanciero = "2026";
}
if (AppState.categoriaFinanciera === undefined) {
  AppState.categoriaFinanciera = "TODOS";
}
if (AppState.seccionFinanciera === undefined) {
  AppState.seccionFinanciera = "liquidaciones"; // "liquidaciones" | "cebadero" | "tesoreria"
}
if (AppState.usarEstimacionesLonja === undefined) {
  AppState.usarEstimacionesLonja = false; // Por defecto modo estrictamente real contable
}
if (AppState.simulacionTiming === undefined) {
  AppState.simulacionTiming = {
    pesoCanalActual: 330,
    diasRetraso: 21,
    gmdVivo: 1.35,
    costeDiarioPienso: 2.65,
    precioActualKg: 7.15,
    precioEsperadoKg: 7.20,
    esMacho: true
  };
}

let ultimasSeriesTrading = {
  carne: [],
  tesoreria: []
};

/**
 * Renderiza la vista principal del cuadro de mando financiero.
 */
export function renderVistaLiquidaciones() {
  const container = document.getElementById("app-container");
  if (!container) return;

  AppState.tabActual = "ventas";
  AppState.crotalSeleccionado = null;
  AppState.corralSeleccionado = null;

  destruirTradingChart("chart-carne-tv");
  destruirTradingChart("chart-tesoreria-tv");

  // Si hay una liquidación seleccionada, mostrar vista de detalle (Nivel 3)
  if (AppState.facturaSeleccionada) {
    verDetalleLiquidacion(AppState.facturaSeleccionada, false);
    return;
  }

  const aniosDisponibles = obtenerAniosDisponiblesFinancieros();
  if (AppState.anioFinanciero !== "TODOS" && !aniosDisponibles.includes(AppState.anioFinanciero)) {
    AppState.anioFinanciero = aniosDisponibles[0] || "TODOS";
  }

  const resumen = obtenerResumenFinancieroGlobal(
    AppState.anioFinanciero,
    AppState.categoriaFinanciera,
    AppState.usarEstimacionesLonja
  );

  const seccion = AppState.seccionFinanciera || "liquidaciones";

  container.innerHTML = `
    <div class="financial-dashboard-container" style="max-width: 1040px; margin: 0 auto; padding: 16px 12px 60px;">
      
      <!-- CABECERA Y SELECTOR DE CONTEXTO UNIFICADO -->
      <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <h2 style="font-size: 1.35rem; font-weight: 800; color: var(--text-main); margin: 0;">Centro Financiero y Mercado</h2>
            <p style="font-size: 0.82rem; color: var(--text-muted); margin: 2px 0 0;">Control de liquidaciones, cebadero activo y cotizaciones de Lonja</p>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button id="btn-sync-ventas" class="btn-sync-icon" title="Sincronizar base de datos" style="padding: 8px 12px; border-radius: var(--md-shape-md); border: 1px solid var(--md-outline-variant); background: var(--md-surface-container-lowest); cursor: pointer;">
              🔄 <span style="font-size: 0.8rem; font-weight: 600;">Sincronizar</span>
            </button>
            <label for="input-subir-factura" id="btn-subir-factura-pdf" class="btn-primary" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; font-size: 0.82rem; font-weight: 700; border-radius: var(--md-shape-md); cursor: pointer;">
              <span>+ Subir Factura PDF</span>
              <input type="file" id="input-subir-factura" accept="application/pdf" style="display: none;" />
            </label>
          </div>
        </div>

        <!-- BARRA DE CONTROLES: CAMPAÑA, LÍNEA Y MODO -->
        <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; background: var(--md-surface-container-lowest); padding: 10px 14px; border-radius: var(--md-shape-lg); border: 1px solid var(--md-outline-variant); box-shadow: var(--md-elevation-1);">
          
          <!-- Filtro de Campaña -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.78rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Campaña:</span>
            <select id="select-anio-financiero" class="financial-select-pill" style="padding: 6px 12px; border-radius: var(--md-shape-full); border: 1px solid var(--md-outline-variant); font-size: 0.85rem; font-weight: 700; background: var(--md-surface-container-low); color: var(--text-main); cursor: pointer;">
              <option value="TODOS" ${AppState.anioFinanciero === "TODOS" ? "selected" : ""}>Histórico Completo</option>
              ${aniosDisponibles.map(a => `
                <option value="${a}" ${AppState.anioFinanciero === a ? "selected" : ""}>Campaña ${a}</option>
              `).join("")}
            </select>
          </div>

          <!-- Filtro de Línea Productiva -->
          <div style="display: flex; align-items: center; gap: 6px; overflow-x: auto;">
            <button class="pill-cat-btn ${AppState.categoriaFinanciera === 'TODOS' ? 'active' : ''}" data-cat="TODOS" style="padding: 6px 12px; border-radius: var(--md-shape-full); font-size: 0.78rem; font-weight: 700; border: 1px solid ${AppState.categoriaFinanciera === 'TODOS' ? 'var(--md-primary)' : 'var(--md-outline-variant)'}; background: ${AppState.categoriaFinanciera === 'TODOS' ? 'var(--md-primary)' : 'transparent'}; color: ${AppState.categoriaFinanciera === 'TODOS' ? 'var(--md-on-primary)' : 'var(--text-main)'}; cursor: pointer;">
              Todo el Ganado
            </button>
            <button class="pill-cat-btn ${AppState.categoriaFinanciera === 'CEBO' ? 'active' : ''}" data-cat="CEBO" style="padding: 6px 12px; border-radius: var(--md-shape-full); font-size: 0.78rem; font-weight: 700; border: 1px solid ${AppState.categoriaFinanciera === 'CEBO' ? 'var(--md-primary)' : 'var(--md-outline-variant)'}; background: ${AppState.categoriaFinanciera === 'CEBO' ? 'var(--md-primary)' : 'transparent'}; color: ${AppState.categoriaFinanciera === 'CEBO' ? 'var(--md-on-primary)' : 'var(--text-main)'}; cursor: pointer;">
              Cebadero
            </button>
            <button class="pill-cat-btn ${AppState.categoriaFinanciera === 'DESVIEJE' ? 'active' : ''}" data-cat="DESVIEJE" style="padding: 6px 12px; border-radius: var(--md-shape-full); font-size: 0.78rem; font-weight: 700; border: 1px solid ${AppState.categoriaFinanciera === 'DESVIEJE' ? 'var(--md-primary)' : 'var(--md-outline-variant)'}; background: ${AppState.categoriaFinanciera === 'DESVIEJE' ? 'var(--md-primary)' : 'transparent'}; color: ${AppState.categoriaFinanciera === 'DESVIEJE' ? 'var(--md-on-primary)' : 'var(--text-main)'}; cursor: pointer;">
              Desvieje
            </button>
          </div>

          <!-- Conmutador de Modo: Real Facturado vs Proyección Lonja -->
          <div style="display: flex; align-items: center; background: var(--md-surface-container-high); border-radius: var(--md-shape-full); padding: 2px;">
            <button id="btn-modo-real" class="btn-modo-pill ${!AppState.usarEstimacionesLonja ? 'active' : ''}" style="padding: 5px 12px; border-radius: var(--md-shape-full); font-size: 0.76rem; font-weight: 700; border: none; background: ${!AppState.usarEstimacionesLonja ? 'var(--md-surface-container-lowest)' : 'transparent'}; color: ${!AppState.usarEstimacionesLonja ? 'var(--md-primary)' : 'var(--text-muted)'}; box-shadow: ${!AppState.usarEstimacionesLonja ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}; cursor: pointer;">
              🏛️ Real Facturado
            </button>
            <button id="btn-modo-proyeccion" class="btn-modo-pill ${AppState.usarEstimacionesLonja ? 'active' : ''}" style="padding: 5px 12px; border-radius: var(--md-shape-full); font-size: 0.76rem; font-weight: 700; border: none; background: ${AppState.usarEstimacionesLonja ? 'var(--md-primary)' : 'transparent'}; color: ${AppState.usarEstimacionesLonja ? 'var(--md-on-primary)' : 'var(--text-muted)'}; box-shadow: ${AppState.usarEstimacionesLonja ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}; cursor: pointer;">
              📈 Proyección Lonja
            </button>
          </div>
        </div>

        <!-- 3 PESTAÑAS PRINCIPALES DE NEGOCIO -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 4px;">
          <button class="nav-tab-btn ${seccion === 'liquidaciones' ? 'active' : ''}" data-seccion="liquidaciones" style="padding: 10px 8px; border-radius: var(--md-shape-md); border: none; background: ${seccion === 'liquidaciones' ? 'var(--md-primary-container)' : 'var(--md-surface-container-lowest)'}; color: ${seccion === 'liquidaciones' ? 'var(--md-on-primary-container)' : 'var(--text-muted)'}; font-size: 0.85rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s ease; border-bottom: 3px solid ${seccion === 'liquidaciones' ? 'var(--md-primary)' : 'transparent'};">
            📄 Liquidaciones
          </button>
          <button class="nav-tab-btn ${seccion === 'cebadero' ? 'active' : ''}" data-seccion="cebadero" style="padding: 10px 8px; border-radius: var(--md-shape-md); border: none; background: ${seccion === 'cebadero' ? 'var(--md-primary-container)' : 'var(--md-surface-container-lowest)'}; color: ${seccion === 'cebadero' ? 'var(--md-on-primary-container)' : 'var(--text-muted)'}; font-size: 0.85rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s ease; border-bottom: 3px solid ${seccion === 'cebadero' ? 'var(--md-primary)' : 'transparent'};">
            🐂 Cebadero Activo
          </button>
          <button class="nav-tab-btn ${seccion === 'tesoreria' ? 'active' : ''}" data-seccion="tesoreria" style="padding: 10px 8px; border-radius: var(--md-shape-md); border: none; background: ${seccion === 'tesoreria' ? 'var(--md-primary-container)' : 'var(--md-surface-container-lowest)'}; color: ${seccion === 'tesoreria' ? 'var(--md-on-primary-container)' : 'var(--text-muted)'}; font-size: 0.85rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s ease; border-bottom: 3px solid ${seccion === 'tesoreria' ? 'var(--md-primary)' : 'transparent'};">
            💰 Tesorería y Pienso
          </button>
        </div>
      </div>

      <!-- CONTENIDO DE LA SECCIÓN SELECCIONADA -->
      ${renderContenidoSeccion(seccion, resumen)}

    </div>
  `;

  vincularEventosDashboard();
}

/**
 * Renderiza el contenido específico según la pestaña activa.
 */
function renderContenidoSeccion(seccion, resumen) {
  if (seccion === "cebadero") {
    return renderSeccionCebadero();
  }
  if (seccion === "tesoreria") {
    return renderSeccionTesoreria(resumen);
  }
  return renderSeccionLiquidaciones(resumen);
}

/**
 * SECCIÓN 1: LIQUIDACIONES Y VENTAS (Real vs Lonja Salamanca)
 */
function renderSeccionLiquidaciones(resumen) {
  const tieneFacturas = resumen.total_facturas > 0;
  const primaLonja = resumen.diferencial_lonja_kg;
  const primaBadge = primaLonja != null
    ? `<span style="font-size: 0.74rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: ${primaLonja >= 0 ? 'rgba(34, 197, 94, 0.18)' : 'rgba(239, 68, 68, 0.18)'}; color: ${primaLonja >= 0 ? '#15803d' : '#b91c1c'};">${primaLonja >= 0 ? '▲ +' : '▼ '}${primaLonja.toFixed(2)} €/kg vs Lonja</span>`
    : "";

  const distribucionPesos = obtenerDistribucionPesosCanal(AppState.anioFinanciero, AppState.categoriaFinanciera);
  const liquidaciones = obtenerLiquidaciones({ anio: AppState.anioFinanciero, categoria: AppState.categoriaFinanciera });

  return `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      
      <!-- Banners de Estado y Conciliación -->
      ${!AppState.usarEstimacionesLonja && resumen.salidas_sin_factura > 0 ? `
        <div style="background: rgba(234, 88, 12, 0.08); border-left: 4px solid #ea580c; border-radius: var(--md-shape-sm); padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div>
            <div style="font-weight: 700; font-size: 0.85rem; color: #9a3412;">⚠️ Conciliación: ${resumen.salidas_sin_factura} salidas a matadero en censo sin factura digitalizada</div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 1px;">Los ingresos reales corresponden estrictamente a las facturas cargadas en el sistema.</div>
          </div>
          <button id="btn-activar-lonja-prompt" style="padding: 5px 10px; border-radius: var(--md-shape-sm); border: 1px solid #ea580c; background: #ea580c; color: #fff; font-size: 0.76rem; font-weight: 700; cursor: pointer;">
            Ver con Proyección Lonja
          </button>
        </div>
      ` : ""}

      ${AppState.usarEstimacionesLonja ? `
        <div style="background: rgba(30, 94, 58, 0.08); border-left: 4px solid var(--md-primary); border-radius: var(--md-shape-sm); padding: 10px 14px; font-size: 0.82rem; color: var(--text-main);">
          <strong style="color: var(--md-primary);">~ Proyección Lonja Activa:</strong> Se proyectan ${formatearMoneda(resumen.ingresos_estimados)} € para ${resumen.salidas_estimadas} cabezas salientes en censo según las cotizaciones semanales de la Lonja de Salamanca.
        </div>
      ` : ""}

      <!-- 4 TARJETAS KPI EJECUTIVAS -->
      <div class="kpis-liquidaciones-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;">
        
        <!-- Facturación Total -->
        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; box-shadow: var(--md-elevation-1);">
          <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Venta Neta Carne</div>
          <div style="font-size: 1.55rem; font-weight: 900; color: var(--chart-carne); margin: 4px 0 2px;">
            ${formatearMoneda(resumen.ingresos_carne)} €
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            ${resumen.total_cabezas_carne} cabezas · ${formatearKg(resumen.total_kilos_canal)} kg canal
          </div>
        </div>

        <!-- Cotización Media vs Lonja -->
        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; box-shadow: var(--md-elevation-1);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Cotización Canal</span>
            ${primaBadge}
          </div>
          <div style="font-size: 1.55rem; font-weight: 900; color: var(--text-main); margin: 4px 0 2px;">
            ${resumen.cotizacion_media_canal > 0 ? `${resumen.cotizacion_media_canal.toFixed(2)} €/kg` : '—'}
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            ${resumen.precio_lonja_medio != null ? `Lonja Salamanca: ${resumen.precio_lonja_medio.toFixed(2)} €/kg` : 'Base sin cotización lonja'}
          </div>
        </div>

        <!-- Margen por Cabeza -->
        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; box-shadow: var(--md-elevation-1);">
          <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Margen por Cabeza</div>
          <div style="font-size: 1.55rem; font-weight: 900; color: ${resumen.margen_medio_cabeza >= 0 ? '#1b5e20' : '#ba1a1a'}; margin: 4px 0 2px;">
            ${resumen.margen_medio_cabeza >= 0 ? '+' : ''}${formatearMoneda(resumen.margen_medio_cabeza)} €
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            ${resumen.ratio_carne_pienso ? `Retorno: ${resumen.ratio_carne_pienso.toFixed(2)}€ carne / 1€ pienso` : 'Sin compras en periodo'}
          </div>
        </div>

        <!-- Control de Calidad y Sobrepeso -->
        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; box-shadow: var(--md-elevation-1);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Peso Medio Canal</span>
            ${resumen.cabezas_sobrepeso > 0 ? `
              <span style="font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.18); color: #b91c1c;">⚠️ ${resumen.cabezas_sobrepeso} sobrepeso</span>
            ` : `
              <span style="font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(34, 197, 94, 0.18); color: #15803d;">✓ Rango óptimo</span>
            `}
          </div>
          <div style="font-size: 1.55rem; font-weight: 900; color: var(--text-main); margin: 4px 0 2px;">
            ${resumen.peso_medio_canal > 0 ? `${resumen.peso_medio_canal.toFixed(1)} kg` : '—'}
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            ${resumen.cabezas_sobrepeso > 0 ? 'Castigo Lonja >350kg aplicado' : 'Canales en estándar comercial'}
          </div>
        </div>

      </div>

      <!-- GRÁFICO INTERACTIVO: PRECIO COBRADO vs LONJA DE SALAMANCA -->
      <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 16px; box-shadow: var(--md-elevation-1);">
        ${renderTradingChartContainer({
          id: "chart-carne-tv",
          titulo: "Evolución Precio Cobrado vs Lonja de Salamanca (€/kg Canal)",
          subtitulo: "Comparativa directa entre el precio real cobrado por la explotación y la cotización oficial de Lonja",
          seriesDefs: [
            { id: "precio_granja", label: "Cobrado Granja", color: "#15803d", defaultVisible: true },
            { id: "anojo_extra", label: "Lonja Añojo Extra", color: "#2563eb", defaultVisible: true },
            { id: "anojo_pesado", label: "Lonja Añojo Pesado (>350kg)", color: "#9333ea", defaultVisible: false },
            { id: "ternera_extra", label: "Lonja Ternera Extra", color: "#0891b2", defaultVisible: false },
            { id: "vaca_desvieje", label: "Lonja Vaca Desvieje", color: "#d97706", defaultVisible: false }
          ],
          altura: 320
        })}
      </div>

      <!-- CONTROL DE CALIDAD Y DISTRIBUCIÓN DE CANALES -->
      ${distribucionPesos.length > 0 ? `
        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 16px; box-shadow: var(--md-elevation-1);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); margin: 0;">Estructura de Calidad de Canales</h4>
            <span style="font-size: 0.78rem; color: var(--text-muted);">Clasificación comercial por peso</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;">
            ${distribucionPesos.map(d => {
              const esSobrepeso = d.rango_peso.includes("> 350");
              const bg = esSobrepeso ? 'rgba(239, 68, 68, 0.08)' : 'var(--md-surface-container-low)';
              const border = esSobrepeso ? '#fca5a5' : 'var(--md-outline-variant)';
              const color = esSobrepeso ? '#b91c1c' : 'var(--text-main)';
              return `
                <div style="background: ${bg}; border: 1px solid ${border}; border-radius: var(--md-shape-md); padding: 10px 12px;">
                  <div style="font-size: 0.75rem; font-weight: 700; color: ${color};">${escapeHtml(d.rango_peso)}</div>
                  <div style="font-size: 1.25rem; font-weight: 800; color: ${color}; margin: 2px 0;">
                    ${d.total_canales} cab <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">(${d.porcentaje}%)</span>
                  </div>
                  <div style="font-size: 0.76rem; color: var(--text-muted);">
                    Media: ${d.peso_medio} kg · ${d.precio_medio_kg.toFixed(2)} €/kg
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      ` : ""}

      <!-- LISTADO DE LIQUIDACIONES Y FACTURAS -->
      <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 16px; box-shadow: var(--md-elevation-1);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); margin: 0;">Facturas de Liquidación Auditadas (${liquidaciones.length})</h4>
            <p style="font-size: 0.78rem; color: var(--text-muted); margin: 1px 0 0;">Desglose de cheques y cobros de matadero/cooperativa</p>
          </div>
        </div>

        ${liquidaciones.length === 0 ? `
          <div style="padding: 32px 16px; text-align: center; color: var(--text-muted);">
            <div style="font-size: 2rem; margin-bottom: 8px;">📂</div>
            <div style="font-weight: 700; font-size: 0.95rem;">No constan facturas digitalizadas para este periodo</div>
            <div style="font-size: 0.82rem; margin-top: 4px;">Usa el botón "+ Subir Factura PDF" para cargar la liquidación correspondiente.</div>
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${liquidaciones.map(liq => `
              <div class="liquidacion-item-card liquidacion-card" data-factura-id="${liq.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: var(--md-shape-md); background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); cursor: pointer; transition: all 0.15s ease;">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-weight: 800; font-size: 0.92rem; color: var(--md-primary);">${escapeHtml(liq.numero_factura || `Factura #${liq.id}`)}</span>
                    <span style="font-size: 0.76rem; color: var(--text-muted);">${formatearFecha(liq.fecha_factura)}</span>
                  </div>
                  <div style="font-size: 0.8rem; color: var(--text-muted);">
                    ${escapeHtml(liq.cliente_cooperativa || "Liquidación")} · ${liq.total_cabezas || 0} cab · ${formatearKg(liq.total_kilos_canal || 0)} kg canal
                  </div>
                </div>

                <div style="display: flex; align-items: center; gap: 14px;">
                  <div style="text-align: right;">
                    <div style="font-size: 1.05rem; font-weight: 800; color: var(--chart-carne);">${formatearMoneda(liq.total_factura)} €</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${liq.total_kilos_canal > 0 ? `${(liq.base_imponible / liq.total_kilos_canal).toFixed(2)} €/kg` : '—'}</div>
                  </div>
                  <button class="btn-ver-canales" style="border: 1px solid var(--md-primary); background: transparent; color: var(--md-primary); border-radius: var(--md-shape-sm); padding: 5px 10px; font-size: 0.76rem; font-weight: 700; cursor: pointer;">
                    Ver Canales →
                  </button>
                </div>
              </div>
            `).join("")}
          </div>
        `}
      </div>

    </div>
  `;
}

/**
 * SECCIÓN 2: CEBADERO ACTIVO Y SALIDAS (Operativo / Técnico)
 */
function renderSeccionCebadero() {
  const cebadero = obtenerCebaderoActivo();

  return `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      
      <!-- 3 TARJETAS KPI DE CEBADERO -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;">
        
        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; box-shadow: var(--md-elevation-1);">
          <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Animales en Cebo Hoy</div>
          <div style="font-size: 1.55rem; font-weight: 900; color: var(--md-primary); margin: 4px 0 2px;">
            ${cebadero.total_cabezas} animales
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            Estancia media: ${cebadero.estancia_media_dias} días en corral
          </div>
        </div>

        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; box-shadow: var(--md-elevation-1);">
          <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Coste Diario de Concentrado</div>
          <div style="font-size: 1.55rem; font-weight: 900; color: var(--chart-pienso); margin: 4px 0 2px;">
            ${formatearMoneda(cebadero.coste_diario_total)} € / día
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            Acumulado lote actual: ${formatearMoneda(cebadero.coste_acumulado_lote)} €
          </div>
        </div>

        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; box-shadow: var(--md-elevation-1);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Salidas Inminentes</span>
            ${cebadero.cabezas_riesgo_sobrepeso > 0 ? `
              <span style="font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.18); color: #b91c1c;">⚠️ Salida Urgente</span>
            ` : `
              <span style="font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(34, 197, 94, 0.18); color: #15803d;">🟢 En Crecimiento</span>
            `}
          </div>
          <div style="font-size: 1.55rem; font-weight: 900; color: ${cebadero.cabezas_riesgo_sobrepeso > 0 ? '#b91c1c' : 'var(--text-main)'}; margin: 4px 0 2px;">
            ${cebadero.cabezas_riesgo_sobrepeso} cabezas
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            ${cebadero.cabezas_riesgo_sobrepeso > 0 ? 'Riesgo castigo por peso (>335 kg canal)' : 'Sin animales en riesgo de sobrepeso'}
          </div>
        </div>

      </div>

      <!-- BANNER DE RECOMENDACIÓN TÉCNICA -->
      <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; box-shadow: var(--md-elevation-1);">
        <div>
          <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); margin: 0;">¿Cuándo mandar los terneros al matadero?</h4>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin: 2px 0 0;">
            A partir de 345 kg canal o ~170 días de cebo, el índice de conversión empeora y el sobrepeso (>350kg) se penaliza con -0,25 €/kg.
          </p>
        </div>
        <button id="btn-abrir-simulador-timing" class="btn-primary" style="padding: 8px 16px; border-radius: var(--md-shape-md); font-size: 0.82rem; font-weight: 700; cursor: pointer;">
          ⏱️ Simular Retraso de Venta
        </button>
      </div>

      <!-- LISTA DE ANIMALES EN CEBO -->
      <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 16px; box-shadow: var(--md-elevation-1);">
        <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); margin: 0 0 12px;">Censo de Animales en Cebadero (${cebadero.animales.length})</h4>

        ${cebadero.animales.length === 0 ? `
          <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
            No hay animales registrados actualmente en el corral de cebadero.
          </div>
        ` : `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px;">
            ${cebadero.animales.map(a => {
              let badgeColor = "#15803d";
              let badgeBg = "rgba(34, 197, 94, 0.15)";
              let badgeText = "🟢 En Crecimiento";

              if (a.estado_salida === "SOBREPESO") {
                badgeColor = "#b91c1c";
                badgeBg = "rgba(239, 68, 68, 0.18)";
                badgeText = "🔴 Sobrepeso Inminente";
              } else if (a.estado_salida === "SACRIFICAR") {
                badgeColor = "#c2410c";
                badgeBg = "rgba(234, 88, 12, 0.15)";
                badgeText = "🟡 Salida Recomendada";
              }

              return `
                <div style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-md); padding: 12px; display: flex; flex-direction: column; gap: 6px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <button class="chip-crotal-link btn-ver-animal-cebo" data-crotal="${a.crotal}" style="font-size: 0.88rem; font-weight: 800;">
                      🐄 ${escapeHtml(a.crotal_4)}
                    </button>
                    <span style="font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: ${badgeBg}; color: ${badgeColor};">
                      ${badgeText}
                    </span>
                  </div>

                  <div style="font-size: 0.8rem; color: var(--text-muted); display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
                    <div>Estancia est.: <strong>${a.dias_estancia_estimados} días</strong></div>
                    <div>Peso canal est.: <strong>${a.peso_canal_estimado} kg</strong></div>
                    <div>Sexo: <strong>${escapeHtml(a.sexo || "—")}</strong></div>
                    <div>Raza: <strong>${escapeHtml(a.raza || "—")}</strong></div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `}
      </div>

    </div>
  `;
}

/**
 * SECCIÓN 3: TESORERÍA Y PIENSO (Cash Flow Real & Proveedores)
 */
function renderSeccionTesoreria(resumen) {
  const serieMensual = obtenerSerieMensualFinanciera(
    AppState.anioFinanciero,
    AppState.categoriaFinanciera,
    AppState.usarEstimacionesLonja
  );
  const compras = obtenerComprasAlimento();

  return `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      
      <!-- 3 TARJETAS KPI DE TESORERÍA -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;">
        
        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; box-shadow: var(--md-elevation-1);">
          <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Saldo Neto de Caja</div>
          <div style="font-size: 1.55rem; font-weight: 900; color: ${resumen.margen_bruto_alimentacion >= 0 ? '#1b5e20' : '#ba1a1a'}; margin: 4px 0 2px;">
            ${resumen.margen_bruto_alimentacion >= 0 ? '+' : ''}${formatearMoneda(resumen.margen_bruto_alimentacion)} €
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            Cobrado: ${formatearMoneda(resumen.ingresos_carne)} € | Pienso: ${formatearMoneda(resumen.gasto_pienso)} €
          </div>
        </div>

        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; box-shadow: var(--md-elevation-1);">
          <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Coste Medio del Concentrado</div>
          <div style="font-size: 1.55rem; font-weight: 900; color: var(--chart-pienso); margin: 4px 0 2px;">
            ${resumen.coste_medio_pienso_t > 0 ? `${resumen.coste_medio_pienso_t.toFixed(0)} € / t` : '—'}
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            ${resumen.coste_medio_pienso_kg > 0 ? `${resumen.coste_medio_pienso_kg.toFixed(3)} €/kg` : 'Sin compras'} en ${resumen.total_compras_pienso} albaranes
          </div>
        </div>

        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; box-shadow: var(--md-elevation-1);">
          <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Volumen Total Comprado</div>
          <div style="font-size: 1.55rem; font-weight: 900; color: var(--text-main); margin: 4px 0 2px;">
            ${formatearKg(resumen.kilos_pienso)} kg
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            ${resumen.ratio_carne_pienso ? `Ratio: ${resumen.ratio_carne_pienso.toFixed(2)}€ carne / 1€ pienso` : 'Auditoría de compras'}
          </div>
        </div>

      </div>

      <!-- GRÁFICO TIJERA AGROPECUARIA: COBROS CARNE vs GASTOS PIENSO -->
      <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 16px; box-shadow: var(--md-elevation-1);">
        ${renderTradingChartContainer({
          id: "chart-tesoreria-tv",
          titulo: "Evolución de Tesorería Mensual (Ingresos Carne vs Compras Pienso)",
          subtitulo: "Flujo de caja bancario mensual y saldo neto operativo de la explotación",
          seriesDefs: [
            { id: "ingresos_carne", label: "Cobros Carne (€)", color: "#15803d", defaultVisible: true },
            { id: "gastos_pienso", label: "Pagos Pienso (€)", color: "#ea580c", defaultVisible: true },
            { id: "margen_neto", label: "Saldo Neto Mes (€)", color: "#2563eb", defaultVisible: true }
          ],
          altura: 300
        })}
      </div>

      <!-- TABLA DESGLOSE MENSUAL DE TESORERÍA -->
      <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 16px; box-shadow: var(--md-elevation-1);">
        <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); margin: 0 0 12px;">Desglose Mensual de Caja (${serieMensual.length} meses)</h4>

        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem; text-align: right;">
            <thead>
              <tr style="border-bottom: 2px solid var(--md-outline-variant); color: var(--text-muted); font-size: 0.76rem; text-transform: uppercase;">
                <th style="text-align: left; padding: 6px 8px;">Mes</th>
                <th style="text-align: center; padding: 6px 8px;">Estado</th>
                <th style="padding: 6px 8px;">Carne (€)</th>
                <th style="padding: 6px 8px;">Pienso (€)</th>
                <th style="padding: 6px 8px;">Saldo Neto (€)</th>
                <th style="padding: 6px 8px;">€/kg Canal</th>
              </tr>
            </thead>
            <tbody>
              ${serieMensual.map(m => {
                let badgeHtml = "";
                if (m.estimado) {
                  badgeHtml = `<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: rgba(148, 163, 184, 0.2); color: #475569; font-weight: 700;">~ Est. (${m.cabezas} cab)</span>`;
                } else if (m.esReal) {
                  badgeHtml = `<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: rgba(34, 197, 94, 0.18); color: #15803d; font-weight: 800;">✓ Real (${m.cabezas} cab)</span>`;
                } else if (m.facturas_pendientes) {
                  badgeHtml = `<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: rgba(234, 88, 12, 0.15); color: #c2410c; font-weight: 700;">⚠️ ${m.salidas_censo || 0} sal. s/fact</span>`;
                } else {
                  badgeHtml = `<span style="font-size: 0.72rem; color: var(--text-muted);">—</span>`;
                }

                const saldoColor = m.margen_neto >= 0 ? '#1b5e20' : '#ba1a1a';

                return `
                  <tr style="border-bottom: 1px solid var(--md-outline-variant);">
                    <td style="text-align: left; font-weight: 700; padding: 7px 8px;">${escapeHtml(m.mes)}</td>
                    <td style="text-align: center; padding: 7px 8px;">${badgeHtml}</td>
                    <td style="padding: 7px 8px; font-weight: 600; color: var(--chart-carne);">${formatearMoneda(m.ingresos_carne)} €</td>
                    <td style="padding: 7px 8px; font-weight: 600; color: var(--chart-pienso);">${formatearMoneda(m.gasto_pienso)} €</td>
                    <td style="padding: 7px 8px; font-weight: 800; color: ${saldoColor};">${m.margen_neto >= 0 ? '+' : ''}${formatearMoneda(m.margen_neto)} €</td>
                    <td style="padding: 7px 8px; color: var(--text-muted);">${m.precio_canal_medio != null ? `${m.precio_canal_medio.toFixed(2)} €` : '—'}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <!-- LISTA DE ALBARANES DE PIENSO -->
      <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 16px; box-shadow: var(--md-elevation-1);">
        <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); margin: 0 0 12px;">Albaranes de Alimentación (${compras.length})</h4>

        ${compras.length === 0 ? `
          <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
            No hay compras registradas en este periodo.
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${compras.slice(0, 15).map(c => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: var(--md-shape-md); background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant);">
                <div>
                  <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);">${escapeHtml(c.alimento || "Pienso")}</div>
                  <div style="font-size: 0.76rem; color: var(--text-muted);">${formatearFecha(c.fecha)} · ${formatearKg(c.kg)} kg</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-weight: 800; font-size: 0.95rem; color: var(--chart-pienso);">${formatearMoneda(c.importe)} €</div>
                  <div style="font-size: 0.74rem; color: var(--text-muted);">${c.precio_kg > 0 ? `${c.precio_kg.toFixed(3)} €/kg` : '—'}</div>
                </div>
              </div>
            `).join("")}
          </div>
        `}
      </div>

    </div>
  `;
}

/**
 * Vincula todos los eventos interactivos del dashboard.
 */
function vincularEventosDashboard() {
  // Selector de Campaña
  const selectAnio = document.getElementById("select-anio-financiero");
  if (selectAnio) {
    selectAnio.addEventListener("change", (e) => {
      AppState.anioFinanciero = e.target.value;
      renderVistaLiquidaciones();
    });
  }

  // Filtros de Línea Productiva (Pills)
  document.querySelectorAll(".pill-cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      AppState.categoriaFinanciera = btn.dataset.cat || "TODOS";
      renderVistaLiquidaciones();
    });
  });

  // Conmutadores de Modo: Real vs Proyección
  const btnModoReal = document.getElementById("btn-modo-real");
  if (btnModoReal) {
    btnModoReal.addEventListener("click", () => {
      AppState.usarEstimacionesLonja = false;
      renderVistaLiquidaciones();
    });
  }

  const btnModoProyeccion = document.getElementById("btn-modo-proyeccion");
  if (btnModoProyeccion) {
    btnModoProyeccion.addEventListener("click", () => {
      AppState.usarEstimacionesLonja = true;
      renderVistaLiquidaciones();
    });
  }

  const btnActivarLonjaPrompt = document.getElementById("btn-activar-lonja-prompt");
  if (btnActivarLonjaPrompt) {
    btnActivarLonjaPrompt.addEventListener("click", () => {
      AppState.usarEstimacionesLonja = true;
      renderVistaLiquidaciones();
    });
  }

  // Navegación de Pestañas Principales
  document.querySelectorAll(".nav-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      AppState.seccionFinanciera = btn.dataset.seccion || "liquidaciones";
      renderVistaLiquidaciones();
    });
  });

  // Click en liquidación para ir a detalle (Nivel 3)
  document.querySelectorAll(".liquidacion-item-card").forEach(card => {
    card.addEventListener("click", () => {
      const fid = card.dataset.facturaId;
      if (fid) {
        AppState.facturaSeleccionada = fid;
        registrarPasoHistorial("ventas", { facturaId: fid });
        verDetalleLiquidacion(fid, false);
      }
    });
  });

  document.querySelectorAll(".btn-ver-canales").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = btn.closest(".liquidacion-item-card");
      const fid = card ? card.dataset.facturaId : null;
      if (fid) {
        AppState.facturaSeleccionada = fid;
        registrarPasoHistorial("ventas", { facturaId: fid });
        verDetalleLiquidacion(fid, false);
      }
    });
  });

  // Botón abrir simulador de timing
  const btnTiming = document.getElementById("btn-abrir-simulador-timing");
  if (btnTiming) {
    btnTiming.addEventListener("click", () => {
      abrirModalSimuladorTiming();
    });
  }

  // Enlaces directos a animal desde cebadero
  document.querySelectorAll(".btn-ver-animal-cebo").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const crotal = btn.dataset.crotal;
      if (crotal) {
        seleccionarAnimal(crotal);
      }
    });
  });

  // Botón de sincronización
  const btnSync = document.getElementById("btn-sync-ventas");
  if (btnSync) {
    btnSync.addEventListener("click", async () => {
      btnSync.disabled = true;
      btnSync.innerHTML = "⏳ Sincronizando...";
      try {
        await sincronizarBaseDatosAhora();
        renderVistaLiquidaciones();
      } catch (err) {
        alert("Error sincronizando base de datos: " + (err.message || err));
      } finally {
        btnSync.disabled = false;
        btnSync.innerHTML = "🔄 Sincronizar";
      }
    });
  }

  // Inicializar gráficos TradingView de la sección activa
  setTimeout(() => {
    inicializarGraficosActivos();
  }, 60);
}

/**
 * Inicializa los gráficos interactivos de TradingView según la pestaña activa.
 */
function inicializarGraficosActivos() {
  const seccion = AppState.seccionFinanciera || "liquidaciones";

  if (seccion === "liquidaciones") {
    const el = document.getElementById("chart-carne-tv");
    if (!el) return;

    try {
      const seriesTrading = obtenerSeriesTradingCarne(AppState.anioFinanciero, AppState.usarEstimacionesLonja);
      ultimasSeriesTrading.carne = seriesTrading;

      const seriesDefs = [
        { id: "precio_granja", name: "Cobrado Granja (€/kg)", type: "Line", color: "#15803d", lineWidth: 3, data: seriesTrading.precio_granja || [], defaultVisible: true },
        { id: "anojo_extra", name: "Lonja Añojo Extra (€/kg)", type: "Line", color: "#2563eb", lineWidth: 2, lineStyle: 2, data: seriesTrading.anojo_extra || [], defaultVisible: true },
        { id: "anojo_pesado", name: "Lonja Añojo Pesado (€/kg)", type: "Line", color: "#9333ea", lineWidth: 2, lineStyle: 2, data: seriesTrading.anojo_pesado || [], defaultVisible: false },
        { id: "ternera_extra", name: "Lonja Ternera Extra (€/kg)", type: "Line", color: "#0891b2", lineWidth: 2, lineStyle: 2, data: seriesTrading.ternera_extra || [], defaultVisible: false },
        { id: "vaca_desvieje", name: "Lonja Vaca Desvieje (€/kg)", type: "Line", color: "#d97706", lineWidth: 2, lineStyle: 2, data: seriesTrading.vaca_desvieje || [], defaultVisible: false }
      ];

      initTradingChart({
        id: "chart-carne-tv",
        seriesDefs,
        precioUnitario: "€/kg"
      });
    } catch (e) {
      console.warn("[TradingChart] Error inicializando gráfico de carne:", e);
    }
  } else if (seccion === "tesoreria") {
    const el = document.getElementById("chart-tesoreria-tv");
    if (!el) return;

    try {
      const seriesTrading = obtenerSeriesTradingTesoreria(
        AppState.anioFinanciero,
        AppState.categoriaFinanciera,
        AppState.usarEstimacionesLonja
      );
      ultimasSeriesTrading.tesoreria = seriesTrading;

      const seriesDefs = [
        { id: "ingresos_carne", name: "Cobros Carne (€)", type: "Line", color: "#15803d", lineWidth: 3, data: seriesTrading.ingresos_carne || [], defaultVisible: true },
        { id: "gastos_pienso", name: "Pagos Pienso (€)", type: "Line", color: "#ea580c", lineWidth: 2, data: seriesTrading.gastos_pienso || [], defaultVisible: true },
        { id: "margen_neto", name: "Saldo Neto Mes (€)", type: "Line", color: "#2563eb", lineWidth: 2, lineStyle: 2, data: seriesTrading.margen_neto || [], defaultVisible: true }
      ];

      initTradingChart({
        id: "chart-tesoreria-tv",
        seriesDefs,
        precioUnitario: "€"
      });
    } catch (e) {
      console.warn("[TradingChart] Error inicializando gráfico de tesorería:", e);
    }
  }
}

/**
 * VISTA DE DETALLE DE LIQUIDACIÓN (NIVEL 3 DE PROFUNDIDAD)
 */
export function verDetalleLiquidacion(facturaId, registrarHistorial = true) {
  const container = document.getElementById("app-container");
  if (!container) return;

  if (registrarHistorial) {
    registrarPasoHistorial("ventas", { facturaId });
  }

  const detalle = obtenerDetalleLiquidacion(facturaId);
  if (!detalle) {
    alert("No se encontró la liquidación seleccionada.");
    AppState.facturaSeleccionada = null;
    renderVistaLiquidaciones();
    return;
  }

  const factura = detalle.factura || detalle;
  const canales = detalle.canales || (detalle.factura && detalle.factura.canales) || [];
  const gastos = detalle.gastos || (detalle.factura && detalle.factura.gastos) || [];

  container.innerHTML = `
    <div class="factura-detail-container" style="max-width: 900px; margin: 0 auto; padding: 16px 12px 60px;">
      
      <!-- Barra Superior de Navegación -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <button id="btn-volver-atras-factura" class="btn-volver-liq btn-secondary" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: var(--md-shape-md); cursor: pointer;">
          ← <span>Volver a Liquidaciones</span>
        </button>
        <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">ID Factura: ${escapeHtml(factura.id)}</span>
      </div>

      <!-- Ficha de Encabezado de Factura -->
      <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 18px; box-shadow: var(--md-elevation-1); margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; margin-bottom: 14px;">
          <div>
            <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Liquidación Oficial</div>
            <h3 style="font-size: 1.35rem; font-weight: 900; color: var(--md-primary); margin: 2px 0 0;">
              ${escapeHtml(factura.numero_factura || `Liquidación #${factura.id}`)}
            </h3>
            <div style="font-size: 0.84rem; color: var(--text-muted); margin-top: 2px;">
              ${escapeHtml(factura.cliente_cooperativa || "Liquidación")} · Fecha emisión: ${formatearFecha(factura.fecha_factura)}
            </div>
          </div>

          <div style="text-align: right;">
            <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Total Liquidado</div>
            <div style="font-size: 1.6rem; font-weight: 900; color: var(--chart-carne); margin-top: 2px;">
              ${formatearMoneda(factura.total_factura)} €
            </div>
            <div style="font-size: 0.76rem; color: var(--text-muted);">
              Base: ${formatearMoneda(factura.base_imponible)} € · IVA (${factura.porcentaje_iva || 0}%): ${formatearMoneda(factura.cuota_iva || 0)} €
            </div>
          </div>
        </div>

        <!-- Métricas Rápidas de la Factura -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; border-top: 1px solid var(--md-outline-variant); padding-top: 12px;">
          <div style="background: var(--md-surface-container-low); padding: 8px 10px; border-radius: var(--md-shape-md);">
            <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Total Cabezas</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: var(--text-main); margin-top: 2px;">${factura.total_cabezas || canales.length}</div>
          </div>
          <div style="background: var(--md-surface-container-low); padding: 8px 10px; border-radius: var(--md-shape-md);">
            <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Kilos Canal</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: var(--text-main); margin-top: 2px;">${formatearKg(factura.total_kilos_canal || 0)} kg</div>
          </div>
          <div style="background: var(--md-surface-container-low); padding: 8px 10px; border-radius: var(--md-shape-md);">
            <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Precio Medio</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: var(--text-main); margin-top: 2px;">
              ${factura.total_kilos_canal > 0 ? `${(factura.base_imponible / factura.total_kilos_canal).toFixed(2)} €/kg` : '—'}
            </div>
          </div>
          <div style="background: var(--md-surface-container-low); padding: 8px 10px; border-radius: var(--md-shape-md);">
            <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Deducciones</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: #b91c1c; margin-top: 2px;">${formatearMoneda(factura.gastos_total || 0)} €</div>
          </div>
        </div>
      </div>

      <!-- Desglose de Deducciones y Gastos de Matadero -->
      ${gastos && gastos.length > 0 ? `
        <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 14px; margin-bottom: 16px; box-shadow: var(--md-elevation-1);">
          <h4 style="font-size: 0.88rem; font-weight: 800; color: var(--text-main); margin: 0 0 8px;">Deducciones y Gastos de Matadero</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${gastos.map(g => `
              <div style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-md); padding: 6px 10px; font-size: 0.78rem;">
                <span style="color: var(--text-muted);">${escapeHtml(g.concepto || "Gasto")}:</span>
                <strong style="color: #b91c1c; margin-left: 4px;">-${formatearMoneda(g.importe)} €</strong>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <!-- Tabla de Canales Individuales -->
      <div style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-lg); padding: 16px; box-shadow: var(--md-elevation-1);">
        <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); margin: 0 0 12px;">Desglose de Canales (${canales.length})</h4>

        <div style="overflow-x: auto;">
          <table class="canales-table" style="width: 100%; border-collapse: collapse; font-size: 0.84rem; text-align: right;">
            <thead>
              <tr style="border-bottom: 2px solid var(--md-outline-variant); color: var(--text-muted); font-size: 0.76rem; text-transform: uppercase;">
                <th style="text-align: left; padding: 6px 8px;">Crotal / Tipo</th>
                <th style="text-align: center; padding: 6px 8px;">Cab</th>
                <th style="padding: 6px 8px;">Peso Canal</th>
                <th style="padding: 6px 8px;">€/kg</th>
                <th style="padding: 6px 8px;">Total Línea</th>
              </tr>
            </thead>
            <tbody>
              ${canales.map(c => {
                const crotal4 = c.crotal_asignado ? extraer4Digitos(c.crotal_asignado) : null;
                const esSobrepeso = c.peso_canal_kg > 350;

                return `
                  <tr style="border-bottom: 1px solid var(--md-outline-variant);">
                    <td style="text-align: left; padding: 8px;">
                      <div style="font-weight: 700; color: var(--text-main);">${escapeHtml(c.articulo || "Canal")}</div>
                      ${c.crotal_asignado ? `
                        <button class="chip-crotal-link btn-ver-ficha-canal" data-crotal="${c.crotal_asignado}" style="margin-top: 2px;">
                          🐄 ${crotal4 || c.crotal_asignado}
                        </button>
                      ` : `
                        <span style="font-size: 0.74rem; color: var(--text-muted);">${c.fecha_salida_lote ? formatearFecha(c.fecha_salida_lote) : ''}</span>
                      `}
                    </td>
                    <td style="text-align: center; padding: 8px; font-weight: 600;">${c.cabezas || 1}</td>
                    <td style="padding: 8px; font-weight: 700; color: ${esSobrepeso ? '#b91c1c' : 'var(--text-main)'};">
                      ${c.peso_canal_kg > 1 ? `${c.peso_canal_kg.toFixed(1)} kg` : 'Lote global'}
                      ${esSobrepeso ? '<div style="font-size: 0.68rem; color: #b91c1c; font-weight: 800;">>350kg</div>' : ''}
                    </td>
                    <td style="padding: 8px; color: var(--text-muted);">
                      ${c.precio_unitario > 0 && c.precio_unitario < 20 ? `${c.precio_unitario.toFixed(3)} €` : '—'}
                    </td>
                    <td style="padding: 8px; font-weight: 800; color: var(--chart-carne);">
                      ${formatearMoneda(c.importe_linea)} €
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `;

  // Vincular eventos de la vista de detalle
  const btnVolver = document.getElementById("btn-volver-atras-factura");
  if (btnVolver) {
    btnVolver.addEventListener("click", () => {
      AppState.facturaSeleccionada = null;
      renderVistaLiquidaciones();
    });
  }

  document.querySelectorAll(".btn-ver-ficha-canal").forEach(btn => {
    btn.addEventListener("click", () => {
      const crotal = btn.dataset.crotal;
      if (crotal) {
        seleccionarAnimal(crotal);
      }
    });
  });
}

/**
 * MODAL: CALCULADORA Y SIMULADOR DE TIMING ÓPTIMO DE SACRIFICIO
 */
export function abrirModalSimuladorTiming() {
  const modalContainer = document.getElementById("modal-container") || document.body;
  const overlay = document.createElement("div");
  overlay.id = "modal-timing-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "9999";
  overlay.style.padding = "16px";

  const renderModalContent = () => {
    const sim = calcularSimulacionTimingVenta(AppState.simulacionTiming);

    return `
      <div style="background: var(--md-surface-container-lowest); border-radius: var(--md-shape-lg); max-width: 520px; width: 100%; max-height: 90vh; overflow-y: auto; padding: 20px; box-shadow: var(--md-elevation-3);">
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="font-size: 1.15rem; font-weight: 800; color: var(--text-main); margin: 0;">Calculadora de Timing de Sacrificio</h3>
          <button id="btn-cerrar-modal-timing" style="border: none; background: transparent; font-size: 1.4rem; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>

        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 14px;">
          Simula si compensa aguantar el ternero más días en el cebadero ante la subida de lonja o si el coste de pienso y el sobrepeso (>350kg) reducen tu beneficio.
        </p>

        <!-- Formulario de Parámetros -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">Peso Canal Actual (kg)</label>
            <input type="number" id="sim-peso-actual" value="${AppState.simulacionTiming.pesoCanalActual}" step="1" style="width: 100%; padding: 7px 10px; border-radius: var(--md-shape-sm); border: 1px solid var(--md-outline-variant); font-size: 0.88rem; font-weight: 700; margin-top: 2px;" />
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">Días de Retraso</label>
            <input type="number" id="sim-dias-retraso" value="${AppState.simulacionTiming.diasRetraso}" step="1" style="width: 100%; padding: 7px 10px; border-radius: var(--md-shape-sm); border: 1px solid var(--md-outline-variant); font-size: 0.88rem; font-weight: 700; margin-top: 2px;" />
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">Precio Actual (€/kg)</label>
            <input type="number" id="sim-precio-actual" value="${AppState.simulacionTiming.precioActualKg}" step="0.05" style="width: 100%; padding: 7px 10px; border-radius: var(--md-shape-sm); border: 1px solid var(--md-outline-variant); font-size: 0.88rem; font-weight: 700; margin-top: 2px;" />
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">Precio Esperado (€/kg)</label>
            <input type="number" id="sim-precio-esperado" value="${AppState.simulacionTiming.precioEsperadoKg}" step="0.05" style="width: 100%; padding: 7px 10px; border-radius: var(--md-shape-sm); border: 1px solid var(--md-outline-variant); font-size: 0.88rem; font-weight: 700; margin-top: 2px;" />
          </div>
        </div>

        <!-- Tarjeta de Resultado Económico -->
        <div style="background: ${sim.esRentable ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; border: 1px solid ${sim.esRentable ? '#86efac' : '#fca5a5'}; border-radius: var(--md-shape-md); padding: 14px; margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.76rem; font-weight: 700; text-transform: uppercase; color: ${sim.esRentable ? '#15803d' : '#b91c1c'};">
              ${sim.esRentable ? '✓ Retraso Rentable' : '⚠️ No Compensa Retrasar'}
            </span>
            <span style="font-size: 1.15rem; font-weight: 900; color: ${sim.esRentable ? '#15803d' : '#b91c1c'};">
              ${sim.margenNetoRetraso >= 0 ? '+' : ''}${sim.margenNetoRetraso.toFixed(2)} € / cab
            </span>
          </div>

          <div style="font-size: 0.8rem; color: var(--text-main); margin-top: 6px; line-height: 1.4;">
            • Peso final estimado: <strong>${sim.pesoCanalNuevo} kg canal</strong> (+${sim.gananciaCanal} kg)<br/>
            • Coste de pienso extra: <strong>-${sim.costePiensoAcumulado.toFixed(2)} €</strong><br/>
            ${sim.saltaSobrepeso ? `<strong style="color: #b91c1c;">• Castigo Lonja Sobrepeso (>350kg): -${sim.penalizacionSobrepeso.toFixed(2)} €</strong><br/>` : ''}
            • Precio mínimo de equilibrio: <strong>${sim.precioUmbralEquilibrio.toFixed(2)} €/kg</strong>
          </div>
        </div>

        <button id="btn-cerrar-modal-timing-ok" class="btn-primary" style="width: 100%; padding: 10px; border-radius: var(--md-shape-md); font-weight: 700; cursor: pointer;">
          Entendido
        </button>

      </div>
    `;
  };

  overlay.innerHTML = renderModalContent();
  modalContainer.appendChild(overlay);

  const vincularEventosModal = () => {
    const cerrar = () => {
      overlay.remove();
    };

    overlay.querySelector("#btn-cerrar-modal-timing")?.addEventListener("click", cerrar);
    overlay.querySelector("#btn-cerrar-modal-timing-ok")?.addEventListener("click", cerrar);

    const recomputar = () => {
      const pAct = parseFloat(overlay.querySelector("#sim-peso-actual").value) || 330;
      const dRet = parseInt(overlay.querySelector("#sim-dias-retraso").value, 10) || 21;
      const prAct = parseFloat(overlay.querySelector("#sim-precio-actual").value) || 7.15;
      const prEsp = parseFloat(overlay.querySelector("#sim-precio-esperado").value) || 7.20;

      AppState.simulacionTiming.pesoCanalActual = pAct;
      AppState.simulacionTiming.diasRetraso = dRet;
      AppState.simulacionTiming.precioActualKg = prAct;
      AppState.simulacionTiming.precioEsperadoKg = prEsp;

      overlay.innerHTML = renderModalContent();
      vincularEventosModal();
    };

    overlay.querySelector("#sim-peso-actual")?.addEventListener("change", recomputar);
    overlay.querySelector("#sim-dias-retraso")?.addEventListener("change", recomputar);
    overlay.querySelector("#sim-precio-actual")?.addEventListener("change", recomputar);
    overlay.querySelector("#sim-precio-esperado")?.addEventListener("change", recomputar);
  };

  vincularEventosModal();
}
