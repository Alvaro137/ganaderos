// modules/views/cattle_view.js
/**
 * Vista de Censo y Búsqueda de Animales con Teclado Numérico Táctil de Campo y Split View.
 */

import { AppState, esPantallaEscritorio, escapeHtml, calcularEdad, formatearFecha, dispararToast } from '../config.js';
import { buscarAnimales, contarAnimales, comprobarActualizacionServidor, sincronizarBaseDatosAhora, obtenerEstadoSync } from '../db.js';
import { seleccionarAnimal } from './detail_view.js';
import { abrirModalRegistroParto } from './birth_modal.js';

export function renderVistaAnimales() {
  const container = document.getElementById("app-container");
  if (!container) return;

  const esDesktop = esPantallaEscritorio();

  container.innerHTML = `
    <div class="split-layout">
      <!-- Columna Izquierda: Buscador y Listado de Animales -->
      <section class="left-panel">
        
        <!-- Banner de Actualización de Censo PC -> Móvil -->
        <aside id="banner-sync-actualizacion" class="sync-banner" style="display: none;"></aside>

        <div class="search-card">
          <div class="search-input-wrapper">
            <input 
              type="text" 
              id="txt-busqueda" 
              class="search-input" 
              placeholder="Buscar por 4 dígitos, crotal o lote..." 
              value="${escapeHtml(AppState.terminoBusqueda)}"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="btn-input-clear" id="btn-clear-search" style="display: ${AppState.terminoBusqueda ? 'flex' : 'none'};">✕</button>
          </div>

          <div class="search-actions">
            <label class="filter-toggle">
              <input type="checkbox" id="chk-activos" ${AppState.soloActivos ? "checked" : ""}>
              <span>Solo activos</span>
            </label>

            <div class="search-action-buttons">
              <!-- Estado de sincronización del censo -->
              <button class="btn-sync-status-badge" id="btn-sync-status-badge" title="Estado de sincronización de la base de datos">
                <span class="sync-dot" id="sync-status-dot"></span>
                <span class="sync-text" id="sync-status-text">Censo</span>
              </button>

              <!-- Botón para alternar teclado numérico para uso en manga/campo -->
              <button class="btn-toggle-keypad" id="btn-toggle-keypad" title="Alternar teclado numérico">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                  <circle cx="6" cy="8" r="1"></circle>
                  <circle cx="10" cy="8" r="1"></circle>
                  <circle cx="14" cy="8" r="1"></circle>
                  <circle cx="18" cy="8" r="1"></circle>
                  <circle cx="6" cy="12" r="1"></circle>
                  <circle cx="10" cy="12" r="1"></circle>
                  <circle cx="14" cy="12" r="1"></circle>
                  <circle cx="18" cy="12" r="1"></circle>
                </svg>
                <span>Teclado</span>
              </button>

              <!-- Botón para registrar parto directamente en campo -->
              <button class="btn-nuevo-parto-header" id="btn-nuevo-parto-header" title="Registrar nuevo parto en campo">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>+ Parto</span>
              </button>
            </div>
          </div>

          <!-- Teclado Numérico Táctil -->
          <div class="touch-keypad ${AppState.tecladoTactilVisible ? 'visible' : ''}" id="touch-keypad">
            <button class="t-key" data-digit="1">1</button>
            <button class="t-key" data-digit="2">2</button>
            <button class="t-key" data-digit="3">3</button>
            <button class="t-key" data-digit="4">4</button>
            <button class="t-key" data-digit="5">5</button>
            <button class="t-key" data-digit="6">6</button>
            <button class="t-key" data-digit="7">7</button>
            <button class="t-key" data-digit="8">8</button>
            <button class="t-key" data-digit="9">9</button>
            <button class="t-key t-key-action" id="btn-keypad-back">⌫</button>
            <button class="t-key" data-digit="0">0</button>
            <button class="t-key t-key-action" id="btn-keypad-clear">C</button>
          </div>
        </div>

        <div class="list-meta">
          <span>Animales</span>
          <span id="results-count">Cargando...</span>
        </div>

        <div id="results-list"></div>
      </section>

      <!-- Columna Derecha: Detalle Activo (Ficha de Animal o Lote en PC) -->
      <section class="right-panel" id="detail-panel">
        <div class="empty-panel">
          <img src="./icon-192.png" alt="Ganaderos" style="width: 72px; height: 72px; opacity: 0.55; margin-bottom: 12px; object-fit: contain;">
          <p style="font-weight: 600; font-size: 1.05rem; color: var(--text-muted); margin-bottom: 4px;">Ningún animal seleccionado</p>
          <p style="font-size: 0.88rem;">Selecciona una vaca de la lista izquierda para ver su ficha completa, partos, becerros y lote.</p>
        </div>
      </section>
    </div>
  `;

  const btnClear = document.getElementById("btn-clear-search");
  const inputSearch = document.getElementById("txt-busqueda");

  const actualizarVisibilidadClear = () => {
    if (btnClear) {
      btnClear.style.display = AppState.terminoBusqueda ? "flex" : "none";
    }
  };

  if (inputSearch) {
    inputSearch.addEventListener("input", (e) => {
      AppState.terminoBusqueda = e.target.value;
      AppState.limiteAnimales = 50;
      actualizarVisibilidadClear();
      ejecutarBusquedaYListar();
    });
    if (esDesktop) {
      inputSearch.focus();
    }
  }

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      AppState.terminoBusqueda = "";
      AppState.limiteAnimales = 50;
      actualizarVisibilidadClear();
      if (inputSearch) {
        inputSearch.value = "";
        inputSearch.focus();
      }
      ejecutarBusquedaYListar();
    });
  }

  const chkActivos = document.getElementById("chk-activos");
  if (chkActivos) {
    chkActivos.addEventListener("change", (e) => {
      AppState.soloActivos = e.target.checked;
      AppState.limiteAnimales = 50;
      ejecutarBusquedaYListar();
    });
  }

  const btnToggleKeypad = document.getElementById("btn-toggle-keypad");
  const keypad = document.getElementById("touch-keypad");
  if (btnToggleKeypad && keypad) {
    btnToggleKeypad.addEventListener("click", () => {
      AppState.tecladoTactilVisible = !AppState.tecladoTactilVisible;
      keypad.classList.toggle("visible", AppState.tecladoTactilVisible);
    });
  }

  const btnNuevoParto = document.getElementById("btn-nuevo-parto-header");
  if (btnNuevoParto) {
    btnNuevoParto.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      abrirModalRegistroParto();
    });
  }

  container.querySelectorAll(".t-key[data-digit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      AppState.terminoBusqueda += btn.dataset.digit;
      AppState.limiteAnimales = 50;
      if (inputSearch) inputSearch.value = AppState.terminoBusqueda;
      actualizarVisibilidadClear();
      ejecutarBusquedaYListar();
    });
  });

  const btnKeypadBack = document.getElementById("btn-keypad-back");
  if (btnKeypadBack) {
    btnKeypadBack.addEventListener("click", () => {
      AppState.terminoBusqueda = AppState.terminoBusqueda.slice(0, -1);
      AppState.limiteAnimales = 50;
      if (inputSearch) inputSearch.value = AppState.terminoBusqueda;
      actualizarVisibilidadClear();
      ejecutarBusquedaYListar();
    });
  }

  const btnKeypadClear = document.getElementById("btn-keypad-clear");
  if (btnKeypadClear) {
    btnKeypadClear.addEventListener("click", () => {
      AppState.terminoBusqueda = "";
      AppState.limiteAnimales = 50;
      if (inputSearch) inputSearch.value = "";
      actualizarVisibilidadClear();
      ejecutarBusquedaYListar();
    });
  }

  const resultsListEl = document.getElementById("results-list");
  if (resultsListEl) {
    resultsListEl.addEventListener("click", (e) => {
      const card = e.target.closest(".animal-card");
      if (card && card.dataset.crotal) {
        seleccionarAnimal(card.dataset.crotal, true);
      }
    });
  }

  const btnSyncBadge = document.getElementById("btn-sync-status-badge");
  if (btnSyncBadge) {
    btnSyncBadge.addEventListener("click", () => {
      abrirModalEstadoSync();
    });
  }

  ejecutarBusquedaYListar();

  if (AppState.crotalSeleccionado && esDesktop) {
    seleccionarAnimal(AppState.crotalSeleccionado, false);
  }

  // Comprobación no bloqueante de novedades de censo en servidor
  verificarYMostrarBannerSync();
}

