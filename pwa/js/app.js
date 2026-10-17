// app.js
/**
 * Coordinador principal de la aplicación Ganaderos Campo PWA.
 * Orquestación de vistas modulares, inicialización de SQLite WASM,
 * navegación adaptativa y Service Worker.
 */

import { AppState, debounce, formatearFecha } from './modules/config.js';
import { inicializarDB, getMetadata } from './modules/db.js';
import { mostrarPantallaLogin, actualizarBadgeUsuario } from './modules/auth.js';
import { renderVistaAnimales } from './modules/views/cattle_view.js';
import { renderVistaRecetas } from './modules/views/sanitary_view.js';
import { renderVistaAlimentos } from './modules/views/feeds_view.js';
import { renderVistaMovimientos } from './modules/views/movements_view.js';
import { renderVistaLiquidaciones } from './modules/views/sales_view.js';
import { setupAsistenteIA } from './modules/views/assistant_view.js';
import { actualizarBadgeSync, mostrarModalOutbox, sincronizarOutboxConServidor } from './modules/outbox.js';

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
    } else if (tabKey === "ventas") {
      renderVistaLiquidaciones();
    }
  }

  desktopLinks.forEach((l) => l.addEventListener("click", () => cambiarTab(l.dataset.tab)));
  mobileButtons.forEach((b) => b.addEventListener("click", () => cambiarTab(b.dataset.tab)));

  window.addEventListener("campo:navegar-tab", (e) => {
    const tab = typeof e.detail === "string" ? e.detail : e.detail?.tab;
    if (tab) {
      cambiarTab(tab);
    }
  });
}

let toastTimer = null;

function mostrarToast(mensaje) {
  let toast = document.getElementById("pwa-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "pwa-toast";
    toast.className = "pwa-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = mensaje;
  toast.classList.add("pwa-toast--visible");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toast.classList.remove("pwa-toast--visible");
    toastTimer = null;
  }, 2500);
}

async function iniciarAplicacion() {
  const container = document.getElementById("app-container");

  const token = localStorage.getItem("campo_pwa_token");
  if (!token) {
    mostrarPantallaLogin();
    return;
  }

  actualizarBadgeUsuario();
  actualizarBadgeSync();

  const btnSyncBadge = document.getElementById("btn-sync-badge");
  if (btnSyncBadge) {
    btnSyncBadge.addEventListener("click", () => mostrarModalOutbox());
  }

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

    window.addEventListener("campo:db-updated", (e) => {
      const meta = e.detail && e.detail.meta ? e.detail.meta : getMetadata();
      const fechaExp = meta ? (meta["fecha_exportacion"] || meta["fecha_export"]) : null;
      const elFecha = document.getElementById("meta-fecha");
      if (elFecha && fechaExp) {
        elFecha.textContent = `Censo: ${formatearFecha(fechaExp)}`;
      }

      if (AppState.tabActual === "animales") {
        renderVistaAnimales();
      } else if (AppState.tabActual === "alimentos") {
        renderVistaAlimentos();
      } else if (AppState.tabActual === "recetas") {
        renderVistaRecetas();
      } else if (AppState.tabActual === "movimientos") {
        renderVistaMovimientos();
      } else if (AppState.tabActual === "ventas") {
        renderVistaLiquidaciones();
      }

      mostrarToast("Base de datos actualizada");
    });

    window.addEventListener("campo:outbox-updated", () => {
      actualizarBadgeSync();
    });

    window.addEventListener("online", () => {
      actualizarBadgeSync();
      sincronizarOutboxConServidor().catch((e) => {
        console.warn("[Outbox] Sincronización automática fallida:", e);
      });
    });

    window.addEventListener(
      "resize",
      debounce(() => {
        if (document.getElementById("form-auth-login")) return;
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
            <button class="nav-link active btn-retry-reload" style="background: var(--brand-primary); color: #fff; padding: 10px 24px; border-radius: var(--radius-sm); font-size: 0.95rem; font-weight: 600; cursor: pointer;">
              Reintentar
            </button>
          </div>
        `;
        container.querySelectorAll(".btn-retry-reload").forEach((b) => b.addEventListener("click", () => location.reload()));
      }
      return;
    }

    if (container) {
      container.innerHTML = `
        <div class="loading-state">
          <h2 style="color: #991b1b;">Error al abrir base de datos</h2>
          <p style="color: var(--text-muted);">${err.message}</p>
          <button class="nav-link active btn-retry-reload" style="margin-top: 15px; background: var(--brand-primary); color: #fff; cursor: pointer;">
            Reintentar
          </button>
        </div>
      `;
      container.querySelectorAll(".btn-retry-reload").forEach((b) => b.addEventListener("click", () => location.reload()));
    }
  }
}

let deferredInstallPrompt = null;

function inicializarPWAInstall() {
  const btnInstall = document.getElementById("btn-install-pwa");
  if (!btnInstall) return;

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isStandalone) {
    btnInstall.style.display = "none";
    return;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    btnInstall.style.display = "inline-flex";
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    btnInstall.style.display = "none";
    console.log("[PWA] Aplicación instalada exitosamente.");
  });

  btnInstall.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === "accepted") {
        btnInstall.style.display = "none";
      }
      deferredInstallPrompt = null;
    } else {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS) {
        alert("Para instalar en iPhone/iPad:\n1. Toca el botón Compartir (cuadrado con flecha hacia arriba).\n2. Selecciona 'Añadir a la pantalla de inicio'.");
      } else {
        alert("Para instalar la aplicación:\n1. Abre el menú del navegador (los 3 puntos ⋮).\n2. Selecciona 'Instalar aplicación' o 'Añadir a la pantalla principal'.");
      }
    }
  });

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS && !isStandalone) {
    btnInstall.style.display = "inline-flex";
  }
}

async function bootstrap() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service Worker no registrado:", err);
    });
  }
  inicializarPWAInstall();
  await iniciarAplicacion();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
