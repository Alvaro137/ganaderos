/**
 * Controlador de interfaz y navegación adaptativa para Ganaderos Campo.
 * Diseñado para vacuno de carne con navegación en profundidad interconectada a base de clics.
 */

const AppState = {
  tabActual: "animales",
  terminoBusqueda: "",
  soloActivos: true,
  crotalSeleccionado: null,
  corralSeleccionado: null,
  filtroRecetas: "",
  filtroAlimentos: "",
  filtroMovimientos: "",
  tipoMovimiento: "TODOS",
  anioMovimiento: "TODOS",
  destinoMovimiento: "TODOS",
  tecladoTactilVisible: false,
  // Historial conversacional para preguntas de seguimiento (multi-turno) con IA
  conversacionIA: [],
  // Pila de navegación para permitir clics encadenados (vaca -> madre -> corral -> ternero -> ...)
  historial: []
};

// ============================================================
// HELPERS DE FORMATEO Y UTILIDADES
// ============================================================

function formatearFecha(isoStr) {
  if (!isoStr) return "-";
  const partes = isoStr.split("T")[0].split("-");
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : isoStr;
}

function formatearKg(kg) {
  if (kg == null) return "0";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(kg);
}

function formatearMoneda(val, decimales = 2) {
  if (val == null) return "0";
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  }).format(val);
}

function calcularEdad(fnacStr) {
  if (!fnacStr) return "-";
  const nac = new Date(fnacStr);
  const hoy = new Date();
  let anios = hoy.getFullYear() - nac.getFullYear();
  let meses = hoy.getMonth() - nac.getMonth();
  if (meses < 0) {
    anios--;
    meses += 12;
  }
  if (anios === 0) return `${meses} meses`;
  if (meses === 0) return `${anios} años`;
  return `${anios} a, ${meses} m`;
}

function calcularTiempoTranscurrido(fechaStr) {
  if (!fechaStr) return "";
  const f = new Date(fechaStr);
  const hoy = new Date();
  const diffMs = hoy - f;
  const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (dias < 30) return `hace ${dias} d`;
  const meses = Math.floor(dias / 30.4);
  if (meses < 12) return `hace ${meses} m`;
  const anios = Math.floor(meses / 12);
  return `hace ${anios} a`;
}

function extraer4Digitos(crotal) {
  if (!crotal) return "";
  const digitos = crotal.replace(/\D/g, "");
  return digitos.length >= 4 ? digitos.slice(-4) : digitos;
}

function esPantallaEscritorio() {
  return window.innerWidth >= 768;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ============================================================

function obtenerAuthHeaders() {
  const token = localStorage.getItem("campo_pwa_token") || "";
  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    headers["X-Auth-Token"] = token;
  }
  return headers;
}

function mostrarPantallaLogin(mensajeError = "") {
  const container = document.getElementById("app-container");
  container.innerHTML = `
    <div class="loading-state" style="max-width: 380px; margin: 0 auto; padding-top: 40px;">
      <img src="./icon-192.png" alt="Ganaderos" class="loading-logo" style="width: 72px; height: 72px;">
      <h2 style="font-size: 1.25rem; font-weight: 800; color: var(--text-main); margin-bottom: 2px;">
        Acceso Protegido
      </h2>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4;">
        Introduce la contraseña de la explotación para desbloquear el censo y el asistente:
      </p>

      ${mensajeError ? `
        <div style="background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 8px 12px; border-radius: var(--radius-sm); font-size: 0.82rem; margin-bottom: 12px; width: 100%;">
          ${escapeHtml(mensajeError)}
        </div>
      ` : ""}

      <form id="form-auth-login" style="width: 100%; display: flex; flex-direction: column; gap: 12px;">
        <input 
          type="password" 
          id="input-auth-pass" 
          placeholder="Contraseña..." 
          autocomplete="current-password"
          style="width: 100%; padding: 12px 14px; font-size: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color); background: var(--bg-surface); color: var(--text-main); outline: none; box-sizing: border-box;"
          required
        />
        <button 
          type="submit" 
          id="btn-submit-auth"
          style="width: 100%; padding: 12px; background: var(--brand-primary); color: #fff; font-size: 0.95rem; font-weight: 700; border: none; border-radius: var(--radius-md); cursor: pointer; transition: opacity 0.2s;"
        >
          Desbloquear Censo
        </button>
      </form>
    </div>
  `;

  const form = document.getElementById("form-auth-login");
  const input = document.getElementById("input-auth-pass");
  if (input) setTimeout(() => input.focus(), 150);

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pass = input.value.trim();
      if (!pass) return;

      const btn = document.getElementById("btn-submit-auth");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Verificando...";
      }

      try {
        const resp = await fetch("./api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pass })
        });
        const data = await resp.json();

        if (resp.ok && data.ok && data.token) {
          localStorage.setItem("campo_pwa_token", data.token);
          location.reload();
        } else {
          mostrarPantallaLogin(data.error || "Contraseña incorrecta.");
        }
      } catch (err) {
        mostrarPantallaLogin("Error conectando con el servidor: " + err.message);
      }
    });
  }
}

async function iniciarAplicacion() {
  const container = document.getElementById("app-container");

  try {
    await window.campoDB.inicializar((mensaje) => {
      const elMsg = document.getElementById("loading-msg");
      if (elMsg) elMsg.textContent = mensaje;
    });

    const fechaExp = window.campoDB.meta["fecha_exportacion"];
    const elFecha = document.getElementById("meta-fecha");
    if (elFecha && fechaExp) {
      elFecha.textContent = `Censo: ${formatearFecha(fechaExp)}`;
    }

    setupNavegacion();
    setupAsistenteIA();
    renderVistaAnimales();

    window.addEventListener(
      "resize",
      debounce(() => {
        if (AppState.tabActual === "animales" && !AppState.crotalSeleccionado && !AppState.corralSeleccionado) {
          renderVistaAnimales();
        }
      }, 200)
    );
  } catch (err) {
    if (err.message === "AUTH_REQUIRED") {
      mostrarPantallaLogin();
      return;
    }

    if (err.message === "SIN_CONEXION_INICIAL") {
      container.innerHTML = `
        <div class="loading-state">
          <img src="./icon-192.png" alt="Ganaderos" class="loading-logo" style="width: 56px; height: 56px; border-radius: 12px; margin-bottom: 12px;">
          <h2 style="font-size: 1.25rem; font-weight: 700; color: var(--text-main); margin-bottom: 8px;">Conexión requerida la primera vez</h2>
          <p style="color: var(--text-muted); font-size: 0.9rem; max-width: 340px; line-height: 1.5; margin-bottom: 20px;">
            Este dispositivo no dispone todavía del censo almacenado. Conéctate a internet una vez para descargarlo. A partir de ese momento, la app funcionará siempre 100% offline en el campo.
          </p>
          <button class="nav-link active" onclick="location.reload()" style="background: var(--brand-primary); color: #fff; padding: 10px 24px; border-radius: var(--radius-sm); font-size: 0.95rem; font-weight: 600; cursor: pointer;">
            Reintentar
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="loading-state">
        <h2 style="color: #991b1b;">Error al abrir base de datos</h2>
        <p style="color: var(--text-muted);">${err.message}</p>
        <button class="nav-link active" onclick="location.reload()" style="margin-top: 15px; background: var(--brand-primary); color: #fff; cursor: pointer;">
          Reintentar
        </button>
      </div>
    `;
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service Worker no registrado:", err);
    });
  }

  await iniciarAplicacion();
});

function setupNavegacion() {
  const desktopLinks = document.querySelectorAll(".nav-link");
  const mobileButtons = document.querySelectorAll(".mobile-tab-btn");

  function cambiarTab(tabKey) {
    if (AppState.tabActual === tabKey) return;
    AppState.tabActual = tabKey;

    desktopLinks.forEach((l) => l.classList.toggle("active", l.dataset.tab === tabKey));
    mobileButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabKey));

    if (tabKey === "animales") {
      renderVistaAnimales();
    } else if (tabKey === "recetas") {
      renderVistaRecetas();
    } else if (tabKey === "alimentos") {
      renderVistaAlimentos();
    } else if (tabKey === "movimientos") {
      renderVistaMovimientos();
    }
  }

  desktopLinks.forEach((l) => l.addEventListener("click", () => cambiarTab(l.dataset.tab)));
  mobileButtons.forEach((b) => b.addEventListener("click", () => cambiarTab(b.dataset.tab)));
}

// ============================================================
// GESTIÓN DE PILA DE NAVEGACIÓN PROFUNDA (HISTORIAL DE CLICS)
// ============================================================

function registrarPasoHistorial(tipo, id, titulo, meta = {}) {
  AppState.historial.push({ tipo, id, titulo, meta });
}

function obtenerTextoBotonVolver() {
  if (AppState.historial.length === 0) {
    return "Volver a la búsqueda";
  }
  const prev = AppState.historial[AppState.historial.length - 1];
  if (prev.tipo === "animal") {
    return `Volver a Vaca ${prev.meta.crotal_4 || prev.id}`;
  }
  if (prev.tipo === "corral") {
    return `Volver a Lote ${prev.id}`;
  }
  return "Volver a la búsqueda";
}

window.volverAtras = function () {
  if (AppState.historial.length === 0) {
    AppState.crotalSeleccionado = null;
    AppState.corralSeleccionado = null;
    renderVistaAnimales();
    return;
  }

  const anterior = AppState.historial.pop();
  if (anterior.tipo === "buscar") {
    AppState.crotalSeleccionado = null;
    AppState.corralSeleccionado = null;
    renderVistaAnimales();
  } else if (anterior.tipo === "animal") {
    seleccionarAnimal(anterior.id, false);
  } else if (anterior.tipo === "corral") {
    verDetalleCorral(anterior.id, false);
  }
};

// ============================================================
// VISTA: ANIMALES (Buscador adaptativo Split-View y Táctil)
// ============================================================

function renderVistaAnimales() {
  const container = document.getElementById("app-container");
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
              value="${AppState.terminoBusqueda}"
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

  container.querySelectorAll(".t-key[data-digit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      AppState.terminoBusqueda += btn.dataset.digit;
      if (inputSearch) inputSearch.value = AppState.terminoBusqueda;
      ejecutarBusquedaYListar();
    });
  });

  const btnKeypadBack = document.getElementById("btn-keypad-back");
  if (btnKeypadBack) {
    btnKeypadBack.addEventListener("click", () => {
      AppState.terminoBusqueda = AppState.terminoBusqueda.slice(0, -1);
      if (inputSearch) inputSearch.value = AppState.terminoBusqueda;
      ejecutarBusquedaYListar();
    });
  }

  const btnKeypadClear = document.getElementById("btn-keypad-clear");
  if (btnKeypadClear) {
    btnKeypadClear.addEventListener("click", () => {
      AppState.terminoBusqueda = "";
      if (inputSearch) inputSearch.value = "";
      ejecutarBusquedaYListar();
    });
  }

  ejecutarBusquedaYListar();
}

