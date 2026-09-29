// modules/outbox.js
/**
 * Motor Local-First Outbox para Ganaderos Campo.
 * Gestiona la persistencia de mutaciones realizadas sin conexión
 * en IndexedDB y su sincronización atómica con el hub (Orange Pi).
 */

import { escapeHtml, extraer4Digitos } from './config.js';

const OUTBOX_IDB_CONFIG = {
  name: "GanaderosMutacionesOffline",
  version: 1,
  store: "mutaciones"
};

export const TIPOS_MUTACION_PERMITIDOS = [
  "parto",
  "cambio_corral",
  "tratamiento",
  "nota",
  "pesaje",
  "otro"
];

// Almacén en memoria de respaldo para Node.js / pruebas unitarias o si IDB no está disponible
let memoriaStore = [];

function generarUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function obtenerDeviceId() {
  if (typeof window === "undefined" || !window.localStorage) {
    return "dev-node-test";
  }
  let id = localStorage.getItem("campo_pwa_device_id");
  if (!id) {
    id = "dev-" + generarUUID().replace(/-/g, "").slice(0, 12);
    localStorage.setItem("campo_pwa_device_id", id);
  }
  return id;
}

function abrirOutboxDB(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      resolve(null);
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.warn("[Outbox] Timeout abriendo IndexedDB (" + timeoutMs + "ms).");
      resolve(null);
    }, timeoutMs);

    try {
      const req = window.indexedDB.open(OUTBOX_IDB_CONFIG.name, OUTBOX_IDB_CONFIG.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OUTBOX_IDB_CONFIG.store)) {
          const store = db.createObjectStore(OUTBOX_IDB_CONFIG.store, { keyPath: "uuid" });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("created_at", "created_at", { unique: false });
        }
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        if (!timedOut) resolve(req.result);
      };
      req.onerror = () => {
        clearTimeout(timer);
        console.warn("[Outbox] Error abriendo IndexedDB:", req.error);
        if (!timedOut) resolve(null);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        console.warn("[Outbox] Apertura bloqueada.");
        if (!timedOut) resolve(null);
      };
    } catch (e) {
      clearTimeout(timer);
      console.warn("[Outbox] Excepción al abrir IndexedDB:", e);
      resolve(null);
    }
  });
}

function dispararEventoOutbox(detalle = {}) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("campo:outbox-updated", { detail: detalle }));
  }
}

/**
 * Guarda una nueva mutación en la cola de salida local (Outbox).
 */
export async function guardarMutacionLocal({ tipo, crotal = null, payload = {}, operador = "usr_admin" }) {
  const tipoLimpio = String(tipo || "").trim().toLowerCase();
  if (!TIPOS_MUTACION_PERMITIDOS.includes(tipoLimpio)) {
    throw new Error(`Tipo de mutación no permitido: ${tipo}`);
  }

  const mutacion = {
    uuid: generarUUID(),
    tipo: tipoLimpio,
    crotal: crotal ? String(crotal).trim() : null,
    operador: String(operador || "usr_admin"),
    device_id: obtenerDeviceId(),
    ts_dispositivo: new Date().toISOString(),
    payload: payload || {},
    status: "pending", // 'pending' | 'syncing' | 'synced' | 'error'
    created_at: Date.now()
  };

  const idb = await abrirOutboxDB();
  if (!idb) {
    memoriaStore.push(mutacion);
    dispararEventoOutbox({ mutacion, pendientes: contarMutacionesPendientesSync() });
    return mutacion;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = idb.transaction(OUTBOX_IDB_CONFIG.store, "readwrite");
      tx.objectStore(OUTBOX_IDB_CONFIG.store).put(mutacion);
      tx.oncomplete = () => {
        idb.close();
        dispararEventoOutbox({ mutacion });
        resolve(mutacion);
      };
      tx.onerror = () => {
        idb.close();
        memoriaStore.push(mutacion);
        resolve(mutacion);
      };
    } catch (err) {
      idb.close();
      memoriaStore.push(mutacion);
      resolve(mutacion);
    }
  });
}

/**
 * Obtiene todas las mutaciones pendientes de envío al servidor.
 */
