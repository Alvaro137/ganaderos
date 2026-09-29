// modules/views/birth_modal.js
/**
 * Modal táctil optimizado para campo: Registro de Partos y Nacimientos.
 * Permite registrar nacimientos 100% offline con persistencia Outbox y UI optimista.
 */

import { escapeHtml, extraer4Digitos } from '../config.js';
import { buscarAnimales, registrarPartoOptimista } from '../db.js';
import { guardarMutacionLocal, sincronizarOutboxConServidor } from '../outbox.js';
import { obtenerUsuarioActual } from '../auth.js';

let modalContainer = null;
let seleccionMadreActual = null;
let sexoSeleccionado = "H"; // Default Hembra

function obtenerModalContainer() {
  let modal = document.getElementById("modal-registro-parto");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-registro-parto";
    modal.className = "modal-overlay";
    modal.style.display = "none";
    document.body.appendChild(modal);
  }
  return modal;
}

export function abrirModalRegistroParto({ madreCrotal = "", madre4 = "", madreRaza = "" } = {}) {
  const modal = obtenerModalContainer();
  sexoSeleccionado = "H";
  
  if (madreCrotal) {
    seleccionMadreActual = {
      crotal: madreCrotal,
      crotal_4: madre4 || extraer4Digitos(madreCrotal),
      raza: madreRaza || "Cruzado"
    };
  } else {
    seleccionMadreActual = null;
  }

  const hoyStr = new Date().toISOString().split("T")[0];

  const html = `
    <div class="modal-dialog birth-modal-dialog" style="max-width: 480px; width: 92%; margin: 20px auto; background: var(--bg-surface, #ffffff); border-radius: var(--radius-lg, 16px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
      
      <!-- Cabecera -->
      <div style="background: var(--brand-primary, #1e3a2b); color: #ffffff; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">🐮</span>
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #ffffff;">Registrar Parto</h3>
            <span style="font-size: 0.78rem; opacity: 0.85;">Captura directa en campo (Offline)</span>
          </div>
        </div>
        <button id="btn-cerrar-modal-parto" aria-label="Cerrar modal" style="background: rgba(255,255,255,0.15); border: none; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">
          ✕
        </button>
      </div>

      <!-- Formulario -->
      <form id="form-registro-parto" style="padding: 20px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; max-height: 80vh;">
        
        <!-- Selección de Madre -->
        <div>
          <label style="display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dim, #555); margin-bottom: 6px; text-transform: uppercase;">
            Vaca Madre <span style="color: #dc2626;">*</span>
          </label>
          
          <div id="contenedor-madre-seleccionada" style="${seleccionMadreActual ? 'display: block;' : 'display: none;'}">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #e8f5e9; border: 1px solid #c8e6c9; border-radius: 8px;">
              <div>
                <span id="label-madre-4" style="font-size: 1.2rem; font-weight: 800; color: #1b5e20;">${seleccionMadreActual ? escapeHtml(seleccionMadreActual.crotal_4) : ''}</span>
                <span id="label-madre-full" style="font-size: 0.82rem; color: #2e7d32; margin-left: 8px;">(${seleccionMadreActual ? escapeHtml(seleccionMadreActual.crotal) : ''})</span>
              </div>
              ${!madreCrotal ? `
                <button type="button" id="btn-cambiar-madre" style="background: none; border: none; color: #c62828; font-size: 0.82rem; font-weight: 600; cursor: pointer; text-decoration: underline;">
                  Cambiar
                </button>
              ` : ''}
            </div>
          </div>

          <div id="contenedor-busqueda-madre" style="${seleccionMadreActual ? 'display: none;' : 'display: block;'} position: relative;">
            <input 
              type="text" 
              id="input-buscar-madre" 
              placeholder="Escribe 4 dígitos o crotal..." 
              autocomplete="off"
              style="width: 100%; height: 48px; padding: 0 12px; font-size: 1rem; border: 1px solid var(--border-color, #ccc); border-radius: 8px; box-sizing: border-box;"
            />
            <div id="dropdown-sugerencias-madre" style="display: none; position: absolute; top: 52px; left: 0; right: 0; background: #fff; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-height: 200px; overflow-y: auto; z-index: 100;"></div>
          </div>
        </div>

        <!-- Fecha del Parto -->
        <div>
          <label for="input-fecha-parto" style="display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dim, #555); margin-bottom: 6px; text-transform: uppercase;">
            Fecha del Parto <span style="color: #dc2626;">*</span>
          </label>
          <input 
            type="date" 
            id="input-fecha-parto" 
            value="${hoyStr}" 
            required 
            style="width: 100%; height: 48px; padding: 0 12px; font-size: 1rem; border: 1px solid var(--border-color, #ccc); border-radius: 8px; box-sizing: border-box; background: var(--input-bg, #fff);"
          />
        </div>

        <!-- Sexo de la Cría (Touch targets gigantes de ≥48px) -->
        <div>
          <label style="display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dim, #555); margin-bottom: 6px; text-transform: uppercase;">
            Sexo de la Cría <span style="color: #dc2626;">*</span>
          </label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <button 
              type="button" 
              id="btn-sexo-h" 
              class="btn-toggle-sexo active" 
              style="height: 52px; border-radius: 8px; border: 2px solid #1e3a2b; background: #1e3a2b; color: #fff; font-size: 1.05rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.15s ease;">
              <span>♀ Hembra (H)</span>
            </button>
            <button 
              type="button" 
              id="btn-sexo-m" 
              class="btn-toggle-sexo" 
              style="height: 52px; border-radius: 8px; border: 2px solid #ccc; background: #f9f9f9; color: #333; font-size: 1.05rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.15s ease;">
              <span>♂ Macho (M)</span>
            </button>
          </div>
        </div>

        <!-- Raza de la Cría -->
        <div>
          <label for="select-raza-cria" style="display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dim, #555); margin-bottom: 6px; text-transform: uppercase;">
            Raza
          </label>
          <select 
            id="select-raza-cria" 
            style="width: 100%; height: 48px; padding: 0 12px; font-size: 1rem; border: 1px solid var(--border-color, #ccc); border-radius: 8px; box-sizing: border-box; background: var(--input-bg, #fff);">
            <option value="Cruzado" ${seleccionMadreActual && seleccionMadreActual.raza === 'Cruzado' ? 'selected' : ''}>Cruzado (Carne)</option>
            <option value="Limusín" ${seleccionMadreActual && seleccionMadreActual.raza.includes('Limus') ? 'selected' : ''}>Limusín</option>
            <option value="Charolés" ${seleccionMadreActual && seleccionMadreActual.raza.includes('Charol') ? 'selected' : ''}>Charolés</option>
            <option value="Morucho" ${seleccionMadreActual && seleccionMadreActual.raza.includes('Moruch') ? 'selected' : ''}>Morucho</option>
            <option value="Retinto" ${seleccionMadreActual && seleccionMadreActual.raza.includes('Retint') ? 'selected' : ''}>Retinto</option>
            <option value="Avileña" ${seleccionMadreActual && seleccionMadreActual.raza.includes('Avile') ? 'selected' : ''}>Avileña</option>
            <option value="Berrendo" ${seleccionMadreActual && seleccionMadreActual.raza.includes('Berrend') ? 'selected' : ''}>Berrendo</option>
            <option value="Otro">Otro</option>
          </select>
        </div>

        <!-- Crotal de la Cría (Opcional) -->
        <div>
          <label for="input-cria-crotal" style="display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dim, #555); margin-bottom: 6px; text-transform: uppercase;">
            Crotal Cría <span style="font-weight: 400; text-transform: none; color: #888;">(Opcional)</span>
          </label>
          <input 
            type="text" 
            id="input-cria-crotal" 
            placeholder="Ej: C-${seleccionMadreActual ? seleccionMadreActual.crotal_4 : '1045'} o crotal oficial" 
            style="width: 100%; height: 48px; padding: 0 12px; font-size: 1rem; border: 1px solid var(--border-color, #ccc); border-radius: 8px; box-sizing: border-box;"
          />
          <span style="font-size: 0.75rem; color: #777; margin-top: 4px; display: block;">
            Si se indica crotal, la cría se añade de inmediato al censo activo.
          </span>
        </div>

        <!-- Incidencias u Observaciones -->
        <div>
          <label for="input-incidencias" style="display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dim, #555); margin-bottom: 6px; text-transform: uppercase;">
            Incidencias / Notas de campo <span style="font-weight: 400; text-transform: none; color: #888;">(Opcional)</span>
          </label>
          <input 
            type="text" 
            id="input-incidencias" 
            placeholder="Ej: Parto asistido, ternero fuerte, etc." 
            style="width: 100%; height: 48px; padding: 0 12px; font-size: 0.95rem; border: 1px solid var(--border-color, #ccc); border-radius: 8px; box-sizing: border-box;"
          />
        </div>

        <!-- Botones de Acción -->
        <div style="display: flex; gap: 12px; margin-top: 8px;">
          <button 
            type="button" 
            id="btn-cancelar-parto" 
            style="flex: 1; height: 50px; border-radius: 8px; border: 1px solid #ccc; background: #f3f4f6; color: #374151; font-weight: 600; cursor: pointer;">
            Cancelar
          </button>
          
          <button 
            type="submit" 
            id="btn-guardar-parto" 
            style="flex: 2; height: 50px; border-radius: 8px; border: none; background: #10b981; color: #ffffff; font-size: 1.05rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 6px rgba(16,185,129,0.3);">
            <span>💾 Guardar Parto</span>
          </button>
        </div>

      </form>
    </div>
  `;

  modal.innerHTML = html;
  modal.style.display = "flex";

  // Event Listeners
  setupEventListeners(modal);
}

