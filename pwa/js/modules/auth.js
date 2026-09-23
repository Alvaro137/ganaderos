// modules/auth.js
import { escapeHtml, esPantallaEscritorio } from './config.js';

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
          ${user.rol === "vaquero" ? "👨‍🌾" : user.rol === "veterinario" ? "🩺" : "👑"}
        </div>
        <div>
          <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--text-main); margin-bottom: 2px;">
            ${escapeHtml(user.nombre)}
          </h3>
          <span style="font-size: 0.78rem; font-weight: 600; color: var(--brand-primary); text-transform: uppercase; letter-spacing: 0.04em;">
            Rol: ${escapeHtml(user.rol)}
          </span>
        </div>
      </div>
      <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;">
        ¿Deseas cerrar la sesión activa para cambiar de operador de campo?
      </p>
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
}

const DEFAULT_USERS = [
  { id: "usr_paco", nombre: "Paco (Vaquero)", rol: "vaquero" },
  { id: "usr_vet", nombre: "Veterinario (Sanidad)", rol: "veterinario" },
  { id: "usr_admin", nombre: "Álvaro (Administrador)", rol: "admin" }
];

export async function mostrarPantallaLogin(mensajeError = "") {
  const container = document.getElementById("app-container");
  if (!container) return;

  // Ocultar badge de usuario en la cabecera durante login
  const btnUser = document.getElementById("btn-header-user");
  if (btnUser) btnUser.style.display = "none";

  // Intentar cargar usuarios activos desde API o caché local
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

  function getAvatarForRole(rol) {
    if (rol === "vaquero") return "👨‍🌾";
    if (rol === "veterinario") return "🩺";
    return "👑";
  }

  container.innerHTML = `
    <div class="auth-card-container">
      <div class="auth-header-section">
        <img src="./icon-192.png" alt="Ganaderos" class="auth-logo">
        <h2 class="auth-title">Ganaderos Campo</h2>
        <p class="auth-subtitle">Acceso seguro y registro de actividad ganadera</p>
      </div>

      ${mensajeError ? `
        <div style="background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.85rem; margin-bottom: 14px; width: 100%; text-align: center;">
          ${escapeHtml(mensajeError)}
        </div>
      ` : ""}

      <!-- 1. SELECCIÓN DE OPERADOR -->
      <div id="section-operator-select" style="width: 100%;">
        <div class="auth-section-title">Acceso Rápido por Operador (Campo)</div>
        <div class="operator-grid">
          ${users.map((u) => `
            <div class="operator-card" data-user-id="${escapeHtml(u.id)}" data-user-name="${escapeHtml(u.nombre)}" data-user-role="${escapeHtml(u.rol)}">
              <div class="operator-avatar">${getAvatarForRole(u.rol)}</div>
              <div class="operator-info">
                <div class="operator-name">${escapeHtml(u.nombre)}</div>
                <div class="operator-role-badge">Rol: ${escapeHtml(u.rol)}</div>
              </div>
              <div style="color: var(--text-dim); font-size: 1.2rem;">›</div>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- 2. ACCESO POR CONTRASEÑA MAESTRA (FALLBACK / PROPIETARIO) -->
      <div id="section-master-pass" style="width: 100%; margin-top: 6px;">
        <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 18px; box-shadow: var(--shadow-sm);">
          <div class="auth-section-title" style="margin-top: 0; margin-bottom: 8px;">O con Contraseña de Explotación</div>
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
              Desbloquear Censo
            </button>
          </form>
        </div>
      </div>

      <!-- 3. TECLADO PIN PARA OPERADOR SELECCIONADO -->
      <div id="section-pin-entry" style="display: none; width: 100%;">
        <div class="pin-entry-container">
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span id="pin-op-avatar" style="font-size: 1.4rem;">👨‍🌾</span>
              <div>
                <strong id="pin-op-name" style="font-size: 0.95rem; color: var(--text-main);">Operador</strong>
                <div id="pin-op-role" style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;">Vaquero</div>
              </div>
            </div>
            <button id="btn-back-to-operators" style="background: none; border: none; color: var(--brand-primary); font-size: 0.8rem; font-weight: 700; cursor: pointer;">
              Cambiar
            </button>
          </div>

          <div class="pin-display-wrapper">
            <span style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">Introduce tu PIN de 4 dígitos:</span>
            <div class="pin-dots-display">
              <div class="pin-dot" id="pindot-0"></div>
              <div class="pin-dot" id="pindot-1"></div>
              <div class="pin-dot" id="pindot-2"></div>
              <div class="pin-dot" id="pindot-3"></div>
            </div>
            <div id="pin-error-msg" style="color: #dc2626; font-size: 0.8rem; min-height: 1.2em; text-align: center; font-weight: 600;"></div>
          </div>

          <!-- Teclado Numérico Táctil de Campo (Apto Guantes / Lluvia) -->
          <div class="pin-keypad-grid">
            <button type="button" class="pin-keypad-btn" data-digit="1">1</button>
            <button type="button" class="pin-keypad-btn" data-digit="2">2</button>
            <button type="button" class="pin-keypad-btn" data-digit="3">3</button>
            <button type="button" class="pin-keypad-btn" data-digit="4">4</button>
            <button type="button" class="pin-keypad-btn" data-digit="5">5</button>
            <button type="button" class="pin-keypad-btn" data-digit="6">6</button>
            <button type="button" class="pin-keypad-btn" data-digit="7">7</button>
            <button type="button" class="pin-keypad-btn" data-digit="8">8</button>
            <button type="button" class="pin-keypad-btn" data-digit="9">9</button>
            <button type="button" class="pin-keypad-btn action" id="btn-pin-clear" title="Borrar">⌫</button>
            <button type="button" class="pin-keypad-btn" data-digit="0">0</button>
            <button type="button" class="pin-keypad-btn action enter" id="btn-pin-submit" title="Entrar">✓</button>
          </div>
      </div>

    </div>
  `;

  let currentSelectedUser = null;
  let pinBuffer = "";

  const secOpSelect = document.getElementById("section-operator-select");
  const secPinEntry = document.getElementById("section-pin-entry");
  const secMasterPass = document.getElementById("section-master-pass");

  function actualizarDots() {
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById(`pindot-${i}`);
      if (dot) {
        if (i < pinBuffer.length) {
          dot.classList.add("filled");
        } else {
          dot.classList.remove("filled");
        }
      }
    }
  }

  async function ejecutarLoginPin() {
    if (!currentSelectedUser || pinBuffer.length < 4) return;
    const pinErr = document.getElementById("pin-error-msg");
    if (pinErr) pinErr.textContent = "Verificando PIN...";

    try {
      const resp = await fetch("./api/auth/login-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentSelectedUser.id,
          pin: pinBuffer
        })
      });
      const data = await resp.json();
      if (resp.ok && data.ok && data.token) {
        guardarSesion(data.token, data.user || currentSelectedUser);
        location.reload();
      } else {
        if (pinErr) pinErr.textContent = data.detail || "PIN incorrecto. Reinténtalo.";
        pinBuffer = "";
        actualizarDots();
      }
    } catch (err) {
      if (pinErr) pinErr.textContent = "Error de conexión: " + err.message;
      pinBuffer = "";
      actualizarDots();
    }
  }

  // Listener selección de operario
  container.querySelectorAll(".operator-card").forEach((card) => {
    card.addEventListener("click", () => {
      const uid = card.dataset.userId;
      const uname = card.dataset.userName;
      const urole = card.dataset.userRole;
      currentSelectedUser = { id: uid, nombre: uname, rol: urole };
      pinBuffer = "";

      const pinOpName = document.getElementById("pin-op-name");
      const pinOpRole = document.getElementById("pin-op-role");
      const pinOpAvatar = document.getElementById("pin-op-avatar");
      if (pinOpName) pinOpName.textContent = uname;
      if (pinOpRole) pinOpRole.textContent = urole;
      if (pinOpAvatar) pinOpAvatar.textContent = getAvatarForRole(urole);

      secOpSelect.style.display = "none";
      secMasterPass.style.display = "none";
      secPinEntry.style.display = "block";
      actualizarDots();
    });
  });

  // Teclado PIN
  container.querySelectorAll(".pin-keypad-btn[data-digit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (pinBuffer.length < 4) {
        pinBuffer += btn.dataset.digit;
        actualizarDots();
        const pinErr = document.getElementById("pin-error-msg");
        if (pinErr) pinErr.textContent = "";
        if (pinBuffer.length === 4) {
          ejecutarLoginPin();
        }
      }
    });
  });

  document.getElementById("btn-pin-clear")?.addEventListener("click", () => {
    if (pinBuffer.length > 0) {
      pinBuffer = pinBuffer.slice(0, -1);
      actualizarDots();
    }
  });

  document.getElementById("btn-pin-submit")?.addEventListener("click", () => {
    if (pinBuffer.length === 4) {
      ejecutarLoginPin();
    }
  });

  // Teclado físico numérico (PC / laptop)
  window.addEventListener("keydown", (e) => {
    if (secPinEntry.style.display !== "none" && currentSelectedUser) {
      if (/^[0-9]$/.test(e.key) && pinBuffer.length < 4) {
        pinBuffer += e.key;
        actualizarDots();
        if (pinBuffer.length === 4) ejecutarLoginPin();
      } else if (e.key === "Backspace") {
        pinBuffer = pinBuffer.slice(0, -1);
        actualizarDots();
      } else if (e.key === "Enter" && pinBuffer.length === 4) {
        ejecutarLoginPin();
      }
    }
  });

  // Navegación entre vistas
  document.getElementById("btn-back-to-operators")?.addEventListener("click", () => {
    secPinEntry.style.display = "none";
    secOpSelect.style.display = "block";
    secMasterPass.style.display = "block";
    currentSelectedUser = null;
    pinBuffer = "";
  });

  // Formulario Contraseña Maestra
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
          body: JSON.stringify({ password: pass })
        });
        const data = await resp.json();

        if (resp.ok && data.ok && data.token) {
          guardarSesion(data.token, data.user || { id: "usr_admin", nombre: "Álvaro (Administrador)", rol: "admin" });
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
