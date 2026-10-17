// modules/views/movements_view.js
/**
 * Vista de Movimientos de Censo (altas, bajas, compras, ventas, traspasos 121->122).
 */

import {
  AppState,
  esPantallaEscritorio,
  escapeHtml,
  formatearFecha,
  formatearMoneda,
  formatearKg,
  formatearExplotacionAmigable,
  clasificarMovimientoUnificado,
  registrarPasoHistorial
} from '../config.js';
import { obtenerMovimientos, obtenerAniosMovimientos } from '../db.js';
import { seleccionarAnimal } from './detail_view.js';
import { renderVistaLiquidaciones, verDetalleLiquidacion } from './sales_view.js';


export function renderVistaMovimientos() {
  const container = document.getElementById("app-container");
  if (!container) return;

  const tipos = [
    { id: "TODOS", label: "Todos" },
    { id: "VENTA", label: "Ventas" },
    { id: "TRASPASO_CEBADERO", label: "Traspasos a Cebadero" },
    { id: "MOVIMIENTO_INTERNO", label: "Movimientos Internos" },
    { id: "NACIMIENTO", label: "Nacimientos" },
    { id: "MUERTE", label: "Bajas en campo" },
    { id: "COMPRA", label: "Compras" }
  ];

  const aniosDb = obtenerAniosMovimientos();
  const anios = (aniosDb && aniosDb.length > 0)
    ? aniosDb
    : ["2026", "2025", "2024", "2023", "2022", "2021", "2020"];

  const chipsHtml = tipos
    .map(
      (t) => `
      <button class="chip-filtro-mov ${AppState.tipoMovimiento === t.id ? "active" : ""}" data-tipo="${t.id}">
        ${escapeHtml(t.label)}
      </button>
    `
    )
    .join("");

  const aniosOptions = anios
    .map(
      (a) => `
      <option value="${a}" ${AppState.anioMovimiento === a ? "selected" : ""}>Año ${a}</option>
    `
    )
    .join("");

  container.innerHTML = `
    <div style="max-width: 960px; margin: 0 auto;">
      <div style="margin-bottom: 16px;">
        <h2 style="font-size: 1.4rem; font-weight: 800; color: var(--brand-primary); margin-bottom: 4px;">
          Movimientos del Censo
        </h2>
        <p style="font-size: 0.9rem; color: var(--text-muted);">
          Trazabilidad completa de nacimientos, traspasos entre la 121 (vida) y 122 (cebadero), ventas comerciales y bajas.
        </p>
      </div>

      <!-- Banner de acceso a Liquidaciones de Venta (Profundidad Progresiva) -->
      <div class="banner-liquidaciones" id="banner-ir-liquidaciones" style="cursor: pointer; margin-bottom: 16px;">
        <div class="banner-liquidaciones-content">
          <div class="banner-liquidaciones-icon">📊</div>
          <div>
            <div class="banner-liquidaciones-title">
              Liquidaciones de Venta y Matadero
            </div>
            <div class="banner-liquidaciones-desc">
              Facturas oficiales GANAVAEX · Canales pesadas · Rendimiento y cotizaciones
            </div>
          </div>
        </div>
        <div class="btn-profundizar">
          <span>Ver liquidaciones</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </div>
      </div>

      <div class="filtros-movimientos-wrapper">

        <div class="search-input-wrapper">
          <input 
            type="text" 
            id="txt-busqueda-movimientos" 
            class="search-input" 
            placeholder="Buscar por 4 cifras (ej. 8549), crotal, corral o REGA..." 
            value="${escapeHtml(AppState.filtroMovimientos)}"
            autocomplete="off"
            spellcheck="false"
          />
          ${AppState.filtroMovimientos ? '<button class="btn-input-clear" id="btn-clear-movimientos">✕</button>' : ""}
        </div>

        <div class="movimientos-tipo-chips" id="movimientos-chips-container">
          ${chipsHtml}
        </div>

        <div class="movimientos-filtros-secundarios">
          <select id="select-mov-destino" class="mov-select">
            <option value="TODOS" ${AppState.destinoMovimiento === "TODOS" ? "selected" : ""}>Todos los destinos</option>
            <option value="ACTIVAS" ${AppState.destinoMovimiento === "ACTIVAS" ? "selected" : ""}>Solo fincas activas (121 y 122)</option>
            <option value="122" ${AppState.destinoMovimiento === "122" ? "selected" : ""}>Hacia 122 (Cebadero)</option>
            <option value="121" ${AppState.destinoMovimiento === "121" ? "selected" : ""}>En 121 (Vida / Nodrizas)</option>
            <option value="EXTERNO" ${AppState.destinoMovimiento === "EXTERNO" ? "selected" : ""}>Salidas a Ventas / Matadero</option>
            <option value="HISTORICO" ${AppState.destinoMovimiento === "HISTORICO" ? "selected" : ""}>Histórico antiguo (671 / 591)</option>
          </select>


          <select id="select-mov-anio" class="mov-select">
            <option value="TODOS" ${AppState.anioMovimiento === "TODOS" ? "selected" : ""}>Todos los años</option>
            ${aniosOptions}
          </select>
        </div>
      </div>

      <div class="list-meta">
        <span>Historial de Movimientos</span>
        <span id="movimientos-count">Cargando...</span>
      </div>

      <div id="movimientos-list"></div>
    </div>
  `;

  // Event Listeners
  const inputMov = document.getElementById("txt-busqueda-movimientos");
  if (inputMov) {
    inputMov.addEventListener("input", (e) => {
      AppState.filtroMovimientos = e.target.value;
      AppState.limiteMovimientos = 100;
      ejecutarBusquedaMovimientos();
    });
    if (esPantallaEscritorio()) {
      inputMov.focus();
    }
  }

  const btnClearMov = document.getElementById("btn-clear-movimientos");
  if (btnClearMov) {
    btnClearMov.addEventListener("click", () => {
      AppState.filtroMovimientos = "";
      AppState.limiteMovimientos = 100;
      if (inputMov) {
        inputMov.value = "";
        inputMov.focus();
      }
      ejecutarBusquedaMovimientos();
    });
  }

  const chipsContainer = document.getElementById("movimientos-chips-container");
  if (chipsContainer) {
    chipsContainer.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip-filtro-mov");
      if (!btn) return;
      AppState.tipoMovimiento = btn.dataset.tipo;
      AppState.limiteMovimientos = 100;
      chipsContainer.querySelectorAll(".chip-filtro-mov").forEach((b) => {
        b.classList.toggle("active", b.dataset.tipo === AppState.tipoMovimiento);
      });
      ejecutarBusquedaMovimientos();
    });
  }

  const selectDestino = document.getElementById("select-mov-destino");
  if (selectDestino) {
    selectDestino.addEventListener("change", (e) => {
      AppState.destinoMovimiento = e.target.value;
      AppState.limiteMovimientos = 100;
      ejecutarBusquedaMovimientos();
    });
  }

  const selectAnio = document.getElementById("select-mov-anio");
  if (selectAnio) {
    selectAnio.addEventListener("change", (e) => {
      AppState.anioMovimiento = e.target.value;
      AppState.limiteMovimientos = 100;
      ejecutarBusquedaMovimientos();
    });
  }

  const bannerLiq = container.querySelector("#banner-ir-liquidaciones");
  if (bannerLiq) {
    bannerLiq.addEventListener("click", () => {
      registrarPasoHistorial("movimientos", null, "Movimientos");
      renderVistaLiquidaciones();
    });
  }

  const listaContenedor = document.getElementById("movimientos-list");
  if (listaContenedor) {
    listaContenedor.addEventListener("click", (e) => {
      const targetFactura = e.target.closest('[data-action="ver-factura"]');
      if (targetFactura && targetFactura.dataset.facturaId) {
        registrarPasoHistorial("movimientos", null, "Movimientos");
        verDetalleLiquidacion(Number(targetFactura.dataset.facturaId), true);
        return;
      }

      const targetAnimal = e.target.closest('[data-action="select-animal"]');
      if (targetAnimal && targetAnimal.dataset.crotal) {
        if (AppState.tabActual !== "animales") {
          const tabBtn = document.querySelector('.nav-link[data-tab="animales"]') || document.querySelector('.mobile-tab-btn[data-tab="animales"]');
          if (tabBtn) tabBtn.click();
        }
        seleccionarAnimal(targetAnimal.dataset.crotal, true);
        return;
      }

      const loadMoreBtn = e.target.closest('[data-action="load-more-movimientos"]');
      if (loadMoreBtn) {
        AppState.limiteMovimientos = (AppState.limiteMovimientos || 100) + 50;
        ejecutarBusquedaMovimientos();
        return;
      }
    });
  }


  ejecutarBusquedaMovimientos();
}

