// modules/views/census_view.js
/**
 * Vista y modal táctil para Conciliación de Censo MoGa / ITACyL (WCAG >= 48px).
 * Permite cargar archivos CSV oficiales de MoGa, enviarlos a POST /api/censo/conciliar-moga
 * y visualizar interactivamente las discrepancias detectadas frente al censo de campo.
 */

import { escapeHtml, extraer4Digitos } from '../config.js';
import { obtenerAuthHeaders } from '../auth.js';

let ultimoResultadoConciliacion = null;
let filtroActivoActual = "todos";

/**
 * Realiza la llamada HTTP multipart para conciliar el CSV de MoGa con el backend.
 * @param {File|Blob} file Fichero CSV oficial de MoGa / ITACyL.
 * @returns {Promise<Object>} Respuesta JSON MogaConciliacionResponse.
 */
export async function conciliarArchivoMoga(file) {
  if (!file) {
    throw new Error("Debe seleccionar un archivo CSV.");
  }

  const formData = new FormData();
  formData.append("file", file);

  const headers = { ...obtenerAuthHeaders() };
  delete headers["Content-Type"]; // Permitir que el navegador configure el boundary multipart

  let resp;
  try {
    resp = await fetch("./api/censo/conciliar-moga", {
      method: "POST",
      headers,
      body: formData,
    });
  } catch (netErr) {
    throw new Error("Error de red: no se pudo contactar con el servidor. Compruebe la conexión.");
  }

  if (!resp.ok) {
    let errorDetail = `Error del servidor (${resp.status})`;
    try {
      const errData = await resp.json();
      if (errData && errData.detail) {
        errorDetail = errData.detail;
      }
    } catch (_) {
      if (resp.status === 413) {
        errorDetail = "El archivo CSV excede el tamaño máximo permitido (10 MB).";
      } else if (resp.status === 400) {
        errorDetail = "El archivo CSV está vacío.";
      } else if (resp.status === 422) {
        errorDetail = "No se encontraron registros de animales válidos en el archivo MoGa.";
      } else if (resp.status === 503) {
        errorDetail = "Servicio de censo no disponible en el servidor.";
      }
    }
    throw new Error(errorDetail);
  }

  return await resp.json();
}

/**
 * Renderiza el bloque de métricas resumen de la conciliación MoGa.
 * @param {Object} resumen Objeto resumen con total_local, total_moga, coincidentes, discrepancias_totales.
 * @returns {string} Fragmento HTML con tarjetas de KPI y badges de estado.
 */