export async function obtenerMutacionesPendientes() {
  const idb = await abrirOutboxDB();
  if (!idb) {
    return memoriaStore.filter((m) => m.status === "pending" || m.status === "error");
  }

  return new Promise((resolve) => {
    try {
      const tx = idb.transaction(OUTBOX_IDB_CONFIG.store, "readonly");
      const store = tx.objectStore(OUTBOX_IDB_CONFIG.store);
      const req = store.getAll();
      req.onsuccess = () => {
        idb.close();
        const todos = req.result || [];
        const pendientes = todos.filter((m) => m.status === "pending" || m.status === "error");
        resolve(pendientes);
      };
      req.onerror = () => {
        idb.close();
        resolve(memoriaStore.filter((m) => m.status === "pending" || m.status === "error"));
      };
    } catch (e) {
      idb.close();
      resolve(memoriaStore.filter((m) => m.status === "pending" || m.status === "error"));
    }
  });
}

/**
 * Cuenta las mutaciones pendientes de forma asíncrona.
 */
export async function contarMutacionesPendientes() {
  const pendientes = await obtenerMutacionesPendientes();
  return pendientes.length;
}

/**
 * Versión sincrónica sobre memoria (para tests o fallbacks).
 */
export function contarMutacionesPendientesSync() {
  return memoriaStore.filter((m) => m.status === "pending" || m.status === "error").length;
}

/**
 * Obtiene el historial completo de mutaciones (pendientes y sincronizadas).
 */
export async function obtenerHistorialMutaciones(limite = 50) {
  const idb = await abrirOutboxDB();
  if (!idb) {
    return [...memoriaStore]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limite);
  }

  return new Promise((resolve) => {
    try {
      const tx = idb.transaction(OUTBOX_IDB_CONFIG.store, "readonly");
      const store = tx.objectStore(OUTBOX_IDB_CONFIG.store);
      const req = store.getAll();
      req.onsuccess = () => {
        idb.close();
        const todos = (req.result || []).sort((a, b) => b.created_at - a.created_at);
        resolve(todos.slice(0, limite));
      };
      req.onerror = () => {
        idb.close();
        resolve([...memoriaStore].sort((a, b) => b.created_at - a.created_at).slice(0, limite));
      };
    } catch (e) {
      idb.close();
      resolve([]);
    }
  });
}

/**
 * Marca una lista de UUIDs como sincronizados con éxito.
 */
export async function marcarMutacionesComoSincronizadas(uuids = []) {
  if (!uuids || uuids.length === 0) return;
  const setUuids = new Set(uuids);

  // Actualizar en memoria
  for (const m of memoriaStore) {
    if (setUuids.has(m.uuid)) {
      m.status = "synced";
      m.synced_at = new Date().toISOString();
    }
  }

  const idb = await abrirOutboxDB();
  if (!idb) {
    dispararEventoOutbox({ sincronizadas: uuids });
    return;
  }

  return new Promise((resolve) => {
    try {
      const tx = idb.transaction(OUTBOX_IDB_CONFIG.store, "readwrite");
      const store = tx.objectStore(OUTBOX_IDB_CONFIG.store);
      for (const uuid of uuids) {
        const getReq = store.get(uuid);
        getReq.onsuccess = () => {
          if (getReq.result) {
            const item = getReq.result;
            item.status = "synced";
            item.synced_at = new Date().toISOString();
            store.put(item);
          }
        };
      }
      tx.oncomplete = () => {
        idb.close();
        dispararEventoOutbox({ sincronizadas: uuids });
        resolve();
      };
      tx.onerror = () => {
        idb.close();
        resolve();
      };
    } catch (e) {
      idb.close();
      resolve();
    }
  });
}

/**
 * Envía todas las mutaciones pendientes al servidor (Orange Pi) mediante POST /api/sync/push.
 */
export async function sincronizarOutboxConServidor(authToken = null) {
  const pendientes = await obtenerMutacionesPendientes();
  if (!pendientes || pendientes.length === 0) {
    return { ok: true, enviadas: 0, duplicados: 0, mensaje: "No hay cambios pendientes." };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: false, error: "Sin conexión a internet (modo offline)." };
  }

  const token = authToken || (typeof localStorage !== "undefined" ? localStorage.getItem("campo_pwa_token") : "") || "";
  const changes = pendientes.map((m) => ({
    uuid: m.uuid,
    tipo: m.tipo,
    crotal: m.crotal,
    ts_dispositivo: m.ts_dispositivo,
    payload: m.payload
  }));

  const payloadPush = {
    device_id: obtenerDeviceId(),
    changes: changes
  };

  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["X-Auth-Token"] = token;
    }

    const resp = await fetch("./api/sync/push", {
      method: "POST",
      headers,
      body: JSON.stringify(payloadPush)
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      return { ok: false, error: `Error del servidor (${resp.status}): ${errTxt}` };
    }

    const resJson = await resp.json();
    const aceptados = resJson.aceptados || [];
    const duplicados = resJson.duplicados || [];

    await marcarMutacionesComoSincronizadas(aceptados);

    return {
      ok: true,
      enviadas: aceptados.length,
      duplicados: duplicados.length,
      epoch: resJson.epoch,
      mensaje: resJson.message || `${aceptados.length} cambio(s) sincronizado(s).`
    };
  } catch (err) {
    return { ok: false, error: err.message || "Fallo en la comunicación de sincronización." };
  }
}

/**
 * Resetea el almacén en memoria (para suites de testing).
 */
export function _resetMemoriaStoreParaTests() {
  memoriaStore = [];
}

/**
 * Actualiza el indicador visual de sincronización en la barra superior.
 */
export async function actualizarBadgeSync() {
  if (typeof document === "undefined") return;
  const btnSync = document.getElementById("btn-sync-badge");
  const txtBadge = document.getElementById("sync-badge-text");
  if (!btnSync) return;

  const token = typeof localStorage !== "undefined" ? localStorage.getItem("campo_pwa_token") : null;
  if (!token) {
    btnSync.style.display = "none";
    return;
  }

  btnSync.style.display = "inline-flex";
  const numPendientes = await contarMutacionesPendientes();

  if (numPendientes === 0) {
    btnSync.className = "header-sync-btn synced";
    if (txtBadge) txtBadge.textContent = "Al día";
    btnSync.title = "Sincronización: Al día (0 cambios pendientes)";
  } else {
    btnSync.className = "header-sync-btn pending";
    if (txtBadge) txtBadge.textContent = `${numPendientes} pend.`;
    btnSync.title = `Sincronización: ${numPendientes} cambio(s) pendiente(s) de enviar`;
  }
}

/**
 * Muestra el modal con la cola de mutaciones del Outbox y botón de sincronización forzada.
 */
