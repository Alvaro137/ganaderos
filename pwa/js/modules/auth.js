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

export function mostrarPantallaLogin(mensajeError = "") {
  const container = document.getElementById("app-container");
  if (!container) return;
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
  if (input && esPantallaEscritorio()) setTimeout(() => input.focus(), 150);

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