function ejecutarBusquedaYListar() {
  const resultsList = document.getElementById("results-list");
  const resultsCount = document.getElementById("results-count");
  if (!resultsList) return;

  const resultados = window.campoDB.buscar(AppState.terminoBusqueda, AppState.soloActivos);

  if (resultsCount) {
    resultsCount.textContent = `${resultados.length} encontrados`;
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

  resultsList.innerHTML = resultados
    .map((a) => {
      const esActivo = a.estado === "A";
      const estadoClase = esActivo ? "activo" : "baja";
      const estadoTexto = esActivo ? "Activo" : "Baja";
      const esSelected = AppState.crotalSeleccionado === a.crotal ? "selected" : "";
      const corralTexto = a.corral ? a.corral.trim() : "Sin lote";
      const partosTexto = a.total_partos > 0 ? `${a.total_partos} partos` : "Sin partos";

      return `
        <article class="animal-card ${esSelected}" onclick="seleccionarAnimal('${a.crotal}', true)" data-crotal="${a.crotal}">
          <div class="card-header-row">
            <div class="crotal-box">
              <span class="crotal-4-digits">${a.crotal_4}</span>
              <span class="crotal-full-code">${a.crotal}</span>
            </div>
            <span class="status-pill ${estadoClase}">${estadoTexto}</span>
          </div>
          <div class="animal-specs-grid">
            <div>
              <div class="spec-label">Lote / Ubicación</div>
              <div class="spec-val">${corralTexto}</div>
            </div>
            <div>
              <div class="spec-label">Raza y Edad</div>
              <div class="spec-val">${a.raza} (${calcularEdad(a.fecha_nacimiento)})</div>
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
    .join("");

  // En PC seleccionar automáticamente el primero si aún no hay ninguno seleccionado
  if (esPantallaEscritorio() && resultados.length > 0 && !AppState.crotalSeleccionado && !AppState.corralSeleccionado) {
    seleccionarAnimal(resultados[0].crotal, false);
  }
}

// ============================================================
// VISTA: FICHA DEL ANIMAL (Interconexión profunda de clics)
// ============================================================

window.seleccionarAnimal = function (crotal, pushHistory = true) {
  if (!crotal) return;

  const animal = window.campoDB.obtenerDetalleAnimal(crotal);
  if (!animal) {
    alert(`El animal con crotal ${crotal} no se encuentra en la base de datos.`);
    return;
  }

  if (pushHistory) {
    // Si ya teníamos algo en pantalla, lo apilamos en el historial
    if (AppState.crotalSeleccionado && AppState.crotalSeleccionado !== crotal) {
      const prevAnimal = window.campoDB.obtenerDetalleAnimal(AppState.crotalSeleccionado);
      registrarPasoHistorial("animal", AppState.crotalSeleccionado, `Vaca ${prevAnimal ? prevAnimal.crotal_4 : ""}`, {
        crotal_4: prevAnimal ? prevAnimal.crotal_4 : ""
      });
    } else if (AppState.corralSeleccionado) {
      registrarPasoHistorial("corral", AppState.corralSeleccionado, `Lote ${AppState.corralSeleccionado}`);
    } else {
      registrarPasoHistorial("buscar", null, "Búsqueda");
    }
  }

  AppState.crotalSeleccionado = crotal;
  AppState.corralSeleccionado = null;

  // Actualizar tarjeta seleccionada en la lista izquierda
  document.querySelectorAll(".animal-card").forEach((c) => {
    c.classList.toggle("selected", c.dataset.crotal === crotal);
  });

  const htmlFicha = generarHtmlDetalleAnimal(animal);

  if (esPantallaEscritorio()) {
    const rightPanel = document.getElementById("detail-panel");
    if (rightPanel) {
      rightPanel.innerHTML = htmlFicha;
    }
  } else {
    const container = document.getElementById("app-container");
    container.innerHTML = htmlFicha;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
};

function generarHtmlDetalleAnimal(animal) {
  const esActivo = animal.estado === "A";
  const estadoClase = esActivo ? "activo" : "baja";
  const estadoTexto = esActivo ? "Activo" : "Baja";
  const textoVolver = obtenerTextoBotonVolver();

  // Partos y Becerros hiperconectados
  let htmlPartos = '<p style="color: var(--text-dim); font-size: 0.88rem; padding: 10px 0;">No tiene partos registrados</p>';
  if (animal.partos && animal.partos.length > 0) {
    htmlPartos = animal.partos
      .map((p) => {
        const digitosCria = extraer4Digitos(p.cria_crotal);
        const tiempoParto = calcularTiempoTranscurrido(p.fecha_parto);
        const sexoTexto = p.cria_sexo === "M" ? "Macho" : p.cria_sexo === "H" ? "Hembra" : (p.cria_sexo || "Sexo N/D");

        return `
          <div class="history-item" style="flex-direction: column; align-items: stretch; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="history-main-title">
                Parto: ${formatearFecha(p.fecha_parto)}
              </div>
              <div class="history-date">${tiempoParto}</div>
            </div>
            
            ${
              p.cria_crotal
                ? `
                <button class="clickable-chip chip-cria" onclick="seleccionarAnimal('${p.cria_crotal}', true)">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-weight: 800; font-size: 1.05rem; color: var(--brand-primary);">${digitosCria}</span>
                    <span style="font-size: 0.84rem; color: var(--text-muted);">${p.cria_crotal} • ${sexoTexto}</span>
                  </div>
                  <span class="chip-action">Ver ficha cría →</span>
                </button>
                `
                : `<span style="font-size: 0.85rem; color: var(--text-muted);">Cría sin crotal asignado (${sexoTexto})</span>`
            }
          </div>
        `;
      })
      .join("");
  }

  // Movimientos
  let htmlMovimientos = '<p style="color: var(--text-dim); font-size: 0.88rem; padding: 10px 0;">Sin movimientos registrados</p>';
  if (animal.movimientos && animal.movimientos.length > 0) {
    htmlMovimientos = animal.movimientos
      .map(
        (m) => `
        <div class="history-item">
          <div>
            <div class="history-main-title">${m.tipo || "Movimiento"}</div>
            <div class="history-sub-title">
              ${m.origen ? `Origen: ${m.origen}` : ""} ${m.destino ? `→ Destino: ${m.destino}` : ""}
            </div>
          </div>
          <div class="history-date">${formatearFecha(m.fecha)}</div>
        </div>
      `
      )
      .join("");
  }

  // Botón Madre interactivo
  let componenteMadre = '<span class="spec-val">Desconocida</span>';
  if (animal.madre_crotal) {
    const madre4 = extraer4Digitos(animal.madre_crotal);
    componenteMadre = `
      <button class="clickable-chip chip-madre" onclick="seleccionarAnimal('${animal.madre_crotal}', true)">
        <span>Vaca <strong>${madre4}</strong> (${animal.madre_crotal})</span>
        <span class="chip-action">Ver madre →</span>
      </button>
    `;
  }

  // Botón Corral / Lote interactivo
  let componenteCorral = '<span class="spec-val">Sin lote asignado</span>';
  if (animal.corral && animal.corral.trim()) {
    const corralNombre = animal.corral.trim();
    componenteCorral = `
      <button class="clickable-chip chip-corral" onclick="verDetalleCorral('${corralNombre}', true)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        <span>${corralNombre}</span>
        <span class="chip-action">Ver lote completo →</span>
      </button>
    `;
  }

  return `
    <div class="detail-card">
      <button class="btn-back-link" onclick="volverAtras()">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        <span>${textoVolver}</span>
      </button>

      <div class="detail-headline">
        <div>
          <div class="detail-crotal-big">${animal.crotal_4}</div>
          <div class="detail-crotal-full">${animal.crotal} ${animal.nombre ? `• ${animal.nombre}` : ""}</div>
        </div>
        <span class="status-pill ${estadoClase}">${estadoTexto}</span>
      </div>

      <div class="animal-specs-grid" style="padding-top: 14px; gap: 14px 20px;">
        <div style="grid-column: 1 / -1;">
          <div class="spec-label">Ubicación / Lote actual (Clic para ver animales del lote)</div>
          <div style="margin-top: 4px;">${componenteCorral}</div>
        </div>

        <div>
          <div class="spec-label">Raza y Sexo</div>
          <div class="spec-val">${animal.raza} (${animal.sexo === 'M' ? 'Macho' : animal.sexo === 'H' ? 'Hembra' : (animal.sexo || 'N/D')})</div>
        </div>

        <div>
          <div class="spec-label">Fecha Nacimiento</div>
          <div class="spec-val">${formatearFecha(animal.fecha_nacimiento)} (${calcularEdad(animal.fecha_nacimiento)})</div>
        </div>

        <div>
          <div class="spec-label">Alta en Explotación</div>
          <div class="spec-val">${formatearFecha(animal.fecha_alta)}</div>
        </div>

        <div>
          <div class="spec-label">Último Parto</div>
          <div class="spec-val">${animal.fecha_ult_parto ? formatearFecha(animal.fecha_ult_parto) : "Sin partos"}</div>
        </div>

        <div style="grid-column: 1 / -1;">
          <div class="spec-label">Madre (Clic para ver ficha de la madre)</div>
          <div style="margin-top: 4px;">${componenteMadre}</div>
        </div>
      </div>

      <div class="section-heading">Historial de Partos y Crías (${animal.partos ? animal.partos.length : 0})</div>
      <div>${htmlPartos}</div>

      <div class="section-heading">Historial de Movimientos (${animal.movimientos ? animal.movimientos.length : 0})</div>
      <div>${htmlMovimientos}</div>
    </div>
  `;
}

// ============================================================
// VISTA: DETALLE DE CORRAL / LOTE (Profundidad por clic)
// ============================================================

window.verDetalleCorral = function (nombreLote, pushHistory = true) {
  if (!nombreLote) return;

  if (pushHistory) {
    if (AppState.crotalSeleccionado) {
      const prevAnimal = window.campoDB.obtenerDetalleAnimal(AppState.crotalSeleccionado);
      registrarPasoHistorial("animal", AppState.crotalSeleccionado, `Vaca ${prevAnimal ? prevAnimal.crotal_4 : ""}`, {
        crotal_4: prevAnimal ? prevAnimal.crotal_4 : ""
      });
    } else {
      registrarPasoHistorial("buscar", null, "Búsqueda");
    }
  }

  AppState.corralSeleccionado = nombreLote;
  const textoVolver = obtenerTextoBotonVolver();
  const animalesLote = window.campoDB.obtenerAnimalesDeLote(nombreLote);

  const htmlCorral = `
    <div class="detail-card">
      <button class="btn-back-link" onclick="volverAtras()">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        <span>${textoVolver}</span>
      </button>

      <div class="corral-header-card">
        <div class="corral-header-row">
          <div>
            <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em;">Censo del Lote</div>
            <div class="corral-title">${nombreLote}</div>
          </div>
          <div class="corral-badge-count">
            ${animalesLote.length} vacas activas
          </div>
        </div>
      </div>

      <div class="list-meta" style="margin-top: 18px;">
        <span>Animales en ${nombreLote} (Toca para ver ficha)</span>
        <span>${animalesLote.length} cabezas</span>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;">
        ${animalesLote
          .map(
            (a) => `
          <div class="animal-card" onclick="seleccionarAnimal('${a.crotal}', true)">
            <div class="card-header-row">
              <span class="crotal-4-digits">${a.crotal_4}</span>
              <span class="status-pill activo">Activo</span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
              ${a.raza} • ${calcularEdad(a.fecha_nacimiento)}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 0.8rem; color: var(--text-dim);">
              <span>${a.crotal}</span>
              <span>${a.total_partos > 0 ? `${a.total_partos} partos` : "0 partos"}</span>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;

  if (esPantallaEscritorio()) {
    const rightPanel = document.getElementById("detail-panel");
    if (rightPanel) {
      rightPanel.innerHTML = htmlCorral;
    }
  } else {
    const container = document.getElementById("app-container");
    container.innerHTML = htmlCorral;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
};

// ============================================================
// VISTA: RECETAS Y TRATAMIENTOS (Pestaña descorrelacionada)
// ============================================================

function renderVistaRecetas() {
  const container = document.getElementById("app-container");

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
            value="${AppState.filtroRecetas}"
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

function ejecutarBusquedaRecetas() {
  const listContainer = document.getElementById("recetas-list");
  const countLabel = document.getElementById("recetas-count");
  if (!listContainer) return;

  const recetas = window.campoDB.obtenerRecetas(AppState.filtroRecetas);

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
            <span class="receta-num">${r.receta ? `Receta: ${r.receta}` : "Tratamiento sin receta oficial"}</span>
            <span class="receta-date">${formatearFecha(r.fecha)}</span>
          </div>

          <div class="receta-title-row">
            <div class="receta-medicamento">${r.medicamento || "Medicamento no especificado"}</div>
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
              ${r.veterinario ? `<span>Col. <strong>${r.veterinario}</strong></span>` : ""}
              ${r.proveedor ? ` <span style="color: var(--text-dim);">${r.veterinario ? "• " : ""}${r.proveedor}</span>` : ""}
            </div>
            ${textoSupresion ? `<span class="badge-supresion-discreto">${textoSupresion}</span>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
}

// ============================================================
// VISTA: COMPRAS DE PIENSOS Y ALIMENTOS (datos -> alimentos -> compras)
// ============================================================

function renderVistaAlimentos() {
  const container = document.getElementById("app-container");

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
            value="${AppState.filtroAlimentos}"
            autocomplete="off"
            spellcheck="false"
          />
          ${AppState.filtroAlimentos ? '<button class="btn-input-clear" id="btn-clear-alimentos">✕</button>' : ''}
        </div>
      </div>

      <div class="list-meta">
        <span>Historial de Entradas</span>
        <span id="alimentos-count">Cargando...</span>
      </div>

      <div id="alimentos-list"></div>
    </div>
  `;

  const inputAlimentos = document.getElementById("txt-busqueda-alimentos");
  if (inputAlimentos) {
    inputAlimentos.addEventListener("input", (e) => {
      AppState.filtroAlimentos = e.target.value;
      ejecutarBusquedaAlimentos();
    });
    if (esPantallaEscritorio()) {
      inputAlimentos.focus();
    }
  }

  const btnClear = document.getElementById("btn-clear-alimentos");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      AppState.filtroAlimentos = "";
      if (inputAlimentos) {
        inputAlimentos.value = "";
        inputAlimentos.focus();
      }
      ejecutarBusquedaAlimentos();
    });
  }

  ejecutarBusquedaAlimentos();
}

function ejecutarBusquedaAlimentos() {
  const listContainer = document.getElementById("alimentos-list");
  const countLabel = document.getElementById("alimentos-count");
  if (!listContainer) return;

  const compras = window.campoDB.obtenerComprasAlimento(AppState.filtroAlimentos);

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
            <div class="compra-alimento-nombre">${c.alimento || "Alimento"}</div>
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
              <span>Proveedor: <strong>${c.proveedor || "No especificado"}</strong></span>
              ${c.albaran ? ` • <span style="color: var(--text-dim);">Albarán: ${c.albaran}</span>` : ""}
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

// ============================================================
// VISTA: MOVIMIENTOS (TRASPASOS, NACIMIENTOS, SACRIFICIOS, BAJAS)
// ============================================================

function formatearExplotacionAmigable(codigoRega) {
  if (!codigoRega) return "Sin especificar";
  const r = codigoRega.trim();
  if (r.endsWith("121")) return `${r} (121 Vida / Nodrizas)`;
  if (r.endsWith("122")) return `${r} (122 Cebadero)`;
  if (r.endsWith("671")) return `${r} (671 Finca Cipérez - Histórica)`;
  if (r.endsWith("591")) return `${r} (591 Cerezal - Histórica)`;
  if (r.includes("000081")) return `${r} (Matadero Salamanca)`;
  return r;
}

function renderVistaMovimientos() {
  const container = document.getElementById("app-container");
  const anios = window.campoDB ? window.campoDB.obtenerAniosMovimientos() : [];

  const aniosOptions = anios
    .map((a) => `<option value="${a}" ${AppState.anioMovimiento === a ? "selected" : ""}>Año ${a}</option>`)
    .join("");

  const tipos = [
    { id: "TODOS", label: "Todos" },
    { id: "TRASPASO", label: "Traspasos (121 ➔ 122)" },
    { id: "NACIMIENTO", label: "Nacimientos" },
    { id: "SACRIFICIO", label: "Sacrificios" },
    { id: "MUERTE", label: "Muertes" },
    { id: "VENTA", label: "Ventas" },
    { id: "COMPRA", label: "Compras" },
  ];

  const chipsHtml = tipos
    .map(
      (t) => `
      <button 
        class="chip-filtro-mov ${AppState.tipoMovimiento === t.id ? "active" : ""}" 
        data-tipo="${t.id}">
        ${t.label}
      </button>
    `
    )
    .join("");

  container.innerHTML = `
    <div style="max-width: 900px; margin: 0 auto;">
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

function ejecutarBusquedaMovimientos() {
  const listContainer = document.getElementById("movimientos-list");
  const countLabel = document.getElementById("movimientos-count");
  if (!listContainer) return;

  const movs = window.campoDB.obtenerMovimientos({
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

// ============================================================
// ASISTENTE DE IA POR VOZ Y LENGUAJE NATURAL (GROK TEXT-TO-SQL)
// ============================================================

function setupAsistenteIA() {
  const btnOpenAi = document.getElementById("btn-open-ai");
  const btnCloseAi = document.getElementById("btn-close-ai");
  const modalBackdrop = document.getElementById("ai-modal-backdrop");
  const btnRecordVoice = document.getElementById("btn-record-voice");
  const voiceStatusText = document.getElementById("voice-status-text");
  const voiceWaveform = document.getElementById("voice-waveform");
  const inputAiPrompt = document.getElementById("txt-ai-prompt");
  const btnSendAi = document.getElementById("btn-send-ai");
  const resultsWrapper = document.getElementById("ai-results-wrapper");
  const bubbleResponse = document.getElementById("ai-bubble-response");
  const cardsContainer = document.getElementById("ai-cards-container");
  const selectAiModel = document.getElementById("select-ai-model");
  const btnClearHistory = document.getElementById("btn-clear-ai-history");
  const chipSuggestions = document.querySelectorAll(".ai-chip-suggestion");

  if (!btnOpenAi || !modalBackdrop) return;

  let speechRecognition = null;
  let escuchandoVoz = false;
  let ejecutandoConsulta = false;

  if (btnClearHistory) {
    btnClearHistory.addEventListener("click", () => {
      AppState.conversacionIA = [];
      if (resultsWrapper) resultsWrapper.style.display = "block";
      if (bubbleResponse) {
        bubbleResponse.innerHTML = `
          <div style="font-size: 0.9rem; color: #166534; display: flex; align-items: center; gap: 8px;">
            <span>🔄 Contexto conversacional reiniciado. Puedes preguntar por cualquier vaca, corral o consulta nueva.</span>
          </div>
        `;
      }
      if (cardsContainer) cardsContainer.innerHTML = "";
      if (inputAiPrompt) {
        inputAiPrompt.value = "";
        inputAiPrompt.focus();
      }
    });
  }

  async function cargarModelosSelector() {
    if (!selectAiModel) return;
    try {
      const resp = await fetch("./api/ai/models", {
        headers: obtenerAuthHeaders()
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.ok && Array.isArray(data.models) && data.models.length > 0) {
        const valorPrevio = localStorage.getItem("campo_ai_model_id") || "auto";
        selectAiModel.innerHTML = data.models
          .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
          .join("");
        if (Array.from(selectAiModel.options).some((o) => o.value === valorPrevio)) {
          selectAiModel.value = valorPrevio;
        }
      }
    } catch (e) {
      console.warn("Error cargando selector de modelos:", e);
    }
  }

  if (selectAiModel) {
    selectAiModel.addEventListener("change", () => {
      localStorage.setItem("campo_ai_model_id", selectAiModel.value);
    });
  }

  cargarModelosSelector();

  // Reconocimiento de voz: Web Speech API (Chrome/Edge/Safari) y MediaRecorder + Groq Whisper (Firefox y otros)
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let mediaRecorder = null;
  let audioChunks = [];
  let mediaStream = null;
  let grabacionPorMediaRecorder = false;

  if (SpeechRec) {
    speechRecognition = new SpeechRec();
    speechRecognition.lang = "es-ES";
    speechRecognition.continuous = false;
    speechRecognition.interimResults = false;

    speechRecognition.onstart = () => {
      escuchandoVoz = true;
      grabacionPorMediaRecorder = false;
      if (btnRecordVoice) btnRecordVoice.classList.add("listening");
      if (voiceWaveform) voiceWaveform.style.display = "flex";
      if (voiceStatusText) voiceStatusText.textContent = "Escuchando... habla a tu teléfono o micrófono";
    };

    speechRecognition.onresult = (event) => {
      if (event.results && event.results[0] && event.results[0][0]) {
        const transcript = event.results[0][0].transcript.trim();
        if (inputAiPrompt) inputAiPrompt.value = transcript;
        if (voiceStatusText) voiceStatusText.textContent = `"${transcript}"`;
        detenerVoz();
        ejecutarConsultaIA(transcript);
      }
    };

    speechRecognition.onerror = (event) => {
      console.warn("Error en reconocimiento de voz nativo:", event.error);
      detenerVoz();
      if (voiceStatusText) {
        if (event.error === "no-speech") {
          voiceStatusText.textContent = "No se ha escuchado nada. Toca para volver a hablar.";
        } else if (event.error === "not-allowed") {
          voiceStatusText.textContent = "Permiso de micrófono denegado. Puedes escribir tu consulta abajo.";
        } else {
          voiceStatusText.textContent = "Error al captar audio. Vuelve a probar o escribe abajo.";
        }
      }
    };

    speechRecognition.onend = () => {
      if (escuchandoVoz && !grabacionPorMediaRecorder) {
        detenerVoz();
      }
    };
  }

  async function iniciarGrabacionMediaRecorder() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (voiceStatusText) {
        voiceStatusText.textContent = "Tu navegador no permite grabar audio. Escribe tu consulta abajo.";
      }
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];

      let mimeType = "";
      if (typeof MediaRecorder.isTypeSupported === "function") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
          mimeType = "audio/ogg;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        }
      }

      mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (mediaStream) {
          mediaStream.getTracks().forEach((t) => t.stop());
          mediaStream = null;
        }

        if (audioChunks.length === 0) {
          if (voiceStatusText) voiceStatusText.textContent = "No se grabó audio. Toca para reintentar.";
          return;
        }

        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        if (voiceStatusText) voiceStatusText.textContent = "Transcribiendo voz con IA (Whisper)...";
        if (voiceWaveform) voiceWaveform.style.display = "none";

        try {
          const authHdrs = obtenerAuthHeaders();
          const resp = await fetch("./api/ai/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": audioBlob.type || "audio/webm",
              ...authHdrs
            },
            body: audioBlob,
          });

          const data = await resp.json();
          if (resp.ok && data.ok && data.text) {
            const textoTranscrito = data.text.trim();
            if (inputAiPrompt) inputAiPrompt.value = textoTranscrito;
            if (voiceStatusText) voiceStatusText.textContent = `"${textoTranscrito}"`;
            ejecutarConsultaIA(textoTranscrito);
          } else {
            const err = data.error || "No se pudo transcribir el audio.";
            if (voiceStatusText) voiceStatusText.textContent = err;
          }
        } catch (e) {
          console.error("Error enviando audio a transcripción:", e);
          if (voiceStatusText) voiceStatusText.textContent = "Error al conectar con el servidor de transcripción.";
        }
      };

      mediaRecorder.start();
      escuchandoVoz = true;
      grabacionPorMediaRecorder = true;
      if (btnRecordVoice) btnRecordVoice.classList.add("listening");
      if (voiceWaveform) voiceWaveform.style.display = "flex";
      if (voiceStatusText) voiceStatusText.textContent = "Grabando... Toca el micro otra vez para enviar la consulta";
    } catch (err) {
      console.warn("Error obteniendo micrófono con getUserMedia:", err);
      if (voiceStatusText) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          voiceStatusText.textContent = "Permiso de micrófono denegado en Firefox. Habilítalo en la barra de direcciones.";
        } else {
          voiceStatusText.textContent = "No se pudo acceder al micrófono. Puedes escribir abajo.";
        }
      }
      detenerVoz();
    }
  }

  function iniciarVoz() {
    // Si tenemos Web Speech API nativo (Chrome/Safari), lo usamos
    if (speechRecognition) {
      try {
        speechRecognition.start();
        return;
      } catch (e) {
        console.warn("Fallo al iniciar Web Speech API, usando fallback MediaRecorder:", e);
      }
    }

    // Fallback universal para Firefox y navegadores sin Web Speech API
    iniciarGrabacionMediaRecorder();
  }

  function detenerVoz() {
    escuchandoVoz = false;
    if (btnRecordVoice) btnRecordVoice.classList.remove("listening");

    if (grabacionPorMediaRecorder && mediaRecorder && mediaRecorder.state === "recording") {
      grabacionPorMediaRecorder = false;
      try {
        mediaRecorder.stop();
      } catch (e) {
        console.warn("Error deteniendo MediaRecorder:", e);
      }
      return;
    }

    if (voiceWaveform) voiceWaveform.style.display = "none";
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch (_) {}
    }
    if (voiceStatusText && !ejecutandoConsulta && (!inputAiPrompt || !inputAiPrompt.value)) {
      voiceStatusText.textContent = "Toca el micrófono para hablar";
    }
  }

  function abrirModal() {
    modalBackdrop.style.display = "flex";
    if (esPantallaEscritorio() && inputAiPrompt) {
      setTimeout(() => inputAiPrompt.focus(), 150);
    }
  }

  function cerrarModal() {
    detenerVoz();
    modalBackdrop.style.display = "none";
  }

  btnOpenAi.addEventListener("click", abrirModal);
  if (btnCloseAi) btnCloseAi.addEventListener("click", cerrarModal);

  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) {
      cerrarModal();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalBackdrop.style.display === "flex") {
      cerrarModal();
    }
  });

  if (btnRecordVoice) {
    btnRecordVoice.addEventListener("click", () => {
      if (escuchandoVoz) {
        detenerVoz();
      } else {
        iniciarVoz();
      }
    });
  }

  chipSuggestions.forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.dataset.prompt || chip.textContent.trim();
      if (inputAiPrompt) inputAiPrompt.value = prompt;
      ejecutarConsultaIA(prompt);
    });
  });

  if (btnSendAi) {
    btnSendAi.addEventListener("click", () => {
      const prompt = inputAiPrompt ? inputAiPrompt.value.trim() : "";
      if (prompt) ejecutarConsultaIA(prompt);
    });
  }

  if (inputAiPrompt) {
    inputAiPrompt.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const prompt = inputAiPrompt.value.trim();
        if (prompt) ejecutarConsultaIA(prompt);
      }
    });
  }

  function resolverConsultaOffline(textoPrompt) {
    const p = textoPrompt.trim().toLowerCase();
    const mCrotal = p.match(/\b(\d{4})\b/);

    if (mCrotal) {
      const c4 = mCrotal[1];
      if (p.includes("parto") || p.includes("cria") || p.includes("cría") || p.includes("hijo")) {
        return {
          sql: "SELECT p.id, p.fecha_parto, p.cria_crotal, p.cria_sexo, a.crotal_4 as cria_crotal_4, a.raza as cria_raza, a.estado as cria_estado FROM partos p LEFT JOIN animales a ON p.cria_crotal = a.crotal WHERE p.madre_crotal = (SELECT crotal FROM animales WHERE crotal_4 = ? LIMIT 1) ORDER BY p.fecha_parto DESC",
          params: [c4],
          interpretacion: `Partos y descendencia de la madre ${c4} (Modo sin cobertura).`,
          tipo_resultado: "partos",
          offline: true
        };
      }
      return {
        sql: "SELECT * FROM animales WHERE crotal_4 = ? AND estado = 'A' LIMIT 1",
        params: [c4],
        interpretacion: `Ficha técnica de la cabeza con crotal ${c4} (Modo sin cobertura).`,
        tipo_resultado: "animales",
        offline: true
      };
    }

    const corrales = ["dueña", "espadaña", "rivera", "vega", "cebadero"];
    for (const c of corrales) {
      if (p.includes(c)) {
        return {
          sql: "SELECT * FROM animales WHERE UPPER(corral) LIKE ? AND estado = 'A' ORDER BY crotal_4 ASC",
          params: [`%${c.toUpperCase()}%`],
          interpretacion: `Animales censados en lote ${c.toUpperCase()} (Modo sin cobertura).`,
          tipo_resultado: "animales",
          offline: true
        };
      }
    }

    if (p.includes("sin parir") || p.includes("vacia") || p.includes("vacía")) {
      return {
        sql: "SELECT * FROM animales WHERE (sexo = 'Vaca' OR sexo LIKE 'Hembra%') AND estado = 'A' AND (fecha_ult_parto IS NULL OR fecha_ult_parto = '' OR total_partos = 0) ORDER BY fecha_nacimiento ASC",
        params: [],
        interpretacion: "Vacas adultas sin partos registrados (Modo sin cobertura).",
        tipo_resultado: "animales",
        offline: true
      };
    }

    if (p.includes("supresion") || p.includes("supresión") || p.includes("retirada") || p.includes("medicamento")) {
      return {
        sql: "SELECT r.id, r.fecha, r.receta, r.medicamento, r.n_animales, r.tiempo_carne, r.veterinario, r.cea, date(r.fecha, '+' || CAST(r.tiempo_carne AS TEXT) || ' days') AS fin_supresion FROM recetas r WHERE r.tiempo_carne > 0 AND date(r.fecha, '+' || CAST(r.tiempo_carne AS TEXT) || ' days') >= date('now') ORDER BY fin_supresion ASC LIMIT 20",
        params: [],
        interpretacion: "Tratamientos veterinarios con retirada sanitaria activa (Modo sin cobertura).",
        tipo_resultado: "recetas",
        offline: true
      };
    }

    if (p.includes("traspaso") || p.includes("cebadero")) {
      return {
        sql: "SELECT m.id, m.crotal, m.fecha, m.tipo, m.origen, m.destino, m.corral, a.crotal_4, a.sexo, a.raza FROM movimientos m LEFT JOIN animales a ON m.crotal = a.crotal WHERE m.origen LIKE '%121%' AND m.destino LIKE '%122%' ORDER BY m.fecha DESC LIMIT 20",
        params: [],
        interpretacion: "Últimos traspasos registrados hacia el cebadero 122 (Modo sin cobertura).",
        tipo_resultado: "movimientos",
        offline: true
      };
    }

    return null;
  }

  async function ejecutarConsultaIA(prompt) {
    if (ejecutandoConsulta) return;
    detenerVoz();
    ejecutandoConsulta = true;

    if (resultsWrapper) resultsWrapper.style.display = "block";
    if (bubbleResponse) {
      bubbleResponse.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; color: var(--brand-primary); font-weight: 600;">
          <div class="spinner" style="width: 18px; height: 18px; border-width: 2px;"></div>
          <span>Consultando catálogo de la explotación...</span>
        </div>
      `;
    }
    if (cardsContainer) cardsContainer.innerHTML = "";

    let intentData = null;

    // Si el dispositivo está sin conexión a internet, recurrir de inmediato al parser local
    if (!navigator.onLine) {
      intentData = resolverConsultaOffline(prompt);
    } else {
      try {
        const authHdrs = obtenerAuthHeaders();
        const resp = await fetch("./api/ai/intent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHdrs
          },
          body: JSON.stringify({
            prompt,
            historial: AppState.conversacionIA.slice(-6)
          })
        });

        if (resp.ok) {
          const resJson = await resp.json();
          if (resJson.ok) {
            intentData = resJson;
          }
        }
      } catch (netErr) {
        // Fallback local en caso de error de red
        intentData = resolverConsultaOffline(prompt);
      }
    }

    if (!intentData) {
      intentData = resolverConsultaOffline(prompt);
    }

    if (!intentData) {
      if (bubbleResponse) {
        bubbleResponse.innerHTML = `
          <div style="background: var(--bg-surface); border: 1px solid var(--border-color); padding: 12px 14px; border-radius: var(--radius-md);">
            <div style="font-weight: 700; color: var(--text-color); margin-bottom: 4px;">Consulta no clasificada</div>
            <div style="font-size: 0.86rem; color: var(--text-dim);">Prueba a indicar un crotal de 4 dígitos (ej. 1045), un nombre de corral (ej. Dueña) o palabras como "partos", "sin parir" o "supresión".</div>
          </div>
        `;
      }
      ejecutandoConsulta = false;
      return;
    }

    const { sql, params, interpretacion, respuesta_directa, tipo_resultado, offline_mode } = intentData;

    // Caso 1: Respuesta directa de texto sin SQL
    if (!sql && respuesta_directa) {
      let htmlBubble = `
        <div style="font-size: 0.95rem; font-weight: 700; color: #0369a1; margin-bottom: 4px;">
          ${escapeHtml(interpretacion || "Información Técnica:")}
        </div>
        <div class="ai-directa-box">
          ${escapeHtml(respuesta_directa)}
        </div>
      `;
      if (bubbleResponse) bubbleResponse.innerHTML = htmlBubble;
      if (cardsContainer) cardsContainer.innerHTML = "";
      AppState.conversacionIA.push({ role: "user", content: prompt });
      AppState.conversacionIA.push({ role: "assistant", content: respuesta_directa });
      ejecutandoConsulta = false;
      return;
    }

    if (!sql) {
      if (bubbleResponse) {
        bubbleResponse.innerHTML = `<div style="color: var(--text-muted);">${escapeHtml(interpretacion || "No se ha generado consulta.")}</div>`;
      }
      ejecutandoConsulta = false;
      return;
    }

    // Ejecutar localmente en SQLite WASM con parámetros seguros
    let filas = [];
    try {
      filas = window.campoDB.ejecutarQuery(sql, params || []);
    } catch (sqlErr) {
      if (cardsContainer) {
        cardsContainer.innerHTML = `
          <div style="background: #fff1f2; border: 1px solid #ffe4e6; color: #be123c; padding: 12px; border-radius: var(--radius-md); font-size: 0.88rem;">
            <strong>Error al consultar la base local:</strong> ${escapeHtml(sqlErr.message)}
          </div>
        `;
      }
      ejecutandoConsulta = false;
      return;
    }

    const badgeOffline = offline_mode ? '<span style="font-size: 0.72rem; color: #047857; background: #ecfdf5; padding: 2px 8px; border-radius: 9999px; border: 1px solid #a7f3d0;">Modo sin cobertura</span>' : '';

      const tieneHistorialPrevio = AppState.conversacionIA.length > 0;
      const historyBadge = tieneHistorialPrevio ? '<span class="ai-history-badge">En contexto</span>' : '';

      if (filas.length === 0) {
        let htmlBubble = `
          <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px; margin-bottom: 4px;">
            <div style="font-size: 1rem; font-weight: 700; color: #14532d; display: flex; align-items: center; gap: 6px;">
              <span>${escapeHtml(interpretacion || "Consulta realizada:")}</span>
              ${historyBadge}
            </div>
            ${modelo_usado ? `
              <span style="font-size: 0.72rem; color: #15803d; opacity: 0.85; background: rgba(255,255,255,0.7); padding: 2px 8px; border-radius: 9999px; border: 1px solid #bbf7d0; font-family: monospace;">
                ${escapeHtml(modelo_usado)}
              </span>
            ` : ""}
          </div>
          <details style="margin-top: 8px; font-size: 0.78rem; color: #15803d;">
            <summary style="cursor: pointer; font-weight: 600; opacity: 0.9;">Ver consulta SQL generada</summary>
            <pre style="background: rgba(255,255,255,0.7); border: 1px solid #bbf7d0; padding: 6px 10px; border-radius: 4px; margin-top: 6px; overflow-x: auto; font-family: monospace; color: #14532d;">${escapeHtml(sql)}</pre>
          </details>
        `;
        if (bubbleResponse) bubbleResponse.innerHTML = htmlBubble;

        if (cardsContainer) {
          cardsContainer.innerHTML = `
            <div style="text-align: center; padding: 25px 15px; color: var(--text-dim); background: var(--bg-surface-subtle); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
              <p style="font-weight: 600; font-size: 0.95rem; color: var(--text-muted); margin-bottom: 4px;">0 registros encontrados</p>
              <p style="font-size: 0.82rem;">No hay registros en el censo que cumplan esa condición.</p>
            </div>
          `;
        }
        AppState.conversacionIA.push({ role: "user", content: prompt });
        AppState.conversacionIA.push({ role: "assistant", content: `${interpretacion} (0 registros)` });
        return;
      }

      // Renderizar resultados estructurados (tarjetas de animales, recetas, piensos o tabla)
      renderResultadosIA(filas, tipo_resultado, cardsContainer, cerrarModal);

      // Detectar si requiere síntesis explicativa en lenguaje natural ganadero
      const keys = Object.keys(filas[0]);
      const esAnaliticaOSeguimiento = tipo_resultado === "conteo" ||
                                      filas.length <= 15 ||
                                      keys.some(k => /total|count|suma|cantidad|destino|uso|precio|promedio/i.test(k)) ||
                                      tieneHistorialPrevio;

      let htmlBubble = `
        <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px; margin-bottom: 4px;">
          <div style="font-size: 1rem; font-weight: 700; color: #14532d; display: flex; align-items: center; gap: 6px;">
            <span>${escapeHtml(interpretacion || "Consulta realizada:")}</span>
            ${historyBadge}
          </div>
          ${modelo_usado ? `
            <span style="font-size: 0.72rem; color: #15803d; opacity: 0.85; background: rgba(255,255,255,0.7); padding: 2px 8px; border-radius: 9999px; border: 1px solid #bbf7d0; font-family: monospace;">
              ${escapeHtml(modelo_usado)}
            </span>
          ` : ""}
        </div>
        ${esAnaliticaOSeguimiento ? `
          <div id="ai-sintesis-loading" style="font-size: 0.85rem; color: #15803d; margin: 8px 0; display: flex; align-items: center; gap: 6px;">
            <div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
            <span>Sintetizando explicación ganadera...</span>
          </div>
        ` : ""}
        <details style="margin-top: 8px; font-size: 0.78rem; color: #15803d;">
          <summary style="cursor: pointer; font-weight: 600; opacity: 0.9;">Ver consulta SQL generada</summary>
          <pre style="background: rgba(255,255,255,0.7); border: 1px solid #bbf7d0; padding: 6px 10px; border-radius: 4px; margin-top: 6px; overflow-x: auto; font-family: monospace; color: #14532d;">${escapeHtml(sql)}</pre>
        </details>
      `;
      if (bubbleResponse) bubbleResponse.innerHTML = htmlBubble;

      let sintesisTexto = null;
      if (esAnaliticaOSeguimiento) {
        try {
          const authHdrs = obtenerAuthHeaders();
          const respSynth = await fetch("./api/ai/synthesize", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              ...authHdrs
            },
            body: JSON.stringify({
              prompt,
              data: filas.slice(0, 30),
              columns: keys,
              history: AppState.conversacionIA.slice(-4),
              model_id: modelId
            })
          });
          const dataSynth = await respSynth.json();
          if (respSynth.ok && dataSynth.ok && dataSynth.sintesis) {
            sintesisTexto = dataSynth.sintesis;
          }
        } catch (synthErr) {
          console.warn("No se pudo generar síntesis adicional:", synthErr);
        }

        const elLoading = document.getElementById("ai-sintesis-loading");
        if (elLoading) {
          if (sintesisTexto) {
            elLoading.outerHTML = `
              <div class="ai-sintesis-box">
                ${escapeHtml(sintesisTexto)}
              </div>
            `;
          } else {
            elLoading.remove();
          }
        }
      }

      // Guardar turno en historial conversacional
      AppState.conversacionIA.push({ role: "user", content: prompt });
      AppState.conversacionIA.push({
        role: "assistant",
        content: sintesisTexto || interpretacion || "Resultados encontrados."
      });

    } catch (netErr) {
      console.error("Error de comunicación con asistente:", netErr);
      if (bubbleResponse) {
        bubbleResponse.innerHTML = `
          <div style="background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 12px 14px; border-radius: var(--radius-md);">
            <div style="font-weight: 700; margin-bottom: 4px;">Error de conexión</div>
            <div style="font-size: 0.86rem;">No se pudo comunicar con el servidor local. Asegúrate de que está en marcha con <code>run_server.bat</code>.</div>
          </div>
        `;
      }
    } finally {
      ejecutandoConsulta = false;
    }
  }
}

function renderResultadosIA(filas, tipoResultado, container, cerrarModal) {
  if (!container || !filas || filas.length === 0) return;

  const primera = filas[0];
  const keys = Object.keys(primera);

  // 1. Caso Métrica / Conteo único (ej: SELECT COUNT(*) as total FROM ...)
  const esConteo = tipoResultado === "conteo" || (filas.length === 1 && keys.length <= 2 && keys.some(k => /total|count|suma|max|min|avg/i.test(k)));
  if (esConteo) {
    const keyVal = keys.find(k => typeof primera[k] === "number") || keys[0];
    const valor = primera[keyVal];
    const etiqueta = keyVal.replace(/_/g, " ").toUpperCase();

    container.innerHTML = `
      <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 24px; text-align: center;">
        <div style="font-size: 2.4rem; font-weight: 900; color: var(--brand-primary); line-height: 1;">
          ${typeof valor === "number" ? formatearMoneda(valor, valor % 1 !== 0 ? 2 : 0) : escapeHtml(valor)}
        </div>
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 6px;">
          ${escapeHtml(etiqueta)}
        </div>
      </div>
    `;
    return;
  }

  // 2. Caso Animales (crotal presente en cualquiera de sus formas)
  const esAnimales = tipoResultado === "animales" || keys.some(k => /crotal/i.test(k));
  if (esAnimales) {
    container.innerHTML = `
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px;">
        ${filas.length} ${filas.length === 1 ? "animal encontrado" : "animales encontrados"} (haz clic para ver ficha):
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${filas.map((a) => {
          // Extraer crotal de cualquier columna posible (crotal, crotal_4, cria_crotal, madre_crotal...)
          let crotalRaw = a.crotal || a.crotal_4 || a.cria_crotal || a.madre_crotal;
          if (!crotalRaw) {
            const crotalKey = keys.find(k => /crotal/i.test(k));
            if (crotalKey && a[crotalKey]) {
              crotalRaw = a[crotalKey];
            }
          }

          // Consultar el registro maestro del animal en SQLite local para garantizar 4 cifras, lote, estado y raza
          let detalle = null;
          if (crotalRaw && window.campoDB && typeof window.campoDB.obtenerDetalleAnimal === "function") {
            detalle = window.campoDB.obtenerDetalleAnimal(crotalRaw);
          }

          const crotal = (detalle && detalle.crotal) ? detalle.crotal : (crotalRaw || "");
          const c4 = (detalle && detalle.crotal_4) || a.crotal_4 || extraer4Digitos(crotal);
          const lote = (detalle && detalle.corral) ? detalle.corral.trim() : (a.corral ? a.corral.trim() : (a.lote || "Sin lote"));
          const estado = (detalle && detalle.estado) ? detalle.estado : (a.estado || "A");
          const estadoClase = estado === "A" ? "activo" : "baja";
          const estadoTexto = estado === "A" ? "Activo" : "Baja";
          const raza = (detalle && detalle.raza) || a.raza || "";
          const partosInfo = (detalle && detalle.total_partos != null) ? `${detalle.total_partos} partos` : (a.total_partos != null ? `${a.total_partos} partos` : "");
          const fechaUltParto = (detalle && detalle.fecha_ult_parto) || a.fecha_ult_parto || "";
          const fechaNac = (detalle && detalle.fecha_nacimiento) || a.fecha_nacimiento || a.fecha_parto || "";

          return `
            <div class="animal-card ai-clickable-animal" data-crotal="${escapeHtml(crotal)}" style="cursor: pointer; margin: 0; padding: 12px 14px;">
              <div class="card-header-row" style="margin-bottom: 6px;">
                <div class="crotal-box">
                  <span class="crotal-4-digits" style="font-size: 1.35rem; font-weight: 800; color: var(--text-main);">${escapeHtml(c4 || "—")}</span>
                  <span class="crotal-full-code" style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(crotal)}</span>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <span class="status-pill ${estadoClase}">${estadoTexto}</span>
                  <span class="chip-action" style="font-size: 0.8rem;">Ver ficha →</span>
                </div>
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.82rem; color: var(--text-muted);">
                <span>Lote: <strong style="color: var(--text-main);">${escapeHtml(lote)}</strong></span>
                ${raza ? `<span>Raza: <strong>${escapeHtml(raza)}</strong></span>` : ""}
                ${fechaNac ? `<span>Nac: <strong>${formatearFecha(fechaNac)}</strong></span>` : ""}
                ${partosInfo ? `<span>${escapeHtml(partosInfo)}</span>` : ""}
                ${fechaUltParto ? `<span>Últ. parto: <strong>${formatearFecha(fechaUltParto)}</strong></span>` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    container.querySelectorAll(".ai-clickable-animal").forEach((card) => {
      card.addEventListener("click", () => {
        const crotal = card.dataset.crotal;
        if (!crotal || crotal === "undefined" || crotal === "") return;
        cerrarModal();
        // Activar pestaña animales si es necesario
        if (AppState.tabActual !== "animales") {
          const tabBtn = document.querySelector('.nav-link[data-tab="animales"]') || document.querySelector('.mobile-tab-btn[data-tab="animales"]');
          if (tabBtn) tabBtn.click();
        }
        seleccionarAnimal(crotal, true);
      });
    });
    return;
  }

  // 3. Caso Compras de Alimento
  const esCompras = tipoResultado === "compras" || keys.includes("alimento") || keys.includes("precio_kg");
  if (esCompras) {
    container.innerHTML = `
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px;">
        ${filas.length} compras encontradas:
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${filas.map((c) => {
          const tieneImporte = c.importe > 0;
          const tieneKg = c.kg > 0;
          const precioKg = c.precio_kg > 0 ? c.precio_kg : (tieneImporte && tieneKg ? c.importe / c.kg : 0);
          let txtPrecio = precioKg > 0 ? `${formatearMoneda(precioKg, 4)} €/kg` : (c.proveedor === "ELABORACION PROPIA" ? "Propio" : "—");

          return `
            <article class="compra-card" style="margin: 0; padding: 12px 14px;">
              <div class="compra-header" style="margin-bottom: 6px;">
                <div class="compra-alimento-nombre" style="font-size: 0.95rem;">${escapeHtml(c.alimento || "Alimento")}</div>
                <span class="compra-date">${formatearFecha(c.fecha)}</span>
              </div>
              <div class="compra-specs-grid" style="gap: 8px; margin-bottom: 8px;">
                <div>
                  <div class="compra-metric-label">Kilos</div>
                  <div class="compra-metric-val" style="font-size: 0.95rem;">${formatearKg(c.kg)} kg</div>
                </div>
                <div>
                  <div class="compra-metric-label">Precio / kg</div>
                  <div class="compra-metric-val precio-unitario" style="font-size: 0.95rem;">${txtPrecio}</div>
                </div>
                <div>
                  <div class="compra-metric-label">Importe</div>
                  <div class="compra-metric-val" style="font-size: 0.95rem;">${tieneImporte ? `${formatearMoneda(c.importe, 2)} €` : "—"}</div>
                </div>
              </div>
              <div class="compra-footer" style="padding-top: 6px; font-size: 0.78rem;">
                <div>Proveedor: <strong>${escapeHtml(c.proveedor || "-")}</strong></div>
                ${c.albaran ? `<div>Albarán: ${escapeHtml(c.albaran)}</div>` : ""}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
    return;
  }

  // 4. Caso Recetas Veterinarias
  const esRecetas = tipoResultado === "recetas" || keys.includes("medicamento") || keys.includes("receta");
  if (esRecetas) {
    container.innerHTML = `
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px;">
        ${filas.length} tratamientos / recetas:
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${filas.map((r) => {
          return `
            <article class="receta-card" style="margin: 0; padding: 12px 14px;">
              <div class="receta-header" style="margin-bottom: 6px;">
                <div class="receta-med-nombre" style="font-size: 0.95rem;">${escapeHtml(r.medicamento || "Tratamiento")}</div>
                <span class="receta-date">${formatearFecha(r.fecha)}</span>
              </div>
              <div class="receta-specs-grid" style="gap: 8px; margin-bottom: 8px;">
                <div>
                  <div class="receta-metric-label">Receta Nº</div>
                  <div class="receta-metric-val" style="font-size: 0.9rem;">${escapeHtml(r.receta || "-")}</div>
                </div>
                <div>
                  <div class="receta-metric-label">Animales</div>
                  <div class="receta-metric-val" style="font-size: 0.9rem;">${r.n_animales ? `${r.n_animales} cabezas` : "1 cabeza"}</div>
                </div>
                <div>
                  <div class="receta-metric-label">Veterinario</div>
                  <div class="receta-metric-val" style="font-size: 0.85rem;">${escapeHtml(r.veterinario || "-")}</div>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
    return;
  }

  // 5. Tabla genérica para otras consultas
  container.innerHTML = `
    <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px;">
      ${filas.length} registros:
    </div>
    <div style="overflow-x: auto; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
      <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
        <thead>
          <tr style="background: var(--bg-surface-subtle); border-bottom: 1px solid var(--border-color);">
            ${keys.map((k) => `<th style="padding: 10px 12px; font-weight: 700; color: var(--text-muted);">${escapeHtml(k.replace(/_/g, " "))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${filas.map((fila, idx) => `
            <tr style="border-bottom: 1px solid var(--border-color); background: ${idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)'};">
              ${keys.map((k) => {
                const val = fila[k];
                if (k.toLowerCase().includes("corral") || k.toLowerCase().includes("lote")) {
                  return `
                    <td style="padding: 10px 12px;">
                      <button class="clickable-chip chip-corral" onclick="cerrarYVerCorral('${escapeHtml(val)}')">
                        ${escapeHtml(val || "Sin lote")}
                      </button>
                    </td>
                  `;
                }
                return `<td style="padding: 10px 12px;">${val != null ? escapeHtml(val) : "—"}</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  window.cerrarYVerCorral = function (nombreCorral) {
    cerrarModal();
    if (AppState.tabActual !== "animales") {
      const tabBtn = document.querySelector('.nav-link[data-tab="animales"]') || document.querySelector('.mobile-tab-btn[data-tab="animales"]');
      if (tabBtn) tabBtn.click();
    }
    verDetalleCorral(nombreCorral, true);
  };
}
