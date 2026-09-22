// app.js
/**
 * Coordinador principal de la aplicación Ganaderos Campo PWA.
 * Orquestación de vistas modulares, inicialización de SQLite WASM,
 * navegación adaptativa y Service Worker.
 */

import { AppState, debounce, formatearFecha } from './modules/config.js';
import { inicializarDB, getMetadata } from './modules/db.js';
import { mostrarPantallaLogin } from './modules/auth.js';
import { renderVistaAnimales } from './modules/views/cattle_view.js';
import { renderVistaRecetas } from './modules/views/sanitary_view.js';
import { renderVistaAlimentos } from './modules/views/feeds_view.js';
import { renderVistaMovimientos } from './modules/views/movements_view.js';
import { setupAsistenteIA } from './modules/views/assistant_view.js';

function setupNavegacion() {
  const desktopLinks = document.querySelectorAll(".nav-link[data-tab]");
  const mobileButtons = document.querySelectorAll(".mobile-tab-btn[data-tab]");

  function cambiarTab(tabKey) {
    if (!tabKey || AppState.tabActual === tabKey) return;
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

async function iniciarAplicacion() {
  const container = document.getElementById("app-container");

  try {
    await inicializarDB((mensaje) => {
      const elMsg = document.getElementById("loading-msg");
      if (elMsg) elMsg.textContent = mensaje;
    });

    const meta = getMetadata();
    const fechaExp = meta ? meta["fecha_exportacion"] : null;
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
    console.error("Error en arranque de aplicación:", err);

    if (err.message === "AUTH_REQUIRED") {
      mostrarPantallaLogin();
      return;
    }

    if (err.message === "SIN_CONEXION_INICIAL") {
      if (container) {
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
      }
      return;
    }

    if (container) {
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
}

document.addEventListener("DOMContentLoaded", async () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service Worker no registrado:", err);
    });
  }
  await iniciarAplicacion();
});
