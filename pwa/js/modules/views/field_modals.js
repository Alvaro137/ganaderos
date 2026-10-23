// modules/views/field_modals.js
/**
 * Modales de Acción Rápida de Campo para Ganaderos Campo.
 * Diseñados para registrar con una sola mano en manga o dehesa:
 * - Traspasos y Movimientos entre cercados/fincas
 * - Registro de Bajas y Muertes en campo
 * 100% Offline-First con persistencia en Outbox.
 */

import { escapeHtml, extraer4Digitos, dispararToast } from '../config.js';
import { guardarMutacionLocal, sincronizarOutboxConServidor } from '../outbox.js';

let modalContainer = null;

function obtenerContenedorModal(id) {
  let modal = document.getElementById(id);
  if (!modal) {
    modal = document.createElement("div");
    modal.id = id;
    modal.className = "modal-overlay";
    modal.style.display = "none";
    document.body.appendChild(modal);
  }
  return modal;
}

/**
 * MODAL: REGISTRAR MOVIMIENTO O TRASPASO
 */
export function abrirModalRegistroMovimiento({ crotal = "", origenDefault = "121", destinoDefault = "122" } = {}) {
  const modal = obtenerContenedorModal("modal-registro-movimiento");
  const hoyStr = new Date().toISOString().split("T")[0];
  const crotal4 = crotal ? extraer4Digitos(crotal) : "";

  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 480px; width: 92%; margin: 16px auto; max-height: 90vh; background: var(--bg-surface, #ffffff); border-radius: var(--radius-lg, 16px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
      
      <!-- Cabecera -->
      <div style="background: var(--brand-primary, #1e3a2b); color: #ffffff; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">🚚</span>
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #ffffff;">Registrar Movimiento</h3>
            <span style="font-size: 0.78rem; opacity: 0.85;">Traspasos entre cercados, cebadero o salidas</span>
          </div>
        </div>
        <button id="btn-cerrar-modal-movimiento" aria-label="Cerrar modal" style="background: rgba(255,255,255,0.15); border: none; color: #ffffff; min-width: 44px; min-height: 44px; width: 44px; height: 44px; border-radius: 50%; font-size: 1.3rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">
          ✕
        </button>
      </div>

      <!-- Formulario -->
      <form id="form-registro-movimiento" style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; margin: 0;">
        <div style="padding: 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; flex: 1;">
          
          <div id="mov-feedback-error" style="display: none; background: #fee2e2; border-left: 4px solid #dc2626; color: #991b1b; padding: 10px 14px; border-radius: 6px; font-size: 0.88rem;"></div>

          <!-- Crotal -->
          <div>
            <label style="display: block; font-size: 0.85rem; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">
              Crotal del Animal *
            </label>
            <input 
              type="text" 
              id="mov-input-crotal" 
              placeholder="Ej. 4820 o ES081008454820" 
              value="${escapeHtml(crotal || crotal4)}" 
              required
              style="width: 100%; height: 46px; padding: 0 12px; font-size: 1.05rem; font-weight: 700; border: 2px solid var(--border-color, #cbd5e1); border-radius: var(--radius-sm, 8px); box-sizing: border-box;"
            />
          </div>

          <!-- Tipo de Movimiento -->
          <div>
            <label style="display: block; font-size: 0.85rem; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">
              Tipo de Movimiento *
            </label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <button type="button" class="btn-tipo-mov-select active" data-tipo="TRASPASO_CEBADERO" data-origen="121" data-destino="122" style="padding: 10px; border-radius: 8px; border: 2px solid var(--brand-primary, #1e3a2b); background: var(--md-primary-container, #e8f5e9); color: var(--brand-primary, #1e3a2b); font-size: 0.82rem; font-weight: 700; cursor: pointer;">
                🐂 Dehesa ➔ Cebo (122)
              </button>
              <button type="button" class="btn-tipo-mov-select" data-tipo="MOVIMIENTO_INTERNO" data-origen="121" data-destino="121" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: transparent; color: var(--text-main); font-size: 0.82rem; font-weight: 600; cursor: pointer;">
                🔁 Cambio de Cercado
              </button>
              <button type="button" class="btn-tipo-mov-select" data-tipo="VENTA" data-origen="122" data-destino="EXTERNO" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: transparent; color: var(--text-main); font-size: 0.82rem; font-weight: 600; cursor: pointer;">
                💰 Salida / Venta
              </button>
              <button type="button" class="btn-tipo-mov-select" data-tipo="OTRO" data-origen="" data-destino="" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: transparent; color: var(--text-main); font-size: 0.82rem; font-weight: 600; cursor: pointer;">
                📦 Otro Traslado
              </button>
            </div>
          </div>

          <!-- Origen y Destino -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Origen</label>
              <input type="text" id="mov-input-origen" value="${escapeHtml(origenDefault)}" style="width: 100%; height: 40px; padding: 0 10px; font-size: 0.9rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Destino</label>
              <input type="text" id="mov-input-destino" value="${escapeHtml(destinoDefault)}" style="width: 100%; height: 40px; padding: 0 10px; font-size: 0.9rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box;" />
            </div>
          </div>

          <!-- Fecha -->
          <div>
            <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Fecha</label>
            <input type="date" id="mov-input-fecha" value="${hoyStr}" style="width: 100%; height: 40px; padding: 0 10px; font-size: 0.9rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box;" />
          </div>

          <!-- Notas -->
          <div>
            <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Notas / Corral (Opcional)</label>
            <input type="text" id="mov-input-notas" placeholder="Ej. Corral de entrada, lote 3..." style="width: 100%; height: 40px; padding: 0 10px; font-size: 0.9rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box;" />
          </div>

        </div>

        <!-- Sticky Footer con botón gigante de guardar -->
        <div style="padding: 14px 20px; border-top: 1px solid var(--border-color); background: var(--bg-surface); flex-shrink: 0;">
          <button type="submit" id="btn-guardar-movimiento" style="width: 100%; height: 48px; border: none; border-radius: var(--radius-sm, 8px); background: var(--brand-primary, #1e3a2b); color: #ffffff; font-size: 1rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <span>Guardar Movimiento</span>
          </button>
        </div>
      </form>
    </div>
  `;

  modal.style.display = "flex";

  // Event Listeners
  const cerrar = () => { modal.style.display = "none"; };
  modal.querySelector("#btn-cerrar-modal-movimiento")?.addEventListener("click", cerrar);
  modal.addEventListener("click", (e) => { if (e.target === modal) cerrar(); });

  let tipoSeleccionado = "TRASPASO_CEBADERO";
  modal.querySelectorAll(".btn-tipo-mov-select").forEach(btn => {
    btn.addEventListener("click", () => {
      modal.querySelectorAll(".btn-tipo-mov-select").forEach(b => {
        b.style.border = "1px solid var(--border-color)";
        b.style.background = "transparent";
        b.style.color = "var(--text-main)";
        b.classList.remove("active");
      });
      btn.style.border = "2px solid var(--brand-primary, #1e3a2b)";
      btn.style.background = "var(--md-primary-container, #e8f5e9)";
      btn.style.color = "var(--brand-primary, #1e3a2b)";
      btn.classList.add("active");
      tipoSeleccionado = btn.dataset.tipo;

      if (btn.dataset.origen !== undefined && btn.dataset.origen !== "") {
        modal.querySelector("#mov-input-origen").value = btn.dataset.origen;
      }
      if (btn.dataset.destino !== undefined && btn.dataset.destino !== "") {
        modal.querySelector("#mov-input-destino").value = btn.dataset.destino;
      }
    });
  });

  const form = modal.querySelector("#form-registro-movimiento");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const crotalVal = modal.querySelector("#mov-input-crotal")?.value.trim();
    const origenVal = modal.querySelector("#mov-input-origen")?.value.trim();
    const destinoVal = modal.querySelector("#mov-input-destino")?.value.trim();
    const fechaVal = modal.querySelector("#mov-input-fecha")?.value || hoyStr;
    const notasVal = modal.querySelector("#mov-input-notas")?.value.trim();

    if (!crotalVal) {
      const errBox = modal.querySelector("#mov-feedback-error");
      errBox.textContent = "Por favor indica el crotal o los 4 dígitos del animal.";
      errBox.style.display = "block";
      return;
    }

    try {
      await guardarMutacionLocal({
        tipo: "movimiento",
        crotal: crotalVal,
        payload: {
          tipo_movimiento: tipoSeleccionado,
          origen: origenVal,
          destino: destinoVal,
          fecha: fechaVal,
          notas: notasVal
        }
      });

      dispararToast(`✅ Movimiento registrado para ${crotalVal}`);
      cerrar();
      sincronizarOutboxConServidor().catch(() => {});
      window.dispatchEvent(new CustomEvent("campo:db-updated"));
    } catch (err) {
      const errBox = modal.querySelector("#mov-feedback-error");
      errBox.textContent = "Error guardando movimiento: " + (err.message || err);
      errBox.style.display = "block";
    }
  });
}

/**
 * MODAL: REGISTRAR BAJA O MUERTE EN CAMPO
 */
export function abrirModalRegistroBaja({ crotal = "" } = {}) {
  const modal = obtenerContenedorModal("modal-registro-baja");
  const hoyStr = new Date().toISOString().split("T")[0];
  const crotal4 = crotal ? extraer4Digitos(crotal) : "";

  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 480px; width: 92%; margin: 16px auto; max-height: 90vh; background: var(--bg-surface, #ffffff); border-radius: var(--radius-lg, 16px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
      
      <!-- Cabecera -->
      <div style="background: #991b1b; color: #ffffff; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">☠️</span>
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #ffffff;">Registrar Baja en Campo</h3>
            <span style="font-size: 0.78rem; opacity: 0.85;">Muerte o baja zootécnica de un animal</span>
          </div>
        </div>
        <button id="btn-cerrar-modal-baja" aria-label="Cerrar modal" style="background: rgba(255,255,255,0.15); border: none; color: #ffffff; min-width: 44px; min-height: 44px; width: 44px; height: 44px; border-radius: 50%; font-size: 1.3rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">
          ✕
        </button>
      </div>

      <!-- Formulario -->
      <form id="form-registro-baja" style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; margin: 0;">
        <div style="padding: 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; flex: 1;">
          
          <div id="baja-feedback-error" style="display: none; background: #fee2e2; border-left: 4px solid #dc2626; color: #991b1b; padding: 10px 14px; border-radius: 6px; font-size: 0.88rem;"></div>

          <!-- Crotal -->
          <div>
            <label style="display: block; font-size: 0.85rem; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">
              Crotal del Animal *
            </label>
            <input 
              type="text" 
              id="baja-input-crotal" 
              placeholder="Ej. 4820 o ES081008454820" 
              value="${escapeHtml(crotal || crotal4)}" 
              required
              style="width: 100%; height: 46px; padding: 0 12px; font-size: 1.05rem; font-weight: 700; border: 2px solid var(--border-color, #cbd5e1); border-radius: var(--radius-sm, 8px); box-sizing: border-box;"
            />
          </div>

          <!-- Causa de la Baja -->
          <div>
            <label style="display: block; font-size: 0.85rem; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">
              Causa de la Baja
            </label>
            <select id="baja-select-causa" style="width: 100%; height: 44px; padding: 0 10px; font-size: 0.95rem; font-weight: 600; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-surface); color: var(--text-main);">
              <option value="Muerte natural / Enfermedad">Muerte natural / Enfermedad</option>
              <option value="Accidente / Traumatismo">Accidente / Traumatismo</option>
              <option value="Sacrificio de urgencia">Sacrificio de urgencia</option>
              <option value="Muerte perinatal / Celo / Parto">Muerte perinatal / Parto</option>
              <option value="Causa desconocida">Causa desconocida</option>
            </select>
          </div>

          <!-- Fecha -->
          <div>
            <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Fecha de la Baja</label>
            <input type="date" id="baja-input-fecha" value="${hoyStr}" style="width: 100%; height: 40px; padding: 0 10px; font-size: 0.9rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box;" />
          </div>

          <!-- Notas -->
          <div>
            <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Observaciones / Veterinario</label>
            <input type="text" id="baja-input-notas" placeholder="Ej. Certificado de retirada, parte de seguro..." style="width: 100%; height: 40px; padding: 0 10px; font-size: 0.9rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box;" />
          </div>

        </div>

        <!-- Sticky Footer con botón rojo -->
        <div style="padding: 14px 20px; border-top: 1px solid var(--border-color); background: var(--bg-surface); flex-shrink: 0;">
          <button type="submit" id="btn-guardar-baja" style="width: 100%; height: 48px; border: none; border-radius: var(--radius-sm, 8px); background: #dc2626; color: #ffffff; font-size: 1rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <span>Confirmar y Guardar Baja</span>
          </button>
        </div>
      </form>
    </div>
  `;

  modal.style.display = "flex";

  const cerrar = () => { modal.style.display = "none"; };
  modal.querySelector("#btn-cerrar-modal-baja")?.addEventListener("click", cerrar);
  modal.addEventListener("click", (e) => { if (e.target === modal) cerrar(); });

  const form = modal.querySelector("#form-registro-baja");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const crotalVal = modal.querySelector("#baja-input-crotal")?.value.trim();
    const causaVal = modal.querySelector("#baja-select-causa")?.value;
    const fechaVal = modal.querySelector("#baja-input-fecha")?.value || hoyStr;
    const notasVal = modal.querySelector("#baja-input-notas")?.value.trim();

    if (!crotalVal) {
      const errBox = modal.querySelector("#baja-feedback-error");
      errBox.textContent = "Por favor indica el crotal o los 4 dígitos del animal.";
      errBox.style.display = "block";
      return;
    }

    try {
      await guardarMutacionLocal({
        tipo: "baja",
        crotal: crotalVal,
        payload: {
          causa: causaVal,
          fecha: fechaVal,
          notas: notasVal
        }
      });

      dispararToast(`✅ Baja registrada para ${crotalVal}`);
      cerrar();
      sincronizarOutboxConServidor().catch(() => {});
      window.dispatchEvent(new CustomEvent("campo:db-updated"));
    } catch (err) {
      const errBox = modal.querySelector("#baja-feedback-error");
      errBox.textContent = "Error guardando baja: " + (err.message || err);
      errBox.style.display = "block";
    }
  });
}
