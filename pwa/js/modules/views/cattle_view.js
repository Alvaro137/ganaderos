// modules/views/cattle_view.js
/**
 * Vista de Censo y Búsqueda de Animales con Teclado Numérico Táctil de Campo y Split View.
 */

import { AppState, esPantallaEscritorio, escapeHtml, calcularEdad, formatearFecha } from '../config.js';
import { buscarAnimales, contarAnimales } from '../db.js';
import { seleccionarAnimal } from './detail_view.js';

export function renderVistaAnimales() {
  const container = document.getElementById("app-container");
  if (!container) return;

  const esDesktop = esPantallaEscritorio();

  container.innerHTML = `
    <div class="split-layout">
      <!-- Columna Izquierda: Buscador y Listado de Animales -->
      <section class="left-panel">
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
            ${AppState.terminoBusqueda ? '<button class="btn-input-clear" id="btn-clear-search">✕</button>' : ''}
          </div>

          <div class="search-actions">
            <label class="filter-toggle">
              <input type="checkbox" id="chk-activos" ${AppState.soloActivos ? "checked" : ""}>
              <span>Solo activos</span>
            </label>

            <!-- Botón para alternar teclado numérico para uso en manga/campo -->
            <button class="btn-toggle-keypad" id="btn-toggle-keypad">
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
              <span>Teclado táctil</span>
            </button>

            <!-- Botón para registrar parto directamente en campo -->
            <button class="btn-nuevo-parto-header" id="btn-nuevo-parto-header" title="Registrar nuevo parto en campo">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Parto</span>
            </button>
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

  const inputSearch = document.getElementById("txt-busqueda");
  if (inputSearch) {
    inputSearch.addEventListener("input", (e) => {
      AppState.terminoBusqueda = e.target.value;
      AppState.limiteAnimales = 50;
      ejecutarBusquedaYListar();
    });
    if (esDesktop) {
      inputSearch.focus();
    }
  }

  const btnClear = document.getElementById("btn-clear-search");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      AppState.terminoBusqueda = "";
      AppState.limiteAnimales = 50;
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
    btnNuevoParto.addEventListener("click", () => {
      import('./birth_modal.js').then((m) => m.abrirModalRegistroParto());
    });
  }

  container.querySelectorAll(".t-key[data-digit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      AppState.terminoBusqueda += btn.dataset.digit;
      AppState.limiteAnimales = 50;
      if (inputSearch) inputSearch.value = AppState.terminoBusqueda;
      ejecutarBusquedaYListar();
    });
  });

  const btnKeypadBack = document.getElementById("btn-keypad-back");
  if (btnKeypadBack) {
    btnKeypadBack.addEventListener("click", () => {
      AppState.terminoBusqueda = AppState.terminoBusqueda.slice(0, -1);
      AppState.limiteAnimales = 50;
      if (inputSearch) inputSearch.value = AppState.terminoBusqueda;
      ejecutarBusquedaYListar();
    });
  }

  const btnKeypadClear = document.getElementById("btn-keypad-clear");
  if (btnKeypadClear) {
    btnKeypadClear.addEventListener("click", () => {
      AppState.terminoBusqueda = "";
      AppState.limiteAnimales = 50;
      if (inputSearch) inputSearch.value = "";
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

  ejecutarBusquedaYListar();
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