export function renderizarResumenMogaHTML(resumen = {}) {
  const totalLocal = Number(resumen?.total_local ?? 0);
  const totalMoga = Number(resumen?.total_moga ?? 0);
  const coincidentes = Number(resumen?.coincidentes ?? 0);
  const discrepanciasTotales = Number(resumen?.discrepancias_totales ?? 0);

  const esConciliado100 = discrepanciasTotales === 0;

  return `
    <div class="moga-summary-wrapper" style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 16px;">
      <!-- Badge de Estado General -->
      <div class="moga-status-banner ${esConciliado100 ? 'status-ok' : 'status-warning'}" style="padding: 12px 16px; border-radius: 12px; display: flex; align-items: center; gap: 12px; background: ${esConciliado100 ? '#ecfdf5' : '#fffbeb'}; border: 1px solid ${esConciliado100 ? '#a7f3d0' : '#fde68a'};">
        <span style="font-size: 1.6rem; line-height: 1;">${esConciliado100 ? '✅' : '⚠️'}</span>
        <div>
          <div style="font-weight: 700; font-size: 0.98rem; color: ${esConciliado100 ? '#065f46' : '#92400e'};">
            ${esConciliado100 ? 'Censo 100% Conciliado' : `${discrepanciasTotales} Discrepancia${discrepanciasTotales === 1 ? '' : 's'} Detectada${discrepanciasTotales === 1 ? '' : 's'}`}
          </div>
          <div style="font-size: 0.82rem; color: ${esConciliado100 ? '#047857' : '#b45309'};">
            ${esConciliado100 
              ? 'Todos los animales del censo oficial MoGa coinciden exactamente con la base de datos de campo.' 
              : 'Revise los animales detallados a continuación para regularizar altas o bajas oficiales.'}
          </div>
        </div>
      </div>

      <!-- Cuadrícula de Métricas Resumen -->
      <div class="moga-kpi-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
        <div class="moga-kpi-card" style="background: var(--bg-surface, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column;">
          <span style="font-size: 0.76rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted, #64748b);">Censo Campo</span>
          <span style="font-size: 1.35rem; font-weight: 800; color: var(--text-main, #0f172a); margin-top: 2px;">${totalLocal}</span>
          <span style="font-size: 0.72rem; color: var(--text-muted, #64748b);">Base de datos local</span>
        </div>

        <div class="moga-kpi-card" style="background: var(--bg-surface, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column;">
          <span style="font-size: 0.76rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted, #64748b);">Censo MoGa</span>
          <span style="font-size: 1.35rem; font-weight: 800; color: #1e3a8a; margin-top: 2px;">${totalMoga}</span>
          <span style="font-size: 0.72rem; color: var(--text-muted, #64748b);">Archivo oficial ITACyL</span>
        </div>

        <div class="moga-kpi-card" style="background: var(--bg-surface, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column;">
          <span style="font-size: 0.76rem; font-weight: 600; text-transform: uppercase; color: #047857;">Coincidentes</span>
          <span style="font-size: 1.35rem; font-weight: 800; color: #059669; margin-top: 2px;">${coincidentes}</span>
          <span style="font-size: 0.72rem; color: var(--text-muted, #64748b);">En ambos registros</span>
        </div>

        <div class="moga-kpi-card" style="background: var(--bg-surface, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column;">
          <span style="font-size: 0.76rem; font-weight: 600; text-transform: uppercase; color: ${esConciliado100 ? '#64748b' : '#b91c1c'};">Discrepancias</span>
          <span style="font-size: 1.35rem; font-weight: 800; color: ${esConciliado100 ? '#059669' : '#dc2626'}; margin-top: 2px;">${discrepanciasTotales}</span>
          <span style="font-size: 0.72rem; color: var(--text-muted, #64748b);">${esConciliado100 ? 'Sin diferencias' : 'Pendientes de cotejo'}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Genera el marcado HTML para una tarjeta individual de discrepancia.
 */
function renderItemDiscrepancia(item, categoria) {
  const crotal = escapeHtml(item.crotal || "");
  const crotal4 = escapeHtml(item.crotal_4 || extraer4Digitos(item.crotal) || "-");
  const motivo = escapeHtml(item.motivo || "");
  const corral = item.corral ? escapeHtml(item.corral) : "";
  const estadoMoga = item.estado_moga ? escapeHtml(item.estado_moga) : "";
  const explotacion = item.explotacion ? escapeHtml(item.explotacion) : "";

  let badgeColor = "#475569";
  let badgeBg = "#f1f5f9";
  let categoriaLabel = "Discrepancia";

  if (categoria === "no_en_moga") {
    badgeColor = "#b91c1c";
    badgeBg = "#fef2f2";
    categoriaLabel = "No en MoGa (Activo en campo)";
  } else if (categoria === "bajas_oficiales_activas_local") {
    badgeColor = "#c2410c";
    badgeBg = "#fff7ed";
    categoriaLabel = "Baja oficial activa en campo";
  } else if (categoria === "bajas_locales_activas_oficial") {
    badgeColor = "#a16207";
    badgeBg = "#fefce8";
    categoriaLabel = "Baja en campo activa en MoGa";
  } else if (categoria === "no_en_campo") {
    badgeColor = "#334155";
    badgeBg = "#f8fafc";
    categoriaLabel = "No registrado en campo";
  }

  return `
    <div class="moga-discrepancia-card" style="background: var(--bg-surface, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
        <div style="display: flex; align-items: baseline; gap: 6px;">
          <span style="font-family: monospace; font-size: 1.15rem; font-weight: 800; color: var(--text-main, #0f172a);">${crotal4}</span>
          <span style="font-family: monospace; font-size: 0.82rem; color: var(--text-muted, #64748b);">${crotal}</span>
        </div>
        <span class="moga-item-badge" style="font-size: 0.72rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; color: ${badgeColor}; background: ${badgeBg}; border: 1px solid ${badgeColor}33;">
          ${categoriaLabel}
        </span>
      </div>

      <div style="font-size: 0.84rem; color: var(--text-main, #334155); line-height: 1.35;">
        ${motivo}
      </div>

      ${(corral || estadoMoga || explotacion) ? `
        <div style="display: flex; gap: 10px; font-size: 0.76rem; color: var(--text-muted, #64748b); border-top: 1px dashed var(--border-color, #e2e8f0); padding-top: 6px; margin-top: 2px;">
          ${corral ? `<span>📍 Corral: <strong style="color: var(--text-main, #0f172a);">${corral}</strong></span>` : ''}
          ${estadoMoga ? `<span>⚖️ Estado MoGa: <strong style="color: var(--text-main, #0f172a);">${estadoMoga}</strong></span>` : ''}
          ${explotacion ? `<span>🏠 Explotación: <strong style="color: var(--text-main, #0f172a);">${explotacion}</strong></span>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Genera el listado HTML de discrepancias según el filtro seleccionado.
 * @param {Object} resultado Objeto de respuesta de conciliación con las 4 listas.
 * @param {string} filtro Categoría a mostrar ('todos', 'no_en_moga', 'bajas_oficiales_activas_local', 'bajas_locales_activas_oficial', 'no_en_campo').
 * @returns {string} Marcado HTML con las tarjetas o el estado vacío.
 */
export function generarDiscrepanciasMogaHTML(resultado = {}, filtro = "todos") {
  const noEnMoga = Array.isArray(resultado?.no_en_moga) ? resultado.no_en_moga : [];
  const bajasOficialesActivasLocal = Array.isArray(resultado?.bajas_oficiales_activas_local) ? resultado.bajas_oficiales_activas_local : [];
  const bajasLocalesActivasOficial = Array.isArray(resultado?.bajas_locales_activas_oficial) ? resultado.bajas_locales_activas_oficial : [];
  const noEnCampo = Array.isArray(resultado?.no_en_campo) ? resultado.no_en_campo : [];

  let itemsParaRenderizar = [];

  if (filtro === "todos" || filtro === "no_en_moga") {
    itemsParaRenderizar.push(...noEnMoga.map(item => ({ item, categoria: "no_en_moga" })));
  }
  if (filtro === "todos" || filtro === "bajas_oficiales_activas_local") {
    itemsParaRenderizar.push(...bajasOficialesActivasLocal.map(item => ({ item, categoria: "bajas_oficiales_activas_local" })));
  }
  if (filtro === "todos" || filtro === "bajas_locales_activas_oficial") {
    itemsParaRenderizar.push(...bajasLocalesActivasOficial.map(item => ({ item, categoria: "bajas_locales_activas_oficial" })));
  }
  if (filtro === "todos" || filtro === "no_en_campo") {
    itemsParaRenderizar.push(...noEnCampo.map(item => ({ item, categoria: "no_en_campo" })));
  }

  if (itemsParaRenderizar.length === 0) {
    return `
      <div class="moga-empty-state" style="padding: 24px 16px; text-align: center; background: var(--bg-surface, #ffffff); border: 1px dashed var(--border-color, #cbd5e1); border-radius: 12px; margin: 12px 0;">
        <span style="font-size: 2rem; display: block; margin-bottom: 8px;">🎉</span>
        <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-main, #0f172a);">
          No hay discrepancias en esta categoría
        </div>
        <div style="font-size: 0.82rem; color: var(--text-muted, #64748b); margin-top: 4px;">
          Todos los registros evaluados coinciden con los datos oficiales.
        </div>
      </div>
    `;
  }

  return `
    <div class="moga-discrepancias-list" style="display: flex; flex-direction: column;">
      ${itemsParaRenderizar.map(({ item, categoria }) => renderItemDiscrepancia(item, categoria)).join("")}
    </div>
  `;
}

/**
 * Obtiene o crea el elemento contenedor del modal en el DOM (patrón singleton).
 */
function obtenerModalContainer() {
  let modal = document.getElementById("modal-conciliacion-moga");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-conciliacion-moga";
    modal.className = "modal-overlay";
    modal.style.cssText = "position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 12px;";
    document.body.appendChild(modal);
  }
  return modal;
}

/**
 * Abre el modal interactivo de conciliación de censo MoGa.
 * Todos los elementos interactivos cumplen con el estándar táctil WCAG AAA (>= 48px).
 */
export function abrirModalConciliacionMoga() {
  const modal = obtenerModalContainer();
  ultimoResultadoConciliacion = null;
  filtroActivoActual = "todos";

  modal.innerHTML = `
    <div class="modal-dialog moga-modal-dialog" style="max-width: 540px; width: 100%; max-height: 90vh; background: var(--bg-surface, #ffffff); border-radius: var(--radius-lg, 16px); box-shadow: 0 16px 36px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
      
      <!-- Cabecera Accesible Táctil -->
      <div style="background: var(--brand-primary, #1e3a2b); color: #ffffff; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">📋</span>
          <div>
            <h3 style="margin: 0; font-size: 1.12rem; font-weight: 700; color: #ffffff;">Conciliación Censo MoGa</h3>
            <span style="font-size: 0.78rem; opacity: 0.88;">Cotejo oficial ITACyL frente al censo de campo</span>
          </div>
        </div>
        <button id="btn-cerrar-modal-moga" aria-label="Cerrar modal" style="background: rgba(255,255,255,0.18); border: none; color: #ffffff; min-width: 48px; min-height: 48px; width: 48px; height: 48px; border-radius: 50%; font-size: 1.25rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s;">
          ✕
        </button>
      </div>

      <!-- Contenedor Scrolleable -->
      <div class="modal-body-scroll" style="padding: 18px; overflow-y: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px;">
        
        <!-- Mensajería de error inline accesible -->
        <div id="moga-modal-error" style="display: none; background: #fee2e2; color: #991b1b; padding: 12px 14px; border-radius: 10px; font-size: 0.88rem; font-weight: 600; border: 1px solid #fecaca; line-height: 1.35;"></div>

        <!-- SECCIÓN 1: Selección y Carga de Archivo CSV -->
        <div id="moga-seccion-carga" style="display: flex; flex-direction: column; gap: 12px;">
          <p style="margin: 0; font-size: 0.88rem; color: var(--text-main, #334155); line-height: 1.4;">
            Selecciona el archivo oficial <strong>.csv</strong> descargado del portal MoGa / ITACyL para verificar altas, bajas y animales presentes en campo.
          </p>

          <!-- Input tipo file oculto y botón táctil accesible >= 48px -->
          <input type="file" id="input-csv-moga" accept=".csv" style="display: none;" />

          <label for="input-csv-moga" id="btn-seleccionar-csv-moga" class="btn-moga-file-picker" style="min-height: 48px; min-width: 48px; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px 18px; border-radius: 10px; border: 2px dashed var(--brand-primary, #1e3a2b); background: #f0fdf4; color: var(--brand-primary, #1e3a2b); font-weight: 700; font-size: 0.95rem; cursor: pointer; text-align: center; box-sizing: border-box; transition: all 0.2s;">
            <span style="font-size: 1.2rem;">📁</span>
            <span id="label-texto-archivo">Seleccionar archivo CSV MoGa</span>
          </label>

          <!-- Banner con nombre del archivo seleccionado -->
          <div id="moga-archivo-info" style="display: none; align-items: center; justify-content: space-between; padding: 10px 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
              <span>📄</span>
              <span id="moga-archivo-nombre" style="font-size: 0.85rem; font-weight: 600; color: var(--text-main, #0f172a); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;"></span>
            </div>
            <button id="btn-quitar-archivo-moga" type="button" aria-label="Quitar archivo" style="min-width: 48px; min-height: 48px; background: none; border: none; color: #dc2626; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">
              ✕
            </button>
          </div>

          <!-- Botón de acción para conciliar >= 48px -->
          <button id="btn-subir-moga" type="button" disabled style="min-height: 48px; min-width: 48px; width: 100%; border-radius: 10px; border: none; background: var(--brand-primary, #1e3a2b); color: #ffffff; font-size: 1rem; font-weight: 700; cursor: not-allowed; opacity: 0.5; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s;">
            <span>🚀</span>
            <span>Conciliar Censo con MoGa</span>
          </button>

          <!-- Estado de carga / Spinner -->
          <div id="moga-loading" style="display: none; align-items: center; justify-content: center; gap: 10px; padding: 14px; color: var(--brand-primary, #1e3a2b); font-weight: 600; font-size: 0.9rem;">
            <div class="moga-spinner" style="width: 24px; height: 24px; border: 3px solid #cbd5e1; border-top-color: var(--brand-primary, #1e3a2b); border-radius: 50%; animation: spinMoga 0.8s linear infinite;"></div>
            <span>Procesando y cruzando censo con MoGa...</span>
          </div>
        </div>

        <!-- SECCIÓN 2: Resultados y Discrepancias -->
        <div id="moga-seccion-resultados" style="display: none; flex-direction: column; gap: 14px;">
          <!-- Resumen de Métricas -->
          <div id="moga-contenedor-resumen"></div>

          <!-- Barra de Pestañas / Chips de Filtro (Touch targets >= 48px) -->
          <div class="moga-filter-chips" style="display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 8px; -webkit-overflow-scrolling: touch;">
            <button class="moga-chip-btn active" data-filtro="todos" style="min-height: 48px; min-width: 48px; padding: 0 16px; border-radius: 9999px; border: 1px solid var(--border-color, #cbd5e1); background: var(--brand-primary, #1e3a2b); color: #ffffff; font-size: 0.86rem; font-weight: 700; cursor: pointer; white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>Todos</span>
              <span id="badge-count-todos" style="padding: 2px 6px; border-radius: 9999px; background: rgba(255,255,255,0.25); font-size: 0.74rem;">0</span>
            </button>

            <button class="moga-chip-btn" data-filtro="no_en_moga" style="min-height: 48px; min-width: 48px; padding: 0 14px; border-radius: 9999px; border: 1px solid var(--border-color, #cbd5e1); background: var(--bg-surface, #ffffff); color: var(--text-main, #334155); font-size: 0.86rem; font-weight: 600; cursor: pointer; white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>Ausentes MoGa</span>
              <span id="badge-count-no_en_moga" style="padding: 2px 6px; border-radius: 9999px; background: #fee2e2; color: #991b1b; font-size: 0.74rem;">0</span>
            </button>

            <button class="moga-chip-btn" data-filtro="bajas_oficiales_activas_local" style="min-height: 48px; min-width: 48px; padding: 0 14px; border-radius: 9999px; border: 1px solid var(--border-color, #cbd5e1); background: var(--bg-surface, #ffffff); color: var(--text-main, #334155); font-size: 0.86rem; font-weight: 600; cursor: pointer; white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>Bajas MoGa activas</span>
              <span id="badge-count-bajas_oficiales" style="padding: 2px 6px; border-radius: 9999px; background: #ffedd5; color: #9a3412; font-size: 0.74rem;">0</span>
            </button>

            <button class="moga-chip-btn" data-filtro="bajas_locales_activas_oficial" style="min-height: 48px; min-width: 48px; padding: 0 14px; border-radius: 9999px; border: 1px solid var(--border-color, #cbd5e1); background: var(--bg-surface, #ffffff); color: var(--text-main, #334155); font-size: 0.86rem; font-weight: 600; cursor: pointer; white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>Bajas campo activas</span>
              <span id="badge-count-bajas_locales" style="padding: 2px 6px; border-radius: 9999px; background: #fef9c3; color: #854d0e; font-size: 0.74rem;">0</span>
            </button>

            <button class="moga-chip-btn" data-filtro="no_en_campo" style="min-height: 48px; min-width: 48px; padding: 0 14px; border-radius: 9999px; border: 1px solid var(--border-color, #cbd5e1); background: var(--bg-surface, #ffffff); color: var(--text-main, #334155); font-size: 0.86rem; font-weight: 600; cursor: pointer; white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>No en campo</span>
              <span id="badge-count-no_en_campo" style="padding: 2px 6px; border-radius: 9999px; background: #f1f5f9; color: #475569; font-size: 0.74rem;">0</span>
            </button>
          </div>

          <!-- Listado de tarjetas de discrepancia -->
          <div id="moga-contenedor-discrepancias"></div>

          <!-- Botón táctil para subir otro CSV >= 48px -->
          <button id="btn-reiniciar-moga" type="button" style="min-height: 48px; min-width: 48px; width: 100%; border-radius: 10px; border: 1px solid var(--border-color, #cbd5e1); background: var(--bg-surface, #f8fafc); color: var(--text-main, #0f172a); font-size: 0.92rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 8px;">
            <span>🔄</span>
            <span>Cargar otro archivo MoGa</span>
          </button>
        </div>

      </div>

    </div>
  `;

  // Insertar keyframe de animación spinner si no existe
  if (!document.getElementById("style-moga-keyframes")) {
    const styleEl = document.createElement("style");
    styleEl.id = "style-moga-keyframes";
    styleEl.textContent = `
      @keyframes spinMoga {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  modal.style.display = "flex";

  // Enlace de Elementos DOM
  const btnCerrar = document.getElementById("btn-cerrar-modal-moga");
  const inputCsv = document.getElementById("input-csv-moga");
  const btnSubir = document.getElementById("btn-subir-moga");
  const bannerError = document.getElementById("moga-modal-error");
  const bannerArchivoInfo = document.getElementById("moga-archivo-info");
  const txtArchivoNombre = document.getElementById("moga-archivo-nombre");
  const btnQuitarArchivo = document.getElementById("btn-quitar-archivo-moga");
  const seccionCarga = document.getElementById("moga-seccion-carga");
  const seccionResultados = document.getElementById("moga-seccion-resultados");
  const contenedorResumen = document.getElementById("moga-contenedor-resumen");
  const contenedorDiscrepancias = document.getElementById("moga-contenedor-discrepancias");
  const btnReiniciar = document.getElementById("btn-reiniciar-moga");
  const loadingIndicator = document.getElementById("moga-loading");

  function cerrarModal() {
    modal.style.display = "none";
  }

  function mostrarError(mensaje) {
    if (bannerError) {
      bannerError.textContent = mensaje;
      bannerError.style.display = "block";
    }
  }

  function limpiarError() {
    if (bannerError) {
      bannerError.textContent = "";
      bannerError.style.display = "none";
    }
  }

  function resetearSeleccionArchivo() {
    if (inputCsv) inputCsv.value = "";
    if (bannerArchivoInfo) bannerArchivoInfo.style.display = "none";
    if (btnSubir) {
      btnSubir.disabled = true;
      btnSubir.style.cursor = "not-allowed";
      btnSubir.style.opacity = "0.5";
    }
  }

  // Cerrar en clic al botón o clic al overlay
  btnCerrar?.addEventListener("click", cerrarModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrarModal();
  });

  // Manejador de selección de archivo
  inputCsv?.addEventListener("change", (e) => {
    limpiarError();
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (!file.name.toLowerCase().endsWith(".csv")) {
        mostrarError("Por favor seleccione un archivo con formato .csv.");
        resetearSeleccionArchivo();
        return;
      }
      if (txtArchivoNombre) txtArchivoNombre.textContent = file.name;
      if (bannerArchivoInfo) bannerArchivoInfo.style.display = "flex";
      if (btnSubir) {
        btnSubir.disabled = false;
        btnSubir.style.cursor = "pointer";
        btnSubir.style.opacity = "1";
      }
    } else {
      resetearSeleccionArchivo();
    }
  });

  // Botón para deseleccionar archivo
  btnQuitarArchivo?.addEventListener("click", () => {
    limpiarError();
    resetearSeleccionArchivo();
  });

  // Botón para subir y conciliar
  btnSubir?.addEventListener("click", async () => {
    limpiarError();
    const files = inputCsv?.files;
    if (!files || files.length === 0) {
      mostrarError("Debe seleccionar un archivo CSV de MoGa.");
      return;
    }

    const file = files[0];
    btnSubir.disabled = true;
    btnSubir.style.cursor = "not-allowed";
    btnSubir.style.opacity = "0.5";
    if (loadingIndicator) loadingIndicator.style.display = "flex";

    try {
      const data = await conciliarArchivoMoga(file);
      ultimoResultadoConciliacion = data;
      filtroActivoActual = "todos";

      // Renderizar resumen
      if (contenedorResumen) {
        contenedorResumen.innerHTML = renderizarResumenMogaHTML(data.resumen);
      }

      // Actualizar contadores de los badges de pestañas
      const totalDisc = Number(data.resumen?.discrepancias_totales ?? 0);
      const cNoMoga = Array.isArray(data.no_en_moga) ? data.no_en_moga.length : 0;
      const cBajasOfi = Array.isArray(data.bajas_oficiales_activas_local) ? data.bajas_oficiales_activas_local.length : 0;
      const cBajasLoc = Array.isArray(data.bajas_locales_activas_oficial) ? data.bajas_locales_activas_oficial.length : 0;
      const cNoCampo = Array.isArray(data.no_en_campo) ? data.no_en_campo.length : 0;

      const elBadgeTodos = document.getElementById("badge-count-todos");
      const elBadgeNoMoga = document.getElementById("badge-count-no_en_moga");
      const elBadgeBajasOfi = document.getElementById("badge-count-bajas_oficiales");
      const elBadgeBajasLoc = document.getElementById("badge-count-bajas_locales");
      const elBadgeNoCampo = document.getElementById("badge-count-no_en_campo");

      if (elBadgeTodos) elBadgeTodos.textContent = totalDisc;
      if (elBadgeNoMoga) elBadgeNoMoga.textContent = cNoMoga;
      if (elBadgeBajasOfi) elBadgeBajasOfi.textContent = cBajasOfi;
      if (elBadgeBajasLoc) elBadgeBajasLoc.textContent = cBajasLoc;
      if (elBadgeNoCampo) elBadgeNoCampo.textContent = cNoCampo;

      // Renderizar discrepancias iniciales (filtro = todos)
      if (contenedorDiscrepancias) {
        contenedorDiscrepancias.innerHTML = generarDiscrepanciasMogaHTML(data, "todos");
      }

      // Cambiar a vista de resultados
      if (seccionCarga) seccionCarga.style.display = "none";
      if (seccionResultados) seccionResultados.style.display = "flex";

    } catch (err) {
      mostrarError(err.message || "Error inesperado al conciliar censo.");
      btnSubir.disabled = false;
      btnSubir.style.cursor = "pointer";
      btnSubir.style.opacity = "1";
    } finally {
      if (loadingIndicator) loadingIndicator.style.display = "none";
    }
  });

  // Chips de filtro por categoría
  modal.querySelectorAll(".moga-chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      const filtro = chip.dataset.filtro || "todos";
      filtroActivoActual = filtro;

      modal.querySelectorAll(".moga-chip-btn").forEach((c) => {
        c.classList.remove("active");
        c.style.background = "var(--bg-surface, #ffffff)";
        c.style.color = "var(--text-main, #334155)";
        c.style.fontWeight = "600";
      });

      chip.classList.add("active");
      chip.style.background = "var(--brand-primary, #1e3a2b)";
      chip.style.color = "#ffffff";
      chip.style.fontWeight = "700";

      if (contenedorDiscrepancias && ultimoResultadoConciliacion) {
        contenedorDiscrepancias.innerHTML = generarDiscrepanciasMogaHTML(ultimoResultadoConciliacion, filtro);
      }
    });
  });

  // Botón para reiniciar y cargar otro archivo
  btnReiniciar?.addEventListener("click", () => {
    limpiarError();
    resetearSeleccionArchivo();
    if (seccionResultados) seccionResultados.style.display = "none";
    if (seccionCarga) seccionCarga.style.display = "flex";
  });
}
