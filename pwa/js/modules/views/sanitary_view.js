// modules/views/sanitary_view.js
/**
 * Vista de Recetas y Tratamientos Sanitarios (control de retirada y espera en carne).
 */

import { AppState, esPantallaEscritorio, escapeHtml, formatearFecha, formatearMoneda } from '../config.js';
import { obtenerRecetas } from '../db.js';

export function renderVistaRecetas() {
  const container = document.getElementById("app-container");
  if (!container) return;

  container.innerHTML = `
    <div style="max-width: 900px; margin: 0 auto;">
      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 1.4rem; font-weight: 800; color: var(--brand-primary); margin-bottom: 4px;">Recetas y Tratamientos</h2>
        <p style="font-size: 0.9rem; color: var(--text-muted);">
          Consulta de medicamentos administrados, recetas oficiales y plazos de retirada en carne.
        </p>
      </div>

      <div class="search-card">
        <div class="search-input-wrapper">
          <input 
            type="text" 
            id="txt-busqueda-recetas" 
            class="search-input" 
            placeholder="Buscar por medicamento, receta o veterinario..." 
            value="${escapeHtml(AppState.filtroRecetas)}"
            autocomplete="off"
            spellcheck="false"
          />
          ${AppState.filtroRecetas ? '<button class="btn-input-clear" id="btn-clear-recetas">✕</button>' : ''}
        </div>
      </div>

      <div class="list-meta">
        <span>Historial de Prescripciones</span>
        <span id="recetas-count">Cargando...</span>
      </div>

      <div id="recetas-list"></div>
    </div>
  `;

  const inputRecetas = document.getElementById("txt-busqueda-recetas");
  if (inputRecetas) {
    inputRecetas.addEventListener("input", (e) => {
      AppState.filtroRecetas = e.target.value;
      ejecutarBusquedaRecetas();
    });
    if (esPantallaEscritorio()) {
      inputRecetas.focus();
    }
  }

  const btnClear = document.getElementById("btn-clear-recetas");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      AppState.filtroRecetas = "";
      if (inputRecetas) {
        inputRecetas.value = "";
        inputRecetas.focus();
      }
      ejecutarBusquedaRecetas();
    });
  }

  ejecutarBusquedaRecetas();
}

export function ejecutarBusquedaRecetas() {
  const listContainer = document.getElementById("recetas-list");
  const countLabel = document.getElementById("recetas-count");
  if (!listContainer) return;

  const recetas = obtenerRecetas(AppState.filtroRecetas);

  if (countLabel) {
    countLabel.textContent = `${recetas.length} recetas`;
  }

  if (recetas.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 40px 15px; color: var(--text-dim); background: var(--bg-surface); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
        <p style="font-weight: 600; font-size: 1rem; color: var(--text-muted); margin-bottom: 4px;">Sin recetas encontradas</p>
        <p style="font-size: 0.85rem;">Prueba a buscar por nombre de medicamento (ej. DRAXXIN) o número de receta.</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = recetas
    .map((r) => {
      const nAnim = r.n_animales ? parseInt(r.n_animales, 10) : (r.unidades > 0 ? Math.max(1, Math.round(r.unidades)) : 1);
      const diasCarne = r.tiempo_carne != null ? parseInt(r.tiempo_carne, 10) : null;
      let textoSupresion = diasCarne != null ? `Espera carne: ${diasCarne} d` : "";

      let detalleDosis = "";
      if (r.unidades > 0) {
        detalleDosis = `<strong>Dosis total:</strong> ${formatearMoneda(r.unidades, 1)} ml/unid.`;
        if (r.dosis_unitaria > 0) {
          detalleDosis += ` • <span style="color: var(--text-dim);">(${formatearMoneda(r.dosis_unitaria, 2)} / cabeza)</span>`;
        }
      }

      return `
        <article class="receta-card">
          <div class="receta-header">
            <span class="receta-num">${r.receta ? `Receta: ${escapeHtml(r.receta)}` : "Tratamiento sin receta oficial"}</span>
            <span class="receta-date">${formatearFecha(r.fecha)}</span>
          </div>

          <div class="receta-title-row">
            <div class="receta-medicamento">${escapeHtml(r.medicamento || "Medicamento no especificado")}</div>
            <span class="badge-animales-tratados destacado">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="8" r="4"></circle>
                <path d="M4 20c0-4 4-6 8-6s8 2 8 6"></path>
              </svg>
              ${nAnim} ${nAnim === 1 ? "animal" : "animales"}
            </span>
          </div>

          ${detalleDosis ? `<div class="receta-dosis-info">${detalleDosis}</div>` : ""}

          <div class="receta-footer">
            <div>
              ${r.veterinario ? `<span>Col. <strong>${escapeHtml(r.veterinario)}</strong></span>` : ""}
              ${r.proveedor ? ` <span style="color: var(--text-dim);">${r.veterinario ? "• " : ""}${escapeHtml(r.proveedor)}</span>` : ""}
            </div>
            ${textoSupresion ? `<span class="badge-supresion-discreto">${escapeHtml(textoSupresion)}</span>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
}