export function ejecutarBusquedaYListar() {
  const resultsList = document.getElementById("results-list");
  const resultsCount = document.getElementById("results-count");
  if (!resultsList) return;

  const total = contarAnimales(AppState.terminoBusqueda, AppState.soloActivos);
  const limite = AppState.limiteAnimales || 50;
  const resultados = buscarAnimales(AppState.terminoBusqueda, AppState.soloActivos, limite);

  if (resultsCount) {
    if (total === 0) {
      resultsCount.textContent = "0 encontrados";
    } else if (resultados.length < total) {
      resultsCount.textContent = `Mostrando ${resultados.length} de ${total}`;
    } else {
      resultsCount.textContent = `${total} encontrados`;
    }
  }

  if (resultados.length === 0) {
    resultsList.innerHTML = `
      <div style="text-align: center; padding: 40px 15px; color: var(--text-dim); background: var(--bg-surface); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
        <p style="font-weight: 600; font-size: 1rem; color: var(--text-muted); margin-bottom: 4px;">Sin resultados</p>
        <p style="font-size: 0.85rem;">No se encontraron animales coincidentes.</p>
      </div>
    `;
    return;
  }

  const masDisponibles = resultados.length < total;
  const botonMasHtml = masDisponibles ? `
    <div class="load-more-container" style="padding: 16px 4px 24px; text-align: center;">
      <button id="btn-mostrar-mas-animales" class="btn-load-more" style="width: 100%; max-width: 320px; padding: 12px 20px; background: var(--md-surface-container-high); color: var(--brand-primary); font-size: 0.92rem; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease;">
        Mostrar más animales (+50)
      </button>
    </div>
  ` : "";

  resultsList.innerHTML = resultados
    .map((a) => {
      const esActivo = a.estado === "A";
      const estadoClase = esActivo ? "activo" : "baja";
      const estadoTexto = esActivo ? "Activo" : "Baja";
      const esSelected = AppState.crotalSeleccionado === a.crotal ? "selected" : "";
      const corralTexto = a.corral ? a.corral.trim() : "Sin lote";
      const partosTexto = a.total_partos > 0 ? `${a.total_partos} partos` : "Sin partos";

      return `
        <article class="animal-card ${esSelected}" data-crotal="${escapeHtml(a.crotal)}">
          <div class="card-header-row">
            <div class="crotal-box">
              <span class="crotal-4-digits">${escapeHtml(a.crotal_4)}</span>
              <span class="crotal-full-code">${escapeHtml(a.crotal)}</span>
            </div>
            <span class="status-pill ${estadoClase}">${estadoTexto}</span>
          </div>
          <div class="animal-specs-grid">
            <div>
              <div class="spec-label">Lote / Ubicación</div>
              <div class="spec-val">${escapeHtml(corralTexto)}</div>
            </div>
            <div>
              <div class="spec-label">Raza y Edad</div>
              <div class="spec-val">${escapeHtml(a.raza || "")} (${calcularEdad(a.fecha_nacimiento)})</div>
            </div>
            <div>
              <div class="spec-label">Historial Partos</div>
              <div class="spec-val">${partosTexto}</div>
            </div>
            <div>
              <div class="spec-label">Último Parto</div>
              <div class="spec-val">${a.fecha_ult_parto ? formatearFecha(a.fecha_ult_parto) : "-"}</div>
            </div>
          </div>
        </article>
      `;
    })
    .join("") + botonMasHtml;

  if (masDisponibles) {
    const btnMas = document.getElementById("btn-mostrar-mas-animales");
    if (btnMas) {
      btnMas.addEventListener("click", () => {
        AppState.limiteAnimales = (AppState.limiteAnimales || 50) + 50;
        ejecutarBusquedaYListar();
      });
    }
  }

  // En PC seleccionar automáticamente el primero si aún no hay ninguno seleccionado
  if (esPantallaEscritorio() && resultados.length > 0 && !AppState.crotalSeleccionado && !AppState.corralSeleccionado) {
    seleccionarAnimal(resultados[0].crotal, false);
  }
}

