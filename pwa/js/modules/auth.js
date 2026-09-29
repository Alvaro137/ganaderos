// modules/auth.js — Login KISS: operador + contraseña compartida de la explotación.
// Sin PINs, sin teclado numérico y sin roles visibles. El operador elegido solo
// aporta atribución de sesión (quién consulta) para una futura consolidación de BDs.
import { escapeHtml } from './config.js';

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

export async function mostrarPantallaLogin(mensajeError = "") {
  const container = document.getElementById("app-container");
  if (!container) return;

  // Ocultar badge de usuario en la cabecera durante login
  const btnUser = document.getElementById("btn-header-user");
  if (btnUser) btnUser.style.display = "none";

  // Cargar operadores activos desde la API (con caché local de respaldo)
  let users = DEFAULT_USERS;
  try {
    const resp = await fetch("./api/auth/users");
    if (resp.ok) {
      const data = await resp.json();
      if (data.ok && Array.isArray(data.users) && data.users.length > 0) {
        users = data.users;
        localStorage.setItem("campo_pwa_users_cache", JSON.stringify(users));
      }
    }
  } catch (e) {
    const cached = localStorage.getItem("campo_pwa_users_cache");
    if (cached) {
      try { users = JSON.parse(cached); } catch (_) {}
    }
  }

  let operadorSeleccionado = null; // null => el backend usa el operador por defecto

  container.innerHTML = `
    <div class="auth-card-container">
      <div class="auth-header-section">
        <img src="./icon-192.png" alt="Ganaderos" class="auth-logo">
        <h2 class="auth-title">Ganaderos Campo</h2>
        <p class="auth-subtitle">¿Quién eres? Elige tu nombre y entra con la contraseña de la explotación</p>
      </div>

      ${mensajeError ? `
        <div style="background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.85rem; margin-bottom: 14px; width: 100%; text-align: center;">
          ${escapeHtml(mensajeError)}
        </div>
      ` : ""}

      <!-- 1. SELECCIÓN DE OPERADOR (solo atribución, sin roles ni PIN) -->
      <div id="section-operator-select" style="width: 100%;">
        <div class="operator-grid">
          ${users.map((u) => `
            <div class="operator-card" data-user-id="${escapeHtml(u.id)}" data-user-name="${escapeHtml(u.nombre)}">
              <div class="operator-avatar">🧑‍🌾</div>
              <div class="operator-info">
                <div class="operator-name">${escapeHtml(u.nombre)}</div>
              </div>
              <div style="color: var(--text-dim); font-size: 1.2rem;">›</div>
            </div>
          `).join("")}
        </div>
      </div>
      <!-- PARTE 2B -->
    </div>
  `;

  await montarFormularioLogin(container, () => operadorSeleccionado, (v) => { operadorSeleccionado = v; });
}

// === PARTE 2B ===

async function montarFormularioLogin(container, getOperador, setOperador) {
  let operadorSeleccionado = getOperador();

  // 2. CONTRASEÑA COMPARTIDA DE LA EXPLOTACIÓN (único paso de acceso)
  const secMaster = document.createElement("div");
  secMaster.id = "section-master-pass";
  secMaster.style.cssText = "width: 100%; margin-top: 6px;";
  secMaster.innerHTML = `
    <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 18px; box-shadow: var(--shadow-sm);">
      <div class="auth-section-title" style="margin-top: 0; margin-bottom: 8px;">Contraseña de la explotación</div>
      <p id="login-operador-activo" style="margin: 0 0 10px 0; font-size: 0.82rem; color: var(--text-muted);"></p>
      <form id="form-auth-login" style="width: 100%; display: flex; flex-direction: column; gap: 12px;">
        <input
          type="password"
          id="input-auth-pass"
          placeholder="Contraseña de la explotación..."
          autocomplete="current-password"
          style="width: 100%; padding: 12px 14px; font-size: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color); background: var(--bg-surface); color: var(--text-main); outline: none; box-sizing: border-box;"
          required
        />
        <button
          type="submit"
          id="btn-submit-auth"
          style="width: 100%; padding: 12px; background: var(--brand-primary); color: #fff; font-size: 0.95rem; font-weight: 700; border: none; border-radius: var(--radius-md); cursor: pointer; transition: opacity 0.2s;"
        >
          Entrar
        </button>
      </form>
    </div>
  `;
  const marcador = container.querySelector("#section-operator-select");
  marcador.insertAdjacentElement("afterend", secMaster);

  function refrescarOperadorActivo() {
    const el = document.getElementById("login-operador-activo");
    if (!el) return;
    el.textContent = operadorSeleccionado
      ? `Entrarás como: ${operadorSeleccionado.nombre}`
      : "Sin operador elegido: entrarás como Álvaro (propietario).";
  }
  refrescarOperadorActivo();

  // Selección de operador: solo marca la tarjeta; el formulario permanece visible
  container.querySelectorAll(".operator-card").forEach((card) => {
    card.addEventListener("click", () => {
      const uid = card.dataset.userId;
      const uname = card.dataset.userName;

      if (operadorSeleccionado && operadorSeleccionado.id === uid) {
        // Segundo clic: deseleccionar (vuelta al operador por defecto)
        operadorSeleccionado = null;
        card.classList.remove("selected");
        card.style.borderColor = "";
      } else {
        container.querySelectorAll(".operator-card").forEach((c) => {
          c.classList.remove("selected");
          c.style.borderColor = "";
        });
        operadorSeleccionado = { id: uid, nombre: uname };
        card.classList.add("selected");
        card.style.borderColor = "var(--brand-primary)";
      }
      setOperador(operadorSeleccionado);
      refrescarOperadorActivo();
    });
  });

  // Formulario único de acceso con la contraseña compartida
  const form = document.getElementById("form-auth-login");
  const input = document.getElementById("input-auth-pass");
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
          body: JSON.stringify({
            password: pass,
            user_id: operadorSeleccionado ? operadorSeleccionado.id : null
          })
        });
        const data = await resp.json();

        if (resp.ok && data.ok && data.token) {
          guardarSesion(data.token, data.user || null);
          location.reload();
        } else {
          mostrarPantallaLogin(data.detail || "Contraseña incorrecta.");
        }
      } catch (err) {
        mostrarPantallaLogin("Error conectando con el servidor: " + err.message);
      }
    });
  }
}