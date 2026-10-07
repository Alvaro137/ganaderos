// modules/views/feeds_view.js
/**
 * Vista de Compras de Piensos, Forrajes y Materias Primas con control de costes.
 */

import { AppState, esPantallaEscritorio, escapeHtml, formatearFecha, formatearKg, formatearMoneda } from '../config.js';
import { obtenerComprasAlimento } from '../db.js';

export function renderVistaAlimentos() {
  const container = document.getElementById("app-container");
  if (!container) return;

  container.innerHTML = `
    <div style="max-width: 900px; margin: 0 auto;">
      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 1.4rem; font-weight: 800; color: var(--brand-primary); margin-bottom: 4px;">Compras de Alimentos y Piensos</h2>
        <p style="font-size: 0.9rem; color: var(--text-muted);">
          Registro de compras de concentrado, forraje y materias primas con desglose de kilos, importes y precios unitarios.
        </p>
      </div>

      <div class="search-card">
        <div class="search-input-wrapper">
          <input 
            type="text" 
            id="txt-busqueda-alimentos" 
            class="search-input" 
            placeholder="Buscar por alimento (ej. T-3 cebo), proveedor o albarán..." 
            value="${escapeHtml(AppState.filtroAlimentos)}"
            autocomplete="off"
            spellcheck="false"
          />
          <button class="btn-input-clear" id="btn-clear-alimentos" style="display: ${AppState.filtroAlimentos ? 'flex' : 'none'};">✕</button>
        </div>
      </div>

      <div class="list-meta">
        <span>Historial de Entradas</span>
        <span id="alimentos-count">Cargando...</span>
      </div>

      <div id="alimentos-list"></div>
    </div>
  `;

  const btnClear = document.getElementById("btn-clear-alimentos");
  const inputAlimentos = document.getElementById("txt-busqueda-alimentos");
  if (inputAlimentos) {
    inputAlimentos.addEventListener("input", (e) => {
      AppState.filtroAlimentos = e.target.value;
      if (btnClear) {
        btnClear.style.display = e.target.value ? "flex" : "none";
      }
      ejecutarBusquedaAlimentos();
    });
    if (esPantallaEscritorio()) {
      inputAlimentos.focus();
    }
  }

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      AppState.filtroAlimentos = "";
      btnClear.style.display = "none";
      if (inputAlimentos) {
        inputAlimentos.value = "";
        inputAlimentos.focus();
      }
      ejecutarBusquedaAlimentos();
    });
  }

  ejecutarBusquedaAlimentos();
}

export function ejecutarBusquedaAlimentos() {
  const listContainer = document.getElementById("alimentos-list");
  const countLabel = document.getElementById("alimentos-count");
  if (!listContainer) return;

  const compras = obtenerComprasAlimento(AppState.filtroAlimentos);

  if (countLabel) {
    countLabel.textContent = `${compras.length} compras`;
  }

  if (compras.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 40px 15px; color: var(--text-dim); background: var(--bg-surface); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
        <p style="font-weight: 600; font-size: 1rem; color: var(--text-muted); margin-bottom: 4px;">Sin compras encontradas</p>
        <p style="font-size: 0.85rem;">Prueba a buscar por tipo de alimento (ej. T-3 cebo, FORRAJE) o proveedor (ej. CUPERAL, NANTA).</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = compras
    .map((c) => {
      const tieneImporte = c.importe > 0;
      const tieneKg = c.kg > 0;
      const precioKg = c.precio_kg > 0 ? c.precio_kg : (tieneImporte && tieneKg ? c.importe / c.kg : 0);

      let textoPrecioUnitario = "—";
      if (precioKg > 0) {
        textoPrecioUnitario = `${formatearMoneda(precioKg, 4)} €/kg`;
      } else if (c.proveedor === "ELABORACION PROPIA") {
        textoPrecioUnitario = "Propio";
      }

      let textoImporte = "—";
      if (tieneImporte) {
        textoImporte = `${formatearMoneda(c.importe, 2)} €`;
      } else if (c.proveedor === "ELABORACION PROPIA") {
        textoImporte = "Propio";
      }

      return `
        <article class="compra-card">
          <div class="compra-header">
            <div class="compra-alimento-nombre">${escapeHtml(c.alimento || "Alimento")}</div>
            <span class="compra-date">${formatearFecha(c.fecha)}</span>
          </div>

          <div class="compra-specs-grid">
            <div>
              <div class="compra-metric-label">Kilos</div>
              <div class="compra-metric-val">${formatearKg(c.kg)} kg</div>
            </div>
            <div>
              <div class="compra-metric-label">Precio / kg</div>
              <div class="compra-metric-val precio-unitario">${textoPrecioUnitario}</div>
            </div>
            <div>
              <div class="compra-metric-label">Importe Total</div>
              <div class="compra-metric-val">${textoImporte}</div>
            </div>
          </div>

          <div class="compra-footer">
            <div>
              <span>Proveedor: <strong>${escapeHtml(c.proveedor || "No especificado")}</strong></span>
              ${c.albaran ? ` • <span style="color: var(--text-dim);">Albarán: ${escapeHtml(c.albaran)}</span>` : ""}
            </div>
            <div>
              ${c.pagado ? '<span class="compra-badge-pagado">Pagado</span>' : '<span class="compra-badge-pagado" style="background:#fef2f2; color:#991b1b;">Pendiente</span>'}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}