export async function verificarYMostrarBannerSync() {
  const banner = document.getElementById("banner-sync-actualizacion");
  const dot = document.getElementById("sync-status-dot");
  const text = document.getElementById("sync-status-text");

  try {
    const res = await comprobarActualizacionServidor();
    if (!res || !res.ok) {
      if (dot) dot.className = "sync-dot offline";
      if (text) text.textContent = "Offline";
      return;
    }

    if (res.hayActualizacion) {
      if (dot) dot.className = "sync-dot has-update";
      if (text) text.textContent = "Actualizar";

      if (banner) {
        const fechaServidor = res.serverMeta && res.serverMeta.mtime 
          ? new Date(res.serverMeta.mtime * 1000) 
          : new Date();
        const fechaStr = fechaServidor.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }) + 
          " a las " + fechaServidor.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
        const totalAnim = res.serverMeta ? (res.serverMeta.total_animales || res.serverMeta.total_activos || 0) : 0;

        banner.style.display = "block";
        banner.innerHTML = `
          <div class="sync-banner-content">
            <div class="sync-banner-info">
              <span class="sync-banner-icon">🔄</span>
              <div>
                <strong>Nueva versión del censo en el PC disponible</strong>
                <div class="sync-banner-meta">Modificado el ${fechaStr} · ${totalAnim} animales</div>
              </div>
            </div>
            <div class="sync-banner-actions">
              <button id="btn-sync-descargar" class="btn-sync-cta">Actualizar ahora</button>
              <button id="btn-sync-cerrar" class="btn-sync-dismiss" aria-label="Descartar aviso">✕</button>
            </div>
          </div>
        `;

        const btnDescargar = document.getElementById("btn-sync-descargar");
        if (btnDescargar) {
          btnDescargar.addEventListener("click", async () => {
            btnDescargar.disabled = true;
            btnDescargar.textContent = "Descargando...";
            try {
              await sincronizarBaseDatosAhora();
              banner.style.display = "none";
              dispararToast("✅ Censo actualizado con éxito desde el PC");
              renderVistaAnimales();
            } catch (err) {
              btnDescargar.disabled = false;
              btnDescargar.textContent = "Reintentar";
              dispararToast("⚠️ Error actualizando censo: " + (err.message || err), true);
            }
          });
        }

        const btnCerrar = document.getElementById("btn-sync-cerrar");
        if (btnCerrar) {
          btnCerrar.addEventListener("click", () => {
            banner.style.display = "none";
          });
        }
      }
    } else {
      if (dot) dot.className = "sync-dot synced";
      if (text) text.textContent = "Al día";
      if (banner) banner.style.display = "none";
    }
  } catch (e) {
    console.warn("[Sync Banner] Error al verificar novedades:", e);
  }
}