export async function mostrarModalOutbox() {
  if (typeof document === "undefined") return;
  let modal = document.getElementById("modal-outbox");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-outbox";
    modal.className = "modal-overlay";
    document.body.appendChild(modal);
  }

  const pendientes = await obtenerMutacionesPendientes();
  const historial = await obtenerHistorialMutaciones(20);
  const numPend = pendientes.length;

  const html = `
    <div class="modal-dialog outbox-modal-dialog" style="max-width: 520px; width: 92%; margin: 20px auto; background: var(--bg-surface, #ffffff); border-radius: var(--radius-lg, 16px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
      
      <!-- Cabecera -->
      <div style="background: var(--brand-primary, #1e3a2b); color: #ffffff; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.4rem;">📤</span>
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #ffffff;">Registros de Campo (Outbox)</h3>
            <span style="font-size: 0.78rem; opacity: 0.85;">${numPend === 0 ? 'Todos los cambios sincronizados' : `${numPend} cambio(s) pendiente(s) de envío`}</span>
          </div>
        </div>
        <button id="btn-cerrar-modal-outbox" aria-label="Cerrar modal" style="background: rgba(255,255,255,0.15); border: none; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">
          ✕
        </button>
      </div>

      <div style="padding: 20px; overflow-y: auto; max-height: 75vh; display: flex; flex-direction: column; gap: 16px;">
        
        <!-- Estado y Botón Sincronizar -->
        <div style="padding: 14px; background: ${numPend > 0 ? '#fffbeb' : '#f0fdf4'}; border: 1px solid ${numPend > 0 ? '#fde68a' : '#bbf7d0'}; border-radius: 10px; display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 700; color: ${numPend > 0 ? '#b45309' : '#15803d'}; font-size: 0.92rem;">
              ${numPend > 0 ? `🟡 Hay ${numPend} cambio(s) esperando conexión` : '🟢 Base de datos al día con el servidor'}
            </span>
          </div>

          <button id="btn-sincronizar-outbox-ahora" style="width: 100%; height: 46px; border-radius: 8px; border: none; background: #10b981; color: #ffffff; font-size: 0.95rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 4px rgba(16,185,129,0.3);">
            <span>🔄 Sincronizar Cambios Ahora</span>
          </button>
          <div id="outbox-sync-feedback" style="display: none; font-size: 0.82rem; text-align: center;"></div>
        </div>

        <!-- Lista de Cambios -->
        <div>
          <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim, #666); text-transform: uppercase; margin-bottom: 8px;">
            Cola de mutaciones locales (${historial.length})
          </div>

          ${historial.length === 0 ? `
            <p style="color: var(--text-muted, #888); font-size: 0.88rem; text-align: center; padding: 20px 0;">
              No hay registros de campo en este dispositivo.
            </p>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${historial.map((m) => {
                const esPend = m.status === 'pending' || m.status === 'error';
                const icono = m.tipo === 'parto' ? '🐮' : m.tipo === 'cambio_corral' ? '🔁' : m.tipo === 'tratamiento' ? '💊' : '📝';
                const tituloTipo = m.tipo === 'parto' ? 'Parto / Nacimiento' : m.tipo === 'cambio_corral' ? 'Cambio de Lote' : m.tipo === 'tratamiento' ? 'Tratamiento' : m.tipo;
                const crotalLabel = m.crotal ? `Vaca ${extraer4Digitos(m.crotal)}` : 'Sin crotal';
                const fechaFormat = new Date(m.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

                return `
                  <div style="padding: 10px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                      <span style="font-size: 1.25rem;">${icono}</span>
                      <div>
                        <div style="font-weight: 700; font-size: 0.9rem; color: #111827;">${tituloTipo} • <span style="color: #1b5e20;">${crotalLabel}</span></div>
                        <div style="font-size: 0.78rem; color: #6b7280;">Por ${escapeHtml(m.operador || 'admin')} • ${fechaFormat}</div>
                      </div>
                    </div>
                    <div>
                      ${esPend 
                        ? '<span style="font-size: 0.75rem; font-weight: 700; background: #fef3c7; color: #b45309; padding: 4px 8px; border-radius: 9999px;">Pendiente</span>'
                        : '<span style="font-size: 0.75rem; font-weight: 700; background: #dcfce7; color: #15803d; padding: 4px 8px; border-radius: 9999px;">Sincronizado</span>'
                      }
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

      </div>
    </div>
  `;

  modal.innerHTML = html;
  modal.style.display = "flex";

  const cerrar = () => {
    modal.style.display = "none";
    modal.innerHTML = "";
  };

  const btnCerrar = modal.querySelector("#btn-cerrar-modal-outbox");
  if (btnCerrar) btnCerrar.addEventListener("click", cerrar);

  const btnSync = modal.querySelector("#btn-sincronizar-outbox-ahora");
  const feedback = modal.querySelector("#outbox-sync-feedback");

  if (btnSync) {
    btnSync.addEventListener("click", async () => {
      btnSync.disabled = true;
      btnSync.textContent = "Sincronizando con el servidor...";
      feedback.style.display = "block";
      feedback.style.color = "#4b5563";
      feedback.textContent = "1/2 Enviando registros de campo pendientes...";

      try {
        const resPush = await sincronizarOutboxConServidor();
        if (!resPush.ok) {
          throw new Error(resPush.error || "Error al enviar cambios");
        }

        feedback.textContent = `2/2 Cambios integrados (${resPush.enviadas}). Descargando censo consolidado...`;
        
        // Importar dinámicamente db.js para evitar ciclo y sincronizar censo
        const { sincronizarBaseDatosAhora } = await import('./db.js');
        await sincronizarBaseDatosAhora();

        feedback.style.color = "#15803d";
        feedback.textContent = "✅ ¡Sincronización completa con éxito!";
        btnSync.textContent = "Completado";

        setTimeout(() => {
          cerrar();
        }, 1200);

      } catch (err) {
        feedback.style.color = "#dc2626";
        feedback.textContent = `❌ ${err.message}`;
        btnSync.disabled = false;
        btnSync.textContent = "🔄 Reintentar Sincronización";
      }
    });
  }
}

