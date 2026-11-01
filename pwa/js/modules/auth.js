// modules/auth.js — Login KISS: operador + contraseña compartida de la explotación.
// Sin PINs, sin teclado numérico y sin roles visibles. El operador elegido solo
// aporta atribución de sesión (quién consulta) para una futura consolidación de BDs.
import { escapeHtml } from './config.js';
import { sincronizarBaseDatosAhora } from './db.js';

export function obtenerAuthHeaders() {
  const token = localStorage.getItem("campo_pwa_token") || "";
  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    headers["X-Auth-Token"] = token;
  }
  return headers;
}

export function obtenerUsuarioActual() {
  try {
    const raw = localStorage.getItem("campo_pwa_user");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn("Error leyendo usuario activo de localStorage:", e);
    return null;
  }
}

export function guardarSesion(token, user) {
  if (token) {
    localStorage.setItem("campo_pwa_token", token);
  }
  if (user) {
    localStorage.setItem("campo_pwa_user", JSON.stringify(user));
  }
}

export function cerrarSesion() {
  localStorage.removeItem("campo_pwa_token");
  localStorage.removeItem("campo_pwa_user");
  location.reload();
}

export function actualizarBadgeUsuario() {
  const btnUser = document.getElementById("btn-header-user");
  const elName = document.getElementById("header-user-name");
  if (!btnUser || !elName) return;

  const user = obtenerUsuarioActual();
  if (!user) {
    btnUser.style.display = "none";
    return;
  }

  // Nombre corto para la barra de navegación
  const nombreCorto = user.nombre.split(" ")[0] || user.id;
  elName.textContent = nombreCorto;
  btnUser.style.display = "inline-flex";

  btnUser.onclick = () => {
    mostrarModalSesionUsuario(user);
  };
}