export function abrirModalEstadoSync() {
  let modal = document.getElementById("modal-sync-info");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-sync-info";
    modal.className = "modal-overlay";
    document.body.appendChild(modal);
  }

  const { localMeta, historial } = obtenerEstadoSync();
  const fechaDescarga = localMeta && localMeta.descargado_en 
    ? new Date(localMeta.descargado_en).toLocaleString("es-ES") 
    : "Sin registro previo";
  const fechaPc = localMeta && localMeta.mtime 
    ? new Date(localMeta.mtime * 1000).toLocaleString("es-ES") 
    : "Desconocida";
  const totalAnim = localMeta && localMeta.total_animales != null 
    ? localMeta.total_animales 
    : contarAnimales("", false);

  const historialHtml = (historial && historial.length > 0)
    ? historial.slice(0, 6).map((h) => `
        <li style="padding: 8px 0; border-bottom: 1px solid var(--border-color); font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${escapeHtml(h.accion || "Sincronización")}</strong>: ${escapeHtml(h.detalle || "")}
            <div style="font-size: 0.75rem; color: var(--text-dim);">${new Date(h.timestamp).toLocaleString("es-ES")}</div>
          </div>
          <span style="font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 9999px; background: ${h.estado === 'Éxito' ? '#e8f5e9; color: #1b5e20' : '#fee2e2; color: #991b1b'};">${escapeHtml(h.estado || "Info")}</span>
        </li>
      `).join("")
    : `<li style="padding: 10px 0; color: var(--text-dim); font-size: 0.85rem;">No hay operaciones registradas aún.</li>`;

  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 480px; width: 92%; margin: 20px auto; background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: 0 10px 30px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column; max-height: 90vh;">
      <div style="background: var(--brand-primary); color: #fff; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.4rem;">🔄</span>
          <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #fff;">Estado del Censo y Sync</h3>
        </div>
        <button id="btn-cerrar-modal-sync" style="background: rgba(255,255,255,0.2); border: none; color: #fff; width: 40px; height: 40px; border-radius: 50%; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button>
      </div>

      <div style="padding: 20px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 16px;">
        <div style="background: var(--md-surface-container-low); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px;">
          <h4 style="margin: 0 0 10px; font-size: 0.92rem; color: var(--brand-primary);">Base de Datos Local (Móvil)</h4>
          <div style="font-size: 0.85rem; line-height: 1.6;">
            <div>📅 <strong>Última descarga:</strong> ${fechaDescarga}</div>
            <div>💻 <strong>Modificado en PC:</strong> ${fechaPc}</div>
            <div>🐮 <strong>Animales en censo:</strong> ${totalAnim} cabezas</div>
          </div>
        </div>

        <button id="btn-forzar-sync-modal" class="btn-sync-cta" style="width: 100%; height: 46px; font-size: 0.95rem; justify-content: center;">
          🔄 Comprobar y Actualizar Censo Ahora
        </button>

        <div>
          <h4 style="margin: 12px 0 8px; font-size: 0.88rem; color: var(--text-dim); text-transform: uppercase;">Historial de Sincronizaciones</h4>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${historialHtml}
          </ul>
        </div>
      </div>
    </div>
  `;

  modal.style.display = "flex";

  const btnCerrar = modal.querySelector("#btn-cerrar-modal-sync");
  if (btnCerrar) {
    btnCerrar.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  const btnForzar = modal.querySelector("#btn-forzar-sync-modal");
  if (btnForzar) {
    btnForzar.addEventListener("click", async () => {
      btnForzar.disabled = true;
      btnForzar.textContent = "Descargando censo actualizado...";
      try {
        await sincronizarBaseDatosAhora();
        dispararToast("✅ Censo actualizado con éxito");
        modal.style.display = "none";
        renderVistaAnimales();
      } catch (err) {
        btnForzar.disabled = false;
        btnForzar.textContent = "Reintentar";
        dispararToast("⚠️ Error actualizando: " + (err.message || err), true);
      }
    });
  }
}