export function ejecutarBusquedaMovimientos() {
  const listContainer = document.getElementById("movimientos-list");
  const countLabel = document.getElementById("movimientos-count");
  if (!listContainer) return;

  const movs = obtenerMovimientos({
    filtro: AppState.filtroMovimientos,
    tipo: AppState.tipoMovimiento,
    anio: AppState.anioMovimiento,
    destino: AppState.destinoMovimiento,
    limite: AppState.limiteMovimientos || 100,
    offset: 0
  });

  const total = (movs && movs.total != null) ? movs.total : (movs ? movs.length : 0);

  if (countLabel) {
    if (movs.length < total) {
      countLabel.textContent = `Mostrando ${movs.length} de ${total.toLocaleString("es-ES")} movimientos`;
    } else {
      countLabel.textContent = `${total.toLocaleString("es-ES")} movimientos`;
    }
  }

  if (movs.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 40px 15px; color: var(--text-dim); background: var(--bg-surface); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
        <p style="font-weight: 600; font-size: 1rem; color: var(--text-muted); margin-bottom: 4px;">Sin movimientos encontrados</p>
        <p style="font-size: 0.85rem;">Prueba a cambiar el tipo de movimiento, el año o limpiar el filtro de búsqueda.</p>
      </div>
    `;
    return;
  }

  const cardsHtml = renderListaMovimientosCards(movs);

  const btnMasHtml = movs.length < total ? `
    <div style="text-align: center; margin-top: 24px; margin-bottom: 30px;">
      <button 
        class="btn-mostrar-mas-movimientos" 
        id="btn-mostrar-mas-movimientos" 
        data-action="load-more-movimientos">
        Mostrar más movimientos (+50)
      </button>
      <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 8px;">
        Quedan ${(total - movs.length).toLocaleString("es-ES")} movimientos por mostrar
      </div>
    </div>
  ` : "";

  listContainer.innerHTML = cardsHtml + btnMasHtml;
}

export function generarCardMovimientoHtml(m) {
  const clasificacion = clasificarMovimientoUnificado(m.origen, m.destino, m.tipo);
  const badgeClase = m.badge_class || clasificacion.badge_class || "otro";
  const badgeTexto = m.label_display || clasificacion.label || m.tipo_display || m.tipo || "MOVIMIENTO";

  const crotal4 = m.crotal_4 || (m.crotal && m.crotal.length >= 4 ? m.crotal.slice(-4) : m.crotal);
  const tieneFicha = m.estado === "A" || m.estado === "Activo" || (m.estado === undefined && Boolean(m.crotal));
  const estadoBadge = m.estado === "A" 
    ? '<span style="background: #f0fdf4; color: #166534; padding: 2px 8px; border-radius: 9999px; font-size: 0.72rem; font-weight: 700;">Activo en finca</span>' 
    : '<span style="background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 9999px; font-size: 0.72rem; font-weight: 600;">Baja</span>';

  const corralInfo = m.corral_actual ? `• Lote actual: <strong>${escapeHtml(m.corral_actual)}</strong>` : (m.corral ? `• Lote: ${escapeHtml(m.corral)}` : "");

  return `
    <article class="movimiento-card">
      <div class="mov-header-row">
        <div style="display: flex; align-items: center;">
          <span class="badge-tipo-mov ${badgeClase}">
            ${escapeHtml(badgeTexto)}
          </span>
        </div>
        <span class="mov-fecha">${formatearFecha(m.fecha)}</span>
      </div>

      <div class="mov-animal-row">
        <span class="mov-crotal-4">${escapeHtml(crotal4)}</span>
        <span class="mov-crotal-completo" ${tieneFicha ? `data-action="select-animal" data-crotal="${escapeHtml(m.crotal)}" style="cursor: pointer;"` : ""}>
          ${escapeHtml(m.crotal)}
        </span>
        ${estadoBadge}
      </div>

      <div class="mov-ruta-box">
        <div class="mov-punto">
          <span class="mov-punto-label">Origen</span>
          <span class="mov-punto-valor">${escapeHtml(formatearExplotacionAmigable(m.origen))}</span>
        </div>
        <span class="mov-flecha">➔</span>
        <div class="mov-punto">
          <span class="mov-punto-label">Destino</span>
          <span class="mov-punto-valor">${escapeHtml(formatearExplotacionAmigable(m.destino))}</span>
        </div>
      </div>

      ${m.peso_canal_kg != null ? `
      <div class="mov-canal-badge-box" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; background: var(--md-surface-container-high); padding: 8px 12px; border-radius: var(--md-shape-sm); margin: 8px 0; border: 1px solid var(--md-outline-variant);">
        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem;">
          <span style="font-weight: 800; color: var(--brand-primary);">⚖️ ${m.peso_canal_kg} kg canal</span>
          ${m.canal_precio ? `<span style="color: var(--text-muted);">• ${Number(m.canal_precio).toFixed(2)} €/kg</span>` : ""}
          ${m.canal_importe ? `<span style="font-weight: 700; color: var(--text-main);">(${formatearMoneda(m.canal_importe)} €)</span>` : ""}
        </div>
        ${m.canal_factura && m.canal_factura_id ? `
        <button class="clickable-chip chip-factura" data-action="ver-factura" data-factura-id="${m.canal_factura_id}" style="padding: 4px 10px; font-size: 0.8rem;">
          <span>Factura ${escapeHtml(m.canal_factura)}</span>
          <span class="chip-action">→</span>
        </button>
        ` : ""}
      </div>
      ` : ""}

      <div class="mov-card-footer">

        <div>
          ${m.sexo ? `<span>${escapeHtml(m.sexo)}</span> ` : ""}
          ${corralInfo}
        </div>
        ${tieneFicha ? `
        <button 
          class="btn-ver-ficha-animal" 
          data-action="select-animal" 
          data-crotal="${escapeHtml(m.crotal)}">
          <span>Ver ficha</span>
          <span aria-hidden="true">→</span>
        </button>
        ` : ""}
      </div>
    </article>
  `;
}

export function renderListaMovimientosCards(movs) {
  return movs.map(generarCardMovimientoHtml).join("");
}