function setupEventListeners(modal) {
  const cerrar = () => {
    modal.style.display = "none";
    modal.innerHTML = "";
  };

  const btnCerrar = modal.querySelector("#btn-cerrar-modal-parto");
  const btnCancelar = modal.querySelector("#btn-cancelar-parto");
  if (btnCerrar) btnCerrar.addEventListener("click", cerrar);
  if (btnCancelar) btnCancelar.addEventListener("click", cerrar);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrar();
  });

  // Toggle Sexo
  const btnSexoH = modal.querySelector("#btn-sexo-h");
  const btnSexoM = modal.querySelector("#btn-sexo-m");

  btnSexoH.addEventListener("click", () => {
    sexoSeleccionado = "H";
    btnSexoH.style.background = "#1e3a2b";
    btnSexoH.style.borderColor = "#1e3a2b";
    btnSexoH.style.color = "#fff";

    btnSexoM.style.background = "#f9f9f9";
    btnSexoM.style.borderColor = "#ccc";
    btnSexoM.style.color = "#333";
  });

  btnSexoM.addEventListener("click", () => {
    sexoSeleccionado = "M";
    btnSexoM.style.background = "#1e3a2b";
    btnSexoM.style.borderColor = "#1e3a2b";
    btnSexoM.style.color = "#fff";

    btnSexoH.style.background = "#f9f9f9";
    btnSexoH.style.borderColor = "#ccc";
    btnSexoH.style.color = "#333";
  });

  // Búsqueda de madre
  const inputBuscar = modal.querySelector("#input-buscar-madre");
  const dropdown = modal.querySelector("#dropdown-sugerencias-madre");
  const contMadreSel = modal.querySelector("#contenedor-madre-seleccionada");
  const contBusqueda = modal.querySelector("#contenedor-busqueda-madre");
  const labelMadre4 = modal.querySelector("#label-madre-4");
  const labelMadreFull = modal.querySelector("#label-madre-full");
  const btnCambiarMadre = modal.querySelector("#btn-cambiar-madre");

  if (btnCambiarMadre) {
    btnCambiarMadre.addEventListener("click", () => {
      seleccionMadreActual = null;
      contMadreSel.style.display = "none";
      contBusqueda.style.display = "block";
      if (inputBuscar) {
        inputBuscar.value = "";
        inputBuscar.focus();
      }
    });
  }

  if (inputBuscar && dropdown) {
    let debounceTimer;
    inputBuscar.addEventListener("input", (e) => {
      clearTimeout(debounceTimer);
      const query = e.target.value.trim();
      if (!query || query.length < 1) {
        dropdown.style.display = "none";
        dropdown.innerHTML = "";
        return;
      }

      debounceTimer = setTimeout(() => {
        // Buscar solo hembras activas (Vaca, Hembras, H)
        const candidatos = buscarAnimales(query, true, 8).filter((a) => {
          if (!a.sexo) return true;
          const s = String(a.sexo).trim().toUpperCase();
          return s === "H" || s.startsWith("HEMB") || s.startsWith("VAC");
        });
        if (candidatos.length === 0) {
          dropdown.innerHTML = '<div style="padding: 12px; color: #888; font-size: 0.88rem;">No se encontraron vacas activas</div>';
          dropdown.style.display = "block";
          return;
        }

        dropdown.innerHTML = candidatos
          .map((c) => `
            <div class="opcion-madre" data-crotal="${escapeHtml(c.crotal)}" data-c4="${escapeHtml(c.crotal_4)}" data-raza="${escapeHtml(c.raza || '')}" style="padding: 10px 14px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: #1b5e20; font-size: 1.05rem;">${escapeHtml(c.crotal_4)}</strong>
                <span style="font-size: 0.8rem; color: #666; margin-left: 6px;">${escapeHtml(c.crotal)}</span>
              </div>
              <span style="font-size: 0.78rem; color: #777;">${escapeHtml(c.raza || '')} (${c.corral || 'S/L'})</span>
            </div>
          `)
          .join("");
        dropdown.style.display = "block";

        dropdown.querySelectorAll(".opcion-madre").forEach((el) => {
          el.addEventListener("click", () => {
            seleccionMadreActual = {
              crotal: el.dataset.crotal,
              crotal_4: el.dataset.c4,
              raza: el.dataset.raza
            };
            labelMadre4.textContent = seleccionMadreActual.crotal_4;
            labelMadreFull.textContent = `(${seleccionMadreActual.crotal})`;
            contBusqueda.style.display = "none";
            contMadreSel.style.display = "block";
            dropdown.style.display = "none";

            // Sugerir prefijo de crotal de cría
            const inputCria = modal.querySelector("#input-cria-crotal");
            if (inputCria && !inputCria.value) {
              inputCria.placeholder = `Ej: C-${seleccionMadreActual.crotal_4}`;
            }
          });
        });
      }, 150);
    });
  }

  // Enviar formulario
  const form = modal.querySelector("#form-registro-parto");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!seleccionMadreActual || !seleccionMadreActual.crotal) {
      alert("Por favor selecciona la vaca madre antes de guardar.");
      return;
    }

    const fechaParto = modal.querySelector("#input-fecha-parto").value;
    const criaRaza = modal.querySelector("#select-raza-cria").value;
    const criaCrotal = modal.querySelector("#input-cria-crotal").value.trim();
    const incidencias = modal.querySelector("#input-incidencias").value.trim();
    const btnGuardar = modal.querySelector("#btn-guardar-parto");

    btnGuardar.disabled = true;
    btnGuardar.textContent = "Guardando...";

    try {
      const operador = obtenerUsuarioActual();
      const operadorId = operador ? operador.id : "usr_admin";

      const payloadParto = {
        fecha_parto: fechaParto,
        cria_crotal: criaCrotal || null,
        cria_sexo: sexoSeleccionado,
        cria_raza: criaRaza,
        incidencias: incidencias || null
      };

      // 1. Guardar en Outbox (IndexedDB)
      await guardarMutacionLocal({
        tipo: "parto",
        crotal: seleccionMadreActual.crotal,
        payload: payloadParto,
        operador: operadorId
      });

      // 2. Aplicar mutación optimista en SQLite WASM local
      await registrarPartoOptimista({
        madre_crotal: seleccionMadreActual.crotal,
        fecha_parto: fechaParto,
        cria_crotal: criaCrotal,
        cria_sexo: sexoSeleccionado,
        cria_raza: criaRaza,
        incidencias: incidencias
      });

      // Cerrar modal
      cerrar();

      // Feedback toast
      const toastMsg = criaCrotal 
        ? `✅ Parto registrado: Cría ${criaCrotal} añadida al censo`
        : `✅ Parto registrado para la vaca ${seleccionMadreActual.crotal_4}`;
      
      dispararToast(toastMsg);

      // 3. Intento de sincronización silenciosa en background si hay red
      if (typeof navigator !== "undefined" && navigator.onLine) {
        sincronizarOutboxConServidor().catch((e) => {
          console.warn("[Outbox] Sincronización en segundo plano pendiente:", e);
        });
      }

    } catch (err) {
      console.error("[Parto] Error al registrar parto:", err);
      alert(`Error guardando el parto: ${err.message}`);
      btnGuardar.disabled = false;
      btnGuardar.textContent = "💾 Guardar Parto";
    }
  });
}

function dispararToast(msg) {
  let toast = document.getElementById("pwa-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "pwa-toast";
    toast.style.position = "fixed";
    toast.style.bottom = "80px";
    toast.style.left = "50%";
    toast.style.transform = "translateX(-50%)";
    toast.style.backgroundColor = "#1b5e20";
    toast.style.color = "#ffffff";
    toast.style.padding = "12px 20px";
    toast.style.borderRadius = "8px";
    toast.style.fontSize = "0.9rem";
    toast.style.fontWeight = "700";
    toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
    toast.style.zIndex = "99999";
    toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0)";
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(10px)";
  }, 3500);
}
