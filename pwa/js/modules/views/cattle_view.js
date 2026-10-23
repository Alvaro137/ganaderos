// modules/views/cattle_view.js

/**

 * Vista Unificada de Ganado: Censo y Movimientos integrados con Teclado Numérico Táctil de Campo y Split View.

 * Elimina duplicidad entre Censo y Movimientos; búsqueda de 4 dígitos transversal.

 */



import { AppState, esPantallaEscritorio, escapeHtml, calcularEdad, formatearFecha, dispararToast, clasificarMovimientoUnificado } from '../config.js';

import { buscarAnimales, contarAnimales, obtenerMovimientos, comprobarActualizacionServidor, sincronizarBaseDatosAhora, obtenerEstadoSync } from '../db.js';

import { seleccionarAnimal } from './detail_view.js';

import { abrirModalRegistroParto } from './birth_modal.js';

import { generarCardMovimientoHtml } from './movements_view.js';

import { verDetalleLiquidacion, renderVistaLiquidaciones } from './sales_view.js';



export function renderVistaGanado() {

  const container = document.getElementById("app-container");

  if (!container) return;



  const esDesktop = esPantallaEscritorio();

  const subTab = AppState.subTabGanado || "censo";

  const totalActivos = contarAnimales("", true);



  const tiposMovimiento = [

    { id: "TODOS", label: "Todos" },

    { id: "VENTA", label: "Ventas" },

    { id: "TRASPASO_CEBADERO", label: "Traspasos 121->122" },

    { id: "MOVIMIENTO_INTERNO", label: "Internos" },

    { id: "NACIMIENTO", label: "Nacimientos" },

    { id: "MUERTE", label: "Bajas" },

    { id: "COMPRA", label: "Compras" }

  ];



  const chipsMovHtml = tiposMovimiento.map(t => `

    <button class="chip-filtro-mov ${(AppState.tipoMovimiento || 'TODOS') === t.id ? 'active' : ''}" data-tipo="${t.id}" style="padding: 5px 12px; border-radius: var(--md-shape-full, 9999px); border: 1px solid var(--border-color); font-size: 0.78rem; font-weight: 600; cursor: pointer; background: ${(AppState.tipoMovimiento || 'TODOS') === t.id ? 'var(--brand-primary, #1e3a2b)' : 'var(--bg-surface)'}; color: ${(AppState.tipoMovimiento || 'TODOS') === t.id ? '#ffffff' : 'var(--text-main)'};">

      ${escapeHtml(t.label)}

    </button>

  `).join("");



  container.innerHTML = `

    <div class="split-layout">

      <!-- Columna Izquierda: Buscador y Listado de Animales / Movimientos -->

      <section class="left-panel">

        

        <!-- Conmutador Segmentado: Censo vs Movimientos -->

        <div class="ganado-nav-segmented" style="display: flex; gap: 6px; margin-bottom: 12px; background: var(--md-surface-container-low, #f1f5f9); padding: 4px; border-radius: var(--md-shape-full, 9999px);">

          <button class="ganado-segment-btn ${subTab === 'censo' ? 'active' : ''}" data-subtab="censo" style="flex: 1; padding: 8px 14px; border-radius: var(--md-shape-full, 9999px); border: none; font-size: 0.88rem; font-weight: 700; cursor: pointer; transition: all 0.2s ease; background: ${subTab === 'censo' ? 'var(--brand-primary, #1e3a2b)' : 'transparent'}; color: ${subTab === 'censo' ? '#ffffff' : 'var(--text-main, #0f172a)'}; display: flex; align-items: center; justify-content: center; gap: 6px;">

            <span>🐄 Censo</span>

            <span style="font-size: 0.76rem; opacity: 0.85; background: ${subTab === 'censo' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)'}; padding: 1px 7px; border-radius: 9999px;">${totalActivos}</span>

          </button>

          <button class="ganado-segment-btn ${subTab === 'movimientos' ? 'active' : ''}" data-subtab="movimientos" style="flex: 1; padding: 8px 14px; border-radius: var(--md-shape-full, 9999px); border: none; font-size: 0.88rem; font-weight: 700; cursor: pointer; transition: all 0.2s ease; background: ${subTab === 'movimientos' ? 'var(--brand-primary, #1e3a2b)' : 'transparent'}; color: ${subTab === 'movimientos' ? '#ffffff' : 'var(--text-main, #0f172a)'}; display: flex; align-items: center; justify-content: center; gap: 6px;">

            <span>🔄 Movimientos</span>

          </button>

        </div>



                ${subTab === 'movimientos' ? `
          <!-- Banner de acceso a Liquidaciones de Venta -->
          <div class="banner-liquidaciones" id="banner-ir-liquidaciones" style="cursor: pointer; margin-bottom: 12px; background: linear-gradient(135deg, #1e3a2b 0%, #2e5c43 100%); color: #ffffff; padding: 12px 16px; border-radius: var(--radius-md, 12px); display: flex; align-items: center; justify-content: space-between; box-shadow: 0 4px 12px rgba(30,58,43,0.15);">
            <div class="banner-liquidaciones-content" style="display: flex; align-items: center; gap: 12px;">
              <div class="banner-liquidaciones-icon" style="font-size: 1.5rem;">📊</div>
              <div>
                <div class="banner-liquidaciones-title" style="font-weight: 700; font-size: 0.95rem;">Liquidaciones de Venta y Matadero</div>
                <div class="banner-liquidaciones-desc" style="font-size: 0.78rem; opacity: 0.85;">Facturas oficiales GANAVAEX · Canales pesadas · Rendimiento</div>
              </div>
            </div>
            <span class="banner-liquidaciones-arrow" style="font-size: 1.2rem; font-weight: 700;">→</span>
          </div>
        ` : ""}

        <!-- Banner de Actualización de Censo PC -> Móvil -->

        <aside id="banner-sync-actualizacion" class="sync-banner" style="display: none;"></aside>



        <div class="search-card">

          <div class="search-input-wrapper">

            <input 

              type="text" 

              id="txt-busqueda" 

              class="search-input" 

              placeholder="${subTab === 'censo' ? 'Buscar por 4 dígitos, crotal o lote...' : 'Buscar movimientos por 4 cifras, crotal o REGA...'}" 

              value="${escapeHtml(AppState.terminoBusqueda)}"

              autocomplete="off"

              spellcheck="false"

            />

            <button class="btn-input-clear" id="btn-clear-search" style="display: ${AppState.terminoBusqueda ? 'flex' : 'none'};">✕</button>

          </div>



          <div class="search-actions">

            ${subTab === 'censo' ? `

              <label class="filter-toggle">

                <input type="checkbox" id="chk-activos" ${AppState.soloActivos ? "checked" : ""}>

                <span>Solo activos</span>

              </label>

            ` : `

              <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); display: flex; align-items: center; gap: 4px;">

                <span>Filtro de eventos:</span>

              </div>

            `}



            <div class="search-action-buttons">

              <!-- Estado de sincronización del censo -->

              <button class="btn-sync-status-badge" id="btn-sync-status-badge" title="Estado de sincronización de la base de datos">

                <span class="sync-dot synced" id="sync-status-dot"></span>

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



              <!-- Botón directo para registrar parto en campo -->

              <button class="btn-nuevo-parto-header" id="btn-nuevo-parto-header" title="Registrar nuevo parto en campo">

                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">

                  <line x1="12" y1="5" x2="12" y2="19"></line>

                  <line x1="5" y1="12" x2="19" y2="12"></line>

                </svg>

                <span>Parto</span>

              </button>

            </div>

          </div>



          <!-- Filtros de Movimientos cuando la pestaña de movimientos está activa -->

          ${subTab === 'movimientos' ? `

            <div class="movimientos-tipo-chips" id="ganado-mov-chips" style="display: flex; gap: 6px; overflow-x: auto; padding: 6px 0 2px; margin-top: 4px;">

              ${chipsMovHtml}

            </div>

          ` : ""}



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

          <span>${subTab === 'censo' ? 'Animales' : 'Historial de Movimientos'}</span>

          <span id="results-count">${subTab === 'movimientos' ? '<span id="movimientos-count">Cargando...</span>' : 'Cargando...'}</span>

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



  // Control segmentado Censo vs Movimientos

  container.querySelectorAll(".ganado-segment-btn").forEach(btn => {

    btn.addEventListener("click", () => {

      AppState.subTabGanado = btn.dataset.subtab || "censo";

      AppState.limiteAnimales = 50;

      renderVistaGanado();

    });

  });



  // Chips de movimiento

  container.querySelectorAll("#ganado-mov-chips .chip-filtro-mov").forEach(btn => {

    btn.addEventListener("click", () => {

      AppState.tipoMovimiento = btn.dataset.tipo;

      AppState.limiteAnimales = 50;

      container.querySelectorAll("#ganado-mov-chips .chip-filtro-mov").forEach(b => {

        b.style.background = "var(--bg-surface)";

        b.style.color = "var(--text-main)";

        b.classList.remove("active");

      });

      btn.style.background = "var(--brand-primary, #1e3a2b)";

      btn.style.color = "#ffffff";

      btn.classList.add("active");

      ejecutarBusquedaYListar();

    });

  });



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

      AppState.terminoBusqueda = (AppState.terminoBusqueda || "") + btn.dataset.digit;

      AppState.limiteAnimales = 50;

      if (inputSearch) inputSearch.value = AppState.terminoBusqueda;

      actualizarVisibilidadClear();

      ejecutarBusquedaYListar();

    });

  });



  const btnKeypadBack = document.getElementById("btn-keypad-back");

  if (btnKeypadBack) {

    btnKeypadBack.addEventListener("click", () => {

      AppState.terminoBusqueda = (AppState.terminoBusqueda || "").slice(0, -1);

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

      const card = e.target.closest(".animal-card") || e.target.closest("[data-action='select-animal']");

      if (card && card.dataset.crotal) {

        seleccionarAnimal(card.dataset.crotal, true);

        return;

      }



      const targetFactura = e.target.closest('[data-action="ver-factura"]');

      if (targetFactura && targetFactura.dataset.facturaId) {

        verDetalleLiquidacion(Number(targetFactura.dataset.facturaId), true);

        return;

      }

    });

  }



    const bannerLiq = container.querySelector(".banner-liquidaciones");
  if (bannerLiq) {
    bannerLiq.addEventListener("click", () => {
      AppState.tabActual = "finanzas";
      renderVistaLiquidaciones();
    });
  }

  const btnSyncStatus = document.getElementById("btn-sync-status-badge");
  if (btnSyncStatus) {
    btnSyncStatus.addEventListener("click", () => abrirModalEstadoSync());
  }

  comprobarActualizacionServidor().then((res) => {
    actualizarBannerSync(res);
  }).catch(() => {});

  ejecutarBusquedaYListar();



  if (AppState.crotalSeleccionado && esDesktop) {

    seleccionarAnimal(AppState.crotalSeleccionado, false);

  }

}



// Alias de retrocompatibilidad

export const renderVistaAnimales = renderVistaGanado;



export function ejecutarBusquedaYListar() {

  const subTab = AppState.subTabGanado || "censo";

  if (subTab === "movimientos") {

    ejecutarBusquedaMovimientosGanado();

  } else {

    ejecutarBusquedaCensoGanado();

  }

}



function ejecutarBusquedaCensoGanado() {

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

            <div style="display: flex; align-items: center; gap: 6px;">

              ${a.id_electronico ? `<span class="badge-rfid" style="font-size: 0.68rem; padding: 2px 6px; border-radius: 4px; background: rgba(37, 99, 235, 0.12); color: #1d4ed8; font-weight: 800;">RFID</span>` : ""}

              <span class="status-pill ${estadoClase}">${estadoTexto}</span>

            </div>

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



function ejecutarBusquedaMovimientosGanado() {

  const resultsList = document.getElementById("results-list");

  const resultsCount = document.getElementById("results-count");

  if (!resultsList) return;



  const movs = obtenerMovimientos({

    filtro: AppState.terminoBusqueda,

    tipo: AppState.tipoMovimiento || "TODOS",

    anio: AppState.anioMovimiento || "TODOS",

    destino: AppState.destinoMovimiento || "TODOS",

    limite: AppState.limiteAnimales || 50,

    offset: 0

  });



  const total = (movs && movs.total != null) ? movs.total : (movs ? movs.length : 0);



  if (resultsCount) {

    if (movs.length < total) {

      resultsCount.textContent = `Mostrando ${movs.length} de ${total.toLocaleString("es-ES")} movimientos`;

    } else {

      resultsCount.textContent = `${total.toLocaleString("es-ES")} movimientos`;

    }

  }



  if (movs.length === 0) {

    resultsList.innerHTML = `

      <div style="text-align: center; padding: 40px 15px; color: var(--text-dim); background: var(--bg-surface); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">

        <p style="font-weight: 600; font-size: 1rem; color: var(--text-muted); margin-bottom: 4px;">Sin movimientos encontrados</p>

        <p style="font-size: 0.85rem;">Prueba a cambiar el filtro de tipo de movimiento o limpiar el buscador.</p>

      </div>

    `;

    return;

  }



  const cardsHtml = movs.map(m => generarCardMovimientoHtml(m)).join("");

  const masDisponibles = movs.length < total;

  const botonMasHtml = masDisponibles ? `

    <div class="load-more-container" style="padding: 16px 4px 24px; text-align: center;">

      <button id="btn-mostrar-mas-animales" class="btn-load-more" style="width: 100%; max-width: 320px; padding: 12px 20px; background: var(--md-surface-container-high); color: var(--brand-primary); font-size: 0.92rem; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-md); cursor: pointer;">

        Mostrar más movimientos (+50)

      </button>

    </div>

  ` : "";



  resultsList.innerHTML = cardsHtml + botonMasHtml;



  if (masDisponibles) {

    const btnMas = document.getElementById("btn-mostrar-mas-animales");

    if (btnMas) {

      btnMas.addEventListener("click", () => {

        AppState.limiteAnimales = (AppState.limiteAnimales || 50) + 50;

        ejecutarBusquedaYListar();

      });

    }

  }

}



function actualizarBannerSync(res) {

  const banner = document.getElementById("banner-sync-actualizacion");

  const dot = document.getElementById("sync-status-dot");

  const text = document.getElementById("sync-status-text");



  if (!res || !(res.hayActualizacion || res.hayNovedad)) {

    if (dot) dot.className = "sync-dot synced";

    if (text) text.textContent = "Al día";

    if (banner) banner.style.display = "none";

    return;

  }



  if (dot) dot.className = "sync-dot has-update";

  if (text) text.textContent = "Novedades";



  if (banner) {

    const pcFecha = res.serverMeta && res.serverMeta.mtime 

      ? new Date(res.serverMeta.mtime * 1000).toLocaleString("es-ES") 

      : "Reciente";

    const totalAnim = res.serverMeta && res.serverMeta.total_animales ? res.serverMeta.total_animales : "disponibles";



    banner.innerHTML = `

      <div class="sync-banner-content">

        <div class="sync-banner-info">

          <span class="sync-banner-icon">⚡</span>

          <div>

            <strong>Nueva versión del censo en el PC disponible</strong>

            <div class="sync-banner-meta">Modificado: ${pcFecha} (${totalAnim} animales)</div>

          </div>

        </div>

        <div class="sync-banner-actions">

          <button id="btn-sync-descargar" class="btn-sync-cta">

            <span>⬇️ Descargar</span>

          </button>

          <button id="btn-sync-cerrar" class="btn-sync-dismiss" title="Descartar aviso">✕</button>

        </div>

      </div>

    `;

    banner.style.display = "block";



    const btnDescargar = banner.querySelector("#btn-sync-descargar");

    if (btnDescargar) {

      btnDescargar.addEventListener("click", async () => {

        btnDescargar.disabled = true;

        btnDescargar.textContent = "Descargando...";

        try {

          await sincronizarBaseDatosAhora();

          dispararToast("✅ Censo actualizado con éxito");

          banner.style.display = "none";

          renderVistaGanado();

        } catch (e) {

          btnDescargar.disabled = false;

          btnDescargar.textContent = "Reintentar";

          dispararToast("⚠️ Error al descargar censo: " + (e.message || e), true);

        }

      });

    }



    const btnCerrar = banner.querySelector("#btn-sync-cerrar");

    if (btnCerrar) {

      btnCerrar.addEventListener("click", () => {

        banner.style.display = "none";

      });

    }

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

        renderVistaGanado();

      } catch (err) {

        btnForzar.disabled = false;

        btnForzar.textContent = "Reintentar";

        dispararToast("⚠️ Error actualizando: " + (err.message || err), true);

      }

    });

  }

}