function mostrarModalSesionUsuario(user) {
  const existing = document.getElementById("modal-user-session");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "modal-user-session";
  overlay.className = "user-session-modal-overlay";
  overlay.innerHTML = `
    <div class="user-session-modal-card">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="font-size: 2rem; background: var(--md-surface-container-high); width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
          🧑‍🌾
        </div>
        <div>
          <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--text-main); margin-bottom: 2px;">
            ${escapeHtml(user.nombre)}
          </h3>
          <span style="font-size: 0.78rem; font-weight: 600; color: var(--brand-primary);">
            Sesión activa en este dispositivo
          </span>
        </div>
      </div>
      <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;">
        ¿Deseas cerrar la sesión activa para cambiar de operador de campo?
      </p>

      ${(user.id === "usr_admin" || user.rol === "admin") ? `
        <div style="border-top: 1px solid var(--border-color); padding-top: 10px; margin-top: 2px;">
          <button id="btn-toggle-change-pwd" type="button" style="background: none; border: none; padding: 0; color: var(--brand-primary); font-size: 0.85rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;">
            <span>🔑 Cambiar contraseña de la explotación</span>
          </button>
          <form id="form-change-pwd" style="display: none; flex-direction: column; gap: 8px; margin-top: 10px;">
            <input
              type="password"
              id="input-current-pwd"
              placeholder="Contraseña actual..."
              autocomplete="current-password"
              style="width: 100%; padding: 8px 10px; font-size: 0.88rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-surface); color: var(--text-main); box-sizing: border-box;"
              required
            />
            <input
              type="password"
              id="input-new-pwd"
              placeholder="Nueva contraseña (mín. 8 carácteres)..."
              autocomplete="new-password"
              minlength="8"
              style="width: 100%; padding: 8px 10px; font-size: 0.88rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-surface); color: var(--text-main); box-sizing: border-box;"
              required
            />
            <div id="change-pwd-feedback" style="display: none; font-size: 0.8rem; border-radius: var(--radius-sm); padding: 6px 10px;"></div>
            <button
              type="submit"
              id="btn-submit-change-pwd"
              style="padding: 8px 12px; background: var(--brand-primary); color: #fff; font-size: 0.88rem; font-weight: 700; border: none; border-radius: var(--radius-sm); cursor: pointer;"
            >
              Guardar y reautenticar
            </button>
          </form>
        </div>
      ` : ""}



      <div style="display: flex; gap: 10px; margin-top: 6px;">
        <button id="btn-cancel-session-modal" style="flex: 1; padding: 10px; background: var(--md-surface-container); border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-weight: 600; cursor: pointer; color: var(--text-main);">
          Cancelar
        </button>
        <button id="btn-logout-session-modal" style="flex: 1; padding: 10px; background: #dc2626; border: none; border-radius: var(--radius-sm); font-weight: 700; cursor: pointer; color: #ffffff;">
          Cerrar Sesión
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("btn-cancel-session-modal")?.addEventListener("click", () => overlay.remove());
  document.getElementById("btn-logout-session-modal")?.addEventListener("click", () => cerrarSesion());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });



  // Manejo de cambio de contraseña
  const btnTogglePwd = document.getElementById("btn-toggle-change-pwd");
  const formChangePwd = document.getElementById("form-change-pwd");
  if (btnTogglePwd && formChangePwd) {
    btnTogglePwd.addEventListener("click", () => {
      const visible = formChangePwd.style.display === "flex";
      formChangePwd.style.display = visible ? "none" : "flex";
      if (!visible) {
        document.getElementById("input-current-pwd")?.focus();
      }
    });

    formChangePwd.addEventListener("submit", async (e) => {
      e.preventDefault();
      const currentPwd = document.getElementById("input-current-pwd")?.value.trim() || "";
      const newPwd = document.getElementById("input-new-pwd")?.value.trim() || "";
      const feedback = document.getElementById("change-pwd-feedback");
      const btnSubmit = document.getElementById("btn-submit-change-pwd");

      if (!currentPwd || !newPwd) return;

      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = "Guardando...";
      }
      if (feedback) feedback.style.display = "none";

      try {
        const resp = await fetch("./api/auth/change-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...obtenerAuthHeaders()
          },
          body: JSON.stringify({ current_password: currentPwd, new_password: newPwd })
        });
        const data = await resp.json();

        if (resp.ok && data.ok) {
          if (feedback) {
            feedback.style.display = "block";
            feedback.style.background = "#dcfce7";
            feedback.style.border = "1px solid #bbf7d0";
            feedback.style.color = "#15803d";
            feedback.textContent = data.message || "Contraseña actualizada. Vuelve a iniciar sesión.";
          }
          setTimeout(() => {
            cerrarSesion();
          }, 1200);
        } else {
          if (feedback) {
            feedback.style.display = "block";
            feedback.style.background = "#fef2f2";
            feedback.style.border = "1px solid #fecaca";
            feedback.style.color = "#991b1b";
            feedback.textContent = data.detail || data.error || "No se pudo cambiar la contraseña.";
          }
          if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.textContent = "Guardar y reautenticar";
          }
        }
      } catch (err) {
        if (feedback) {
          feedback.style.display = "block";
          feedback.style.background = "#fef2f2";
          feedback.style.border = "1px solid #fecaca";
          feedback.style.color = "#991b1b";
          feedback.textContent = "Error de conexión: " + err.message;
        }
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = "Guardar y reautenticar";
        }
      }
    });
  }
}

// === LOGIN SCREEN (parte 2) ===

const DEFAULT_USERS = [
  { id: "usr_admin", nombre: "Álvaro", rol: "admin" },
  { id: "usr_jose", nombre: "Jose", rol: "operador" },
  { id: "usr_amelia", nombre: "Amelia", rol: "operador" },
  { id: "usr_alex", nombre: "Alex", rol: "operador" },
  { id: "usr_otro", nombre: "Otro", rol: "operador" }
];

function generarMonograma(nombre) {
  if (!nombre) return "OP";
  const partes = nombre.trim().split(/\s+/);
  if (partes.length === 1) {
    return partes[0].slice(0, 2).toUpperCase();
  }
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

export async function mostrarPantallaLogin(mensajeError = "") {
  const container = document.getElementById("app-container");
  if (!container) return;

  // Aislar interfaz en modo login: oculta tab bar inferior, botones flotantes y metadatos
  document.body.classList.add("auth-mode");

  // Ocultar badge de usuario en la cabecera durante login
  const btnUser = document.getElementById("btn-header-user");
  if (btnUser) btnUser.style.display = "none";

  // Cargar operadores activos desde caché o valores por defecto
  let users = DEFAULT_USERS;
  const cached = localStorage.getItem("campo_pwa_users_cache");
  if (cached) {
    try { users = JSON.parse(cached); } catch (_) {}
  }

  // Refrescar lista de usuarios en segundo plano
  fetch("./api/auth/users").then(async (resp) => {
    if (resp.ok) {
      const data = await resp.json();
      if (data.ok && Array.isArray(data.users) && data.users.length > 0) {
        localStorage.setItem("campo_pwa_users_cache", JSON.stringify(data.users));
      }
    }
  }).catch(() => {});

  // Preselección inteligente: recordar último usuario seleccionado en este terminal
  const ultimoUserId = localStorage.getItem("campo_pwa_last_user_id") || "usr_admin";
  let operadorSeleccionado = users.find(u => u.id === ultimoUserId) || users[0] || null;

  container.innerHTML = `
    <div class="auth-card-container">
      <div class="auth-card">
        <div class="auth-header-section">
          <div class="auth-badge-tag">Acceso a Explotación</div>
          <h2 class="auth-title">Identificación de Campo</h2>
          <p class="auth-subtitle">Selecciona tu nombre e introduce la clave de la explotación</p>
        </div>

        <div id="auth-error-banner" class="auth-error-banner" style="${mensajeError ? 'display: block;' : 'display: none;'}">
          ${escapeHtml(mensajeError)}
        </div>

        <!-- 1. SELECCIÓN DE OPERADOR (Cuadrícula compacta de alto contraste) -->
        <div id="section-operator-select" class="operator-section">
          <div class="auth-field-label">Operador de campo</div>
          <div class="operator-grid">
            ${users.map((u) => {
              const isSel = operadorSeleccionado && operadorSeleccionado.id === u.id;
              return `
                <div class="operator-card ${isSel ? 'selected' : ''}" data-user-id="${escapeHtml(u.id)}" data-user-name="${escapeHtml(u.nombre)}" role="button" tabindex="0">
                  <div class="operator-avatar">${escapeHtml(generarMonograma(u.nombre))}</div>
                  <div class="operator-info">
                    <div class="operator-name">${escapeHtml(u.nombre)}</div>
                  </div>
                  <div class="operator-check">✓</div>
                </div>
              `;
            }).join("")}
          </div>
          <div id="login-operador-activo" class="operator-status-text"></div>
        </div>

        <!-- 2. CONTRASEÑA DE LA EXPLOTACIÓN -->
        <div id="section-master-pass" class="auth-pass-section">
          <form id="form-auth-login" class="auth-login-form">
            <div class="auth-field-label">Contraseña de la explotación</div>
            <div class="auth-input-wrapper">
              <input
                type="password"
                id="input-auth-pass"
                placeholder="Introduce la contraseña..."
                autocomplete="current-password"
                required
              />
              <button type="button" id="btn-toggle-pass-visibility" class="btn-toggle-eye" aria-label="Mostrar u ocultar contraseña">
                <svg class="eye-icon-show" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <svg class="eye-icon-hide" style="display: none;" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path>
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path>
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path>
                  <line x1="2" y1="2" x2="22" y2="22"></line>
                </svg>
              </button>
            </div>
            <button
              type="submit"
              id="btn-submit-auth"
              class="btn-submit-auth"
            >
              Entrar al Censo
            </button>
          </form>
        </div>
      </div>
    </div>
  `;

  const errorBanner = container.querySelector("#auth-error-banner");
  const form = container.querySelector("#form-auth-login");
  const inputPass = container.querySelector("#input-auth-pass");
  const btnSubmit = container.querySelector("#btn-submit-auth");
  const btnToggleEye = container.querySelector("#btn-toggle-pass-visibility");
  const eyeShow = container.querySelector(".eye-icon-show");
  const eyeHide = container.querySelector(".eye-icon-hide");
  const textOperadorActivo = container.querySelector("#login-operador-activo");

  function actualizarTextoOperador() {
    if (!textOperadorActivo) return;
    textOperadorActivo.textContent = operadorSeleccionado
      ? `Operario activo: ${operadorSeleccionado.nombre}`
      : "Operario: General / Titular";
  }
  actualizarTextoOperador();

  // Selección de operador
  container.querySelectorAll(".operator-card").forEach((card) => {
    const seleccionar = () => {
      const uid = card.dataset.userId;
      const uname = card.dataset.userName;

      if (operadorSeleccionado && operadorSeleccionado.id === uid) {
        operadorSeleccionado = null;
        card.classList.remove("selected");
      } else {
        container.querySelectorAll(".operator-card").forEach(c => c.classList.remove("selected"));
        operadorSeleccionado = { id: uid, nombre: uname };
        card.classList.add("selected");
      }
      actualizarTextoOperador();
    };

    card.addEventListener("click", seleccionar);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        seleccionar();
      }
    });
  });

  // Toggle visibilidad de contraseña
  if (btnToggleEye && inputPass && eyeShow && eyeHide) {
    btnToggleEye.addEventListener("click", () => {
      const esPassword = inputPass.getAttribute("type") === "password";
      inputPass.setAttribute("type", esPassword ? "text" : "password");
      eyeShow.style.display = esPassword ? "none" : "block";
      eyeHide.style.display = esPassword ? "block" : "none";
      inputPass.focus();
    });
  }

  // Envío de formulario sin reset destructivo
  if (form && inputPass && btnSubmit) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pass = inputPass.value.trim();
      if (!pass) return;

      btnSubmit.disabled = true;
      btnSubmit.textContent = "Entrando...";
      if (errorBanner) {
        errorBanner.style.display = "none";
        errorBanner.textContent = "";
      }

      try {
        const resp = await fetch("./api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: pass,
            user_id: operadorSeleccionado ? operadorSeleccionado.id : null
          })
        });
        const data = await resp.json();

        if (resp.ok && data.ok && data.token) {
          if (operadorSeleccionado) {
            localStorage.setItem("campo_pwa_last_user_id", operadorSeleccionado.id);
          }
          guardarSesion(data.token, data.user || null);
          document.body.classList.remove("auth-mode");
          location.reload();
        } else {
          btnSubmit.disabled = false;
          btnSubmit.textContent = "Entrar al Censo";
          if (errorBanner) {
            errorBanner.textContent = data.detail || "Contraseña incorrecta.";
            errorBanner.style.display = "block";
          }
          inputPass.value = "";
          inputPass.focus();
        }
      } catch (err) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = "Entrar al Censo";
        if (errorBanner) {
          errorBanner.textContent = "Error de conexión: " + err.message;
          errorBanner.style.display = "block";
        }
      }
    });
  }
}
