// modules/views/weighing_modal.js
/**
 * Modal táctil para registro rápido de pesajes en báscula de manga / campo.
 * Soporta entrada táctil rápida, cálculo inmediato de GMD y persistencia local/offline.
 */

import { escapeHtml, extraer4Digitos } from '../config.js';
import { registrarPesaje } from '../db.js';
import { guardarMutacionLocal, sincronizarOutboxConServidor } from '../outbox.js';
import { obtenerUsuarioActual } from '../auth.js';
import { seleccionarAnimal } from './detail_view.js';

let modalContainer = null;
let tipoPesajeSeleccionado = "Control";

function obtenerModalContainer() {
  let modal = document.getElementById("modal-registro-pesaje");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-registro-pesaje";
    modal.className = "modal-overlay";
    modal.style.display = "none";
    document.body.appendChild(modal);
  }
  return modal;
}

export function abrirModalRegistroPesaje({ crotal = "", crotal_4 = "" } = {}) {
  const modal = obtenerModalContainer();
  tipoPesajeSeleccionado = "Control";
  const c4 = crotal_4 || extraer4Digitos(crotal);
  const hoyStr = new Date().toISOString().split("T")[0];

  const html = `
    <div class="modal-dialog weighing-modal-dialog" style="max-width: 460px; width: 92%; margin: 16px auto; max-height: 90vh; background: var(--bg-surface, #ffffff); border-radius: var(--radius-lg, 16px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
      
      <!-- Cabecera -->
      <div style="background: var(--brand-primary, #1e3a2b); color: #ffffff; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">⚖️</span>
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #ffffff;">Registrar Pesaje</h3>
            <span style="font-size: 0.78rem; opacity: 0.85;">Báscula de manga y tolva (Offline)</span>
          </div>
        </div>
        <button id="btn-cerrar-modal-pesaje" aria-label="Cerrar modal" style="background: rgba(255,255,255,0.15); border: none; color: #ffffff; min-width: 48px; min-height: 48px; width: 48px; height: 48px; border-radius: 50%; font-size: 1.3rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">
          ✕
        </button>
      </div>

      <!-- Formulario -->
      <form id="form-registro-pesaje" style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; margin: 0;">
        <div class="modal-body-scroll" style="padding: 20px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; flex: 1; min-height: 0;">
          
          <div id="modal-pesaje-error" style="display: none; background: #fee2e2; color: #991b1b; padding: 10px 14px; border-radius: 8px; font-size: 0.88rem; font-weight: 600; border: 1px solid #fecaca;"></div>

          <!-- Animal Identificado -->
          <div style="background: var(--md-surface-container-low, #f4f6f4); border: 1px solid var(--md-outline-variant, #e0e0e0); border-radius: 10px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted, #666);">Animal</div>
              <div style="font-size: 1.4rem; font-weight: 800; color: var(--brand-primary, #1e3a2b);">${escapeHtml(c4)}</div>
            </div>
            <span style="font-size: 0.85rem; color: var(--text-dim, #777); font-family: monospace;">${escapeHtml(crotal)}</span>
          </div>

          <!-- Selector de Tipo de Pesaje -->
          <div>
            <label style="display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dim, #555); margin-bottom: 8px; text-transform: uppercase;">
              Tipo de Pesaje
            </label>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
              <button type="button" class="btn-tipo-pesaje active" data-tipo="Control" style="min-height: 48px; border-radius: 8px; border: 2px solid var(--brand-primary, #1e3a2b); background: var(--brand-primary, #1e3a2b); color: #fff; font-weight: 700; cursor: pointer;">
                Control
              </button>
              <button type="button" class="btn-tipo-pesaje" data-tipo="Destete" style="min-height: 48px; border-radius: 8px; border: 2px solid #ccc; background: #fff; color: #333; font-weight: 700; cursor: pointer;">
                Destete
              </button>
              <button type="button" class="btn-tipo-pesaje" data-tipo="Salida" style="min-height: 48px; border-radius: 8px; border: 2px solid #ccc; background: #fff; color: #333; font-weight: 700; cursor: pointer;">
                Salida
              </button>
            </div>
          </div>

          <!-- Entrada de Peso en Kg -->
          <div>
            <label for="input-peso-kg" style="display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dim, #555); margin-bottom: 6px; text-transform: uppercase;">
              Peso Vivo Báscula (kg) <span style="color: #dc2626;">*</span>
            </label>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="number" step="0.5" id="input-peso-kg" name="peso_kg" placeholder="Ej: 345.5" required
                style="flex: 1; min-height: 52px; font-size: 1.4rem; font-weight: 800; text-align: center; border: 2px solid var(--brand-primary, #1e3a2b); border-radius: 8px; padding: 8px;" />
              <span style="font-size: 1.2rem; font-weight: 700; color: var(--text-muted, #666);">kg</span>
            </div>
            <!-- Botones de incremento rápido -->
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 8px;">
              <button type="button" class="btn-step-peso" data-step="-10" style="min-height: 44px; border-radius: 6px; border: 1px solid #ccc; background: #f8f8f8; font-weight: 700;">-10</button>
              <button type="button" class="btn-step-peso" data-step="-1" style="min-height: 44px; border-radius: 6px; border: 1px solid #ccc; background: #f8f8f8; font-weight: 700;">-1</button>
              <button type="button" class="btn-step-peso" data-step="+1" style="min-height: 44px; border-radius: 6px; border: 1px solid #ccc; background: #f8f8f8; font-weight: 700;">+1</button>
              <button type="button" class="btn-step-peso" data-step="+10" style="min-height: 44px; border-radius: 6px; border: 1px solid #ccc; background: #f8f8f8; font-weight: 700;">+10</button>
            </div>
          </div>

          <!-- Fecha -->
          <div>
            <label for="input-fecha-pesaje" style="display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dim, #555); margin-bottom: 6px; text-transform: uppercase;">
              Fecha del Pesaje
            </label>
            <input type="date" id="input-fecha-pesaje" name="fecha" value="${hoyStr}" required
              style="width: 100%; min-height: 48px; border: 1.5px solid #ccc; border-radius: 8px; padding: 10px; font-size: 1rem; box-sizing: border-box;" />
          </div>

          <!-- Notas opcionales -->
          <div>
            <label for="input-notas-pesaje" style="display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dim, #555); margin-bottom: 6px; text-transform: uppercase;">
              Notas u Observaciones (Opcional)
            </label>
            <input type="text" id="input-notas-pesaje" name="notas" placeholder="Ej: Manga cebadero, buena conformación"
              style="width: 100%; min-height: 48px; border: 1.5px solid #ccc; border-radius: 8px; padding: 10px; font-size: 0.95rem; box-sizing: border-box;" />
          </div>

        </div>

        <!-- Sticky Footer con botón de acción -->
        <div style="padding: 14px 20px; background: #ffffff; border-top: 1px solid #eee; display: flex; gap: 12px; flex-shrink: 0;">
          <button type="button" id="btn-cancelar-modal-pesaje" style="flex: 1; min-height: 48px; border-radius: 8px; border: 1px solid #bbb; background: #f5f5f5; color: #444; font-weight: 700; cursor: pointer;">
            Cancelar
          </button>
          <button type="submit" id="btn-guardar-pesaje" style="flex: 2; min-height: 48px; border-radius: 8px; border: none; background: var(--brand-primary, #1e3a2b); color: #ffffff; font-weight: 800; font-size: 1.05rem; cursor: pointer;">
            Guardar Pesaje
          </button>
        </div>
      </form>
    </div>
  `;

  modal.innerHTML = html;
  modal.style.display = "flex";

  // Event Listeners
  const cerrar = () => {
    window.removeEventListener("keydown", onKeyDown);
    modal.style.display = "none";
    modal.innerHTML = "";
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") cerrar();
  };
  window.addEventListener("keydown", onKeyDown);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrar();
  });

  modal.querySelector("#btn-cerrar-modal-pesaje")?.addEventListener("click", cerrar);
  modal.querySelector("#btn-cancelar-modal-pesaje")?.addEventListener("click", cerrar);

  // Selector de tipo
  modal.querySelectorAll(".btn-tipo-pesaje").forEach(btn => {
    btn.addEventListener("click", () => {
      modal.querySelectorAll(".btn-tipo-pesaje").forEach(b => {
        b.style.background = "#fff";
        b.style.borderColor = "#ccc";
        b.style.color = "#333";
      });
      btn.style.background = "var(--brand-primary, #1e3a2b)";
      btn.style.borderColor = "var(--brand-primary, #1e3a2b)";
      btn.style.color = "#fff";
      tipoPesajeSeleccionado = btn.dataset.tipo;
    });
  });

  // Botones de ajuste de peso
  const inputPeso = modal.querySelector("#input-peso-kg");
  modal.querySelectorAll(".btn-step-peso").forEach(btn => {
    btn.addEventListener("click", () => {
      const step = parseFloat(btn.dataset.step) || 0;
      const current = parseFloat(inputPeso.value) || 250.0;
      const nuevo = Math.max(10, current + step);
      inputPeso.value = nuevo.toFixed(1);
    });
  });

  // Submit
  const form = modal.querySelector("#form-registro-pesaje");
  const errorBox = modal.querySelector("#modal-pesaje-error");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pesoVal = parseFloat(inputPeso.value);
    if (!pesoVal || pesoVal <= 0 || pesoVal > 2000) {
      errorBox.textContent = "Por favor, introduce un peso válido en kg (entre 10 y 2000 kg).";
      errorBox.style.display = "block";
      return;
    }

    const fechaVal = modal.querySelector("#input-fecha-pesaje").value || hoyStr;
    if (fechaVal > hoyStr) {
      errorBox.textContent = "La fecha del pesaje no puede ser posterior a la fecha actual.";
      errorBox.style.display = "block";
      return;
    }
    const notasVal = modal.querySelector("#input-notas-pesaje").value.trim() || null;
    const oper = obtenerUsuarioActual() || "Álvaro";

    try {
      // 1. Guardar localmente en SQLite WASM
      registrarPesaje({
        crotal,
        fecha: fechaVal,
        peso_kg: pesoVal,
        tipo: tipoPesajeSeleccionado,
        notas: notasVal,
        operador: oper
      });

      // 2. Registrar en Outbox para sincronización con hub
      await guardarMutacionLocal({
        tipo: "pesaje",
        crotal,
        operador: oper,
        payload: {
          fecha: fechaVal,
          peso_kg: pesoVal,
          tipo: tipoPesajeSeleccionado,
          notas: notasVal
        }
      });

      // Intento no bloqueante de sync
      sincronizarOutboxConServidor().catch(() => {});

      cerrar();

      // Recargar ficha del animal
      seleccionarAnimal(crotal, false);

      let toast = document.getElementById("pwa-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "pwa-toast";
        toast.className = "pwa-toast";
        document.body.appendChild(toast);
      }
      toast.textContent = `✓ Pesaje de ${pesoVal} kg registrado con éxito.`;
      toast.style.backgroundColor = "var(--brand-primary, #1e3a2b)";
      toast.style.color = "#ffffff";
      toast.classList.add("pwa-toast--visible");
      setTimeout(() => toast.classList.remove("pwa-toast--visible"), 3500);

    } catch (err) {
      console.error("[Pesaje] Error registrando pesaje:", err);
      errorBox.textContent = `Error guardando pesaje: ${err.message}`;
      errorBox.style.display = "block";
    }
  });
}
