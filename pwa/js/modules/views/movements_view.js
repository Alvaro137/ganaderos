// modules/views/movements_view.js
/**
 * Vista de Movimientos de Censo (altas, bajas, compras, ventas, traspasos 121->122).
 */

import {
  AppState,
  esPantallaEscritorio,
  escapeHtml,
  formatearFecha,
  formatearExplotacionAmigable
} from '../config.js';
import { obtenerMovimientos } from '../db.js';
import { seleccionarAnimal } from './detail_view.js';

export function renderVistaMovimientos() {
  const container = document.getElementById("app-container");
  if (!container) return;

  const tipos = [
    { id: "TODOS", label: "Todos" },
    { id: "TRASPASO", label: "Traspasos (121 ➔ 122)" },
    { id: "NACIMIENTO", label: "Nacimientos" },
    { id: "SACRIFICIO", label: "Sacrificios" },
    { id: "MUERTE", label: "Bajas en campo" },
    { id: "VENTA", label: "Ventas" },
    { id: "COMPRA", label: "Compras" }
  ];

  const anios = ["TODOS", "2025", "2024", "2023", "2022", "2021", "2020"];

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
    .filter((a) => a !== "TODOS")
    .map(
      (a) => `
      <option value="${a}" ${AppState.anioMovimiento === a ? "selected" : ""}>Año ${a}</option>
    `
    )
    .join("");

  container.innerHTML = `
    <div style="max-width: 960px; margin: 0 auto;">
      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 1.4rem; font-weight: 800; color: var(--brand-primary); margin-bottom: 4px;">
          Movimientos del Censo
        </h2>
        <p style="font-size: 0.9rem; color: var(--text-muted);">
          Trazabilidad completa de nacimientos, traspasos entre la 121 (vida) y 122 (cebadero), sacrificios y bajas.
        </p>
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
            <option value="122" ${AppState.destinoMovimiento === "122" ? "selected" : ""}>Hacia 122 (Cebadero)</option>
            <option value="121" ${AppState.destinoMovimiento === "121" ? "selected" : ""}>En 121 (Vida / Nodrizas)</option>
            <option value="671" ${AppState.destinoMovimiento === "671" ? "selected" : ""}>Hacia 671 (Cipérez - Antigua)</option>
            <option value="591" ${AppState.destinoMovimiento === "591" ? "selected" : ""}>Hacia 591 (Cerezal - Antigua)</option>
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
      ejecutarBusquedaMovimientos();
    });
  }

  const selectAnio = document.getElementById("select-mov-anio");
  if (selectAnio) {
    selectAnio.addEventListener("change", (e) => {
      AppState.anioMovimiento = e.target.value;
      ejecutarBusquedaMovimientos();
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
    limite: 150,
  });

  if (countLabel) {
    countLabel.textContent = `${movs.length} movimientos`;
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

  listContainer.innerHTML = movs
    .map((m) => {
      const tipoRaw = (m.tipo || "").toUpperCase();
      let tipoClase = "otro";
      if (tipoRaw.includes("TRASPASO") || tipoRaw.includes("TRASLADO")) tipoClase = "traspaso";
      else if (tipoRaw.includes("NACIMIENTO")) tipoClase = "nacimiento";
      else if (tipoRaw.includes("SACRIFICIO")) tipoClase = "sacrificio";
      else if (tipoRaw.includes("MUERTE")) tipoClase = "muerte";
      else if (tipoRaw.includes("VENTA")) tipoClase = "venta";
      else if (tipoRaw.includes("COMPRA")) tipoClase = "compra";

      const crotal4 = m.crotal_4 || (m.crotal && m.crotal.length >= 4 ? m.crotal.slice(-4) : m.crotal);
      const estadoBadge = m.estado === "A" 
        ? '<span style="background: #f0fdf4; color: #166534; padding: 2px 8px; border-radius: 9999px; font-size: 0.72rem; font-weight: 700;">Activo en finca</span>' 
        : '<span style="background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 9999px; font-size: 0.72rem; font-weight: 600;">Baja</span>';

      const corralInfo = m.corral_actual ? `• Lote actual: <strong>${escapeHtml(m.corral_actual)}</strong>` : (m.corral ? `• Lote: ${escapeHtml(m.corral)}` : "");

      return `
        <article class="movimiento-card">
          <div class="mov-header-row">
            <span class="badge-tipo-mov ${tipoClase}">
              ${escapeHtml(m.tipo || "MOVIMIENTO")}
            </span>
            <span class="mov-fecha">${formatearFecha(m.fecha)}</span>
          </div>

          <div class="mov-animal-row">
            <span class="mov-crotal-4">${escapeHtml(crotal4)}</span>
            <span class="mov-crotal-completo" onclick="seleccionarAnimal('${escapeHtml(m.crotal)}')">
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

          <div class="mov-card-footer">
            <div>
              ${m.sexo ? `<span>${escapeHtml(m.sexo)}</span> ` : ""}
              ${corralInfo}
            </div>
            <button 
              class="nav-link" 
              style="padding: 4px 10px; font-size: 0.75rem; background: var(--bg-surface-subtle); border: 1px solid var(--border-color); border-radius: var(--radius-sm);" 
              onclick="seleccionarAnimal('${escapeHtml(m.crotal)}')">
              Ver ficha animal →
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}
