// modules/views/assistant_view.js
/**
 * Asistente de IA por Voz y Lenguaje Natural (Intent Calling local + síntesis en lenguaje natural).
 */

import { AppState, esPantallaEscritorio, escapeHtml, formatearFecha, formatearMoneda, formatearKg } from '../config.js';
import { obtenerAuthHeaders, mostrarPantallaLogin } from '../auth.js';
import { ejecutarConsulta } from '../db.js';
import { VoiceManager } from '../voice.js';
import { seleccionarAnimal, verDetalleCorral } from './detail_view.js';

export function setupAsistenteIA() {
  const btnOpenAi = document.getElementById("btn-open-ai");
  const btnCloseAi = document.getElementById("btn-close-ai");
  const modalBackdrop = document.getElementById("ai-modal-backdrop");
  const btnRecordVoice = document.getElementById("btn-record-voice");
  const voiceStatusText = document.getElementById("voice-status-text");
  const voiceWaveform = document.getElementById("voice-waveform");
  const inputAiPrompt = document.getElementById("txt-ai-prompt");
  const btnSendAi = document.getElementById("btn-send-ai");
  const resultsWrapper = document.getElementById("ai-results-wrapper");
  const bubbleResponse = document.getElementById("ai-bubble-response");
  const cardsContainer = document.getElementById("ai-cards-container");
  const selectAiModel = document.getElementById("select-ai-model");
  const btnClearHistory = document.getElementById("btn-clear-ai-history");
  const chipSuggestions = document.querySelectorAll(".ai-chip-suggestion");

  if (!btnOpenAi || !modalBackdrop) return;

  let ejecutandoConsulta = false;

  const voiceManager = new VoiceManager({
    onResult: (texto) => {
      if (inputAiPrompt) inputAiPrompt.value = texto;
      ejecutarConsultaIA(texto);
    },
    onStatus: (msg) => {
      if (voiceStatusText) voiceStatusText.textContent = msg;
    },
    onStateChange: (listening) => {
      if (btnRecordVoice) btnRecordVoice.classList.toggle("listening", listening);
    },
    onWaveform: (visible) => {
      if (voiceWaveform) voiceWaveform.style.display = visible ? "flex" : "none";
    }
  });

  function actualizarEstadoConectividad() {
    const online = navigator.onLine;
    if (voiceStatusText) {
      if (!online) {
        voiceStatusText.textContent = "📡 Sin conexión: el asistente por voz/IA requiere cobertura";
        voiceStatusText.style.color = "#ea580c";
      } else {
        voiceStatusText.textContent = "Toca el micrófono para hablar";
        voiceStatusText.style.color = "";
      }
    }
    if (btnRecordVoice) {
      btnRecordVoice.classList.toggle("disabled-offline", !online);
      btnRecordVoice.title = online ? "Dictar consulta por voz" : "La entrada por voz requiere conexión al servidor";
    }
  }

  window.addEventListener("online", actualizarEstadoConectividad);
  window.addEventListener("offline", actualizarEstadoConectividad);

  function abrirModal() {
    actualizarEstadoConectividad();
    modalBackdrop.style.display = "flex";
    if (esPantallaEscritorio() && inputAiPrompt) {
      setTimeout(() => inputAiPrompt.focus(), 150);
    }
  }

  function cerrarModal() {
    voiceManager.detener();
    modalBackdrop.style.display = "none";
  }

  function mostrarDegradacionGracil(motivo) {
    if (resultsWrapper) resultsWrapper.style.display = "block";
    if (bubbleResponse) {
      bubbleResponse.innerHTML = `
        <div class="ai-offline-graceful-box" style="background: var(--bg-surface); border: 1px solid #fed7aa; border-left: 4px solid #f97316; padding: 14px 16px; border-radius: var(--radius-md);">
          <div style="font-weight: 700; color: #c2410c; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
            <span>📡 Asistente Conectado (Cloud/Edge) sin Cobertura</span>
          </div>
          <p style="font-size: 0.88rem; color: var(--text-color); margin: 0 0 10px 0; line-height: 1.4;">
            ${escapeHtml(motivo || "El asistente por voz e inferencia en lenguaje natural requiere conexión con el servidor.")}
            <br>
            <strong>La gestión de censo, fichas de animales, corrales, genealogía y alertas sanitarias sigue disponible 100% offline</strong> mediante la base de datos local SQLite.
          </p>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn btn-secondary btn-sm" data-action="go-search" style="font-size: 0.82rem; padding: 6px 12px; border-radius: 6px; cursor: pointer; background: var(--bg-surface-subtle); border: 1px solid var(--border-color);">
              🔍 Ir al Buscador por Crotal
            </button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="go-corrales" style="font-size: 0.82rem; padding: 6px 12px; border-radius: 6px; cursor: pointer; background: var(--bg-surface-subtle); border: 1px solid var(--border-color);">
              📍 Ver Corrales de Pasto
            </button>
          </div>
        </div>
      `;

      const btnSearch = bubbleResponse.querySelector('[data-action="go-search"]');
      if (btnSearch) {
        btnSearch.addEventListener("click", () => {
          cerrarModal();
          const tabBtn = document.querySelector('.nav-link[data-tab="animales"]') || document.querySelector('.mobile-tab-btn[data-tab="animales"]');
          if (tabBtn) tabBtn.click();
          const searchInput = document.getElementById("search-crotal");
          if (searchInput) {
            setTimeout(() => {
              searchInput.focus();
              searchInput.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 100);
          }
        });
      }
      const btnCorrales = bubbleResponse.querySelector('[data-action="go-corrales"]');
      if (btnCorrales) {
        btnCorrales.addEventListener("click", () => {
          cerrarModal();
          const tabBtn = document.querySelector('.nav-link[data-tab="animales"]') || document.querySelector('.mobile-tab-btn[data-tab="animales"]');
          if (tabBtn) tabBtn.click();
          const corralesSec = document.getElementById("sec-corrales") || document.querySelector(".corrales-container");
          if (corralesSec) {
            corralesSec.scrollIntoView({ behavior: "smooth" });
          }
        });
      }
    }
    if (cardsContainer) cardsContainer.innerHTML = "";
  }

  btnOpenAi.addEventListener("click", abrirModal);
  if (btnCloseAi) btnCloseAi.addEventListener("click", cerrarModal);

  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) {
      cerrarModal();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalBackdrop.style.display === "flex") {
      cerrarModal();
    }
  });

  if (btnRecordVoice) {
    btnRecordVoice.addEventListener("click", () => {
      if (!navigator.onLine) {
        mostrarDegradacionGracil("La transcripción de voz requiere conexión al servidor de explotación. Puedes consultar el censo o fichas de animales directamente sin conexión.");
        return;
      }
      if (voiceManager.escuchandoVoz) {
        voiceManager.detener();
      } else {
        voiceManager.iniciar();
      }
    });
  }

  if (btnClearHistory) {
    btnClearHistory.addEventListener("click", () => {
      AppState.conversacionIA = [];
      if (resultsWrapper) resultsWrapper.style.display = "block";
      if (bubbleResponse) {
        bubbleResponse.innerHTML = `
          <div style="font-size: 0.9rem; color: #166534; display: flex; align-items: center; gap: 8px;">
            <span>🔄 Contexto conversacional reiniciado. Puedes preguntar por cualquier vaca, corral o consulta nueva.</span>
          </div>
        `;
      }
      if (cardsContainer) cardsContainer.innerHTML = "";
      if (inputAiPrompt) {
        inputAiPrompt.value = "";
        inputAiPrompt.focus();
      }
    });
  }

  async function cargarModelosSelector() {
    if (!selectAiModel) return;
    try {
      const resp = await fetch("./api/ai/models", {
        headers: obtenerAuthHeaders()
      });
      if (resp.status === 401) {
        localStorage.removeItem("campo_pwa_token");
        console.warn("[Asistente IA] Token no autenticado o expirado para el catálogo de modelos.");
        return;
      }
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.ok && Array.isArray(data.models) && data.models.length > 0) {
        const valorPrevio = localStorage.getItem("campo_ai_model_id") || "auto";
        selectAiModel.innerHTML = data.models
          .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
          .join("");
        if (Array.from(selectAiModel.options).some((o) => o.value === valorPrevio)) {
          selectAiModel.value = valorPrevio;
        }
      }
    } catch (e) {
      console.warn("Error cargando selector de modelos:", e);
    }
  }

  if (selectAiModel) {
    selectAiModel.addEventListener("change", () => {
      localStorage.setItem("campo_ai_model_id", selectAiModel.value);
    });
  }

  cargarModelosSelector();

  chipSuggestions.forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.dataset.prompt || chip.textContent.trim();
      if (inputAiPrompt) inputAiPrompt.value = prompt;
      ejecutarConsultaIA(prompt);
    });
  });

  if (btnSendAi) {
    btnSendAi.addEventListener("click", () => {
      const prompt = inputAiPrompt ? inputAiPrompt.value.trim() : "";
      if (prompt) ejecutarConsultaIA(prompt);
    });
  }

  if (inputAiPrompt) {
    inputAiPrompt.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const prompt = inputAiPrompt.value.trim();
        if (prompt) ejecutarConsultaIA(prompt);
      }
    });
  }

  async function ejecutarConsultaIA(prompt) {
    if (ejecutandoConsulta) return;
    voiceManager.detener();
    ejecutandoConsulta = true;

    if (!navigator.onLine) {
      mostrarDegradacionGracil("El asistente en lenguaje natural requiere conexión con el servidor de explotación.");
      ejecutandoConsulta = false;
      return;
    }

    if (resultsWrapper) resultsWrapper.style.display = "block";
    if (bubbleResponse) {
      bubbleResponse.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; color: var(--brand-primary); font-weight: 600;">
          <div class="spinner" style="width: 18px; height: 18px; border-width: 2px;"></div>
          <span>Consultando catálogo de la explotación...</span>
        </div>
      `;
    }
    if (cardsContainer) cardsContainer.innerHTML = "";

    let intentData = null;
    const modelId = selectAiModel ? selectAiModel.value : "auto";

    try {
      const authHdrs = obtenerAuthHeaders();
      const resp = await fetch("./api/ai/intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHdrs
        },
        body: JSON.stringify({
          prompt,
          historial: AppState.conversacionIA.slice(-6),
          model_id: modelId
        })
      });

      if (resp.status === 401) {
        localStorage.removeItem("campo_pwa_token");
        cerrarModal();
        mostrarPantallaLogin("Tu sesión ha caducado. Vuelve a introducir la contraseña de la explotación.");
        ejecutandoConsulta = false;
        return;
      }

      if (resp.ok) {
        const resJson = await resp.json();
        if (resJson.ok) {
          intentData = resJson;
        } else {
          mostrarDegradacionGracil(resJson.message || "El servidor no pudo procesar la consulta con el modelo de lenguaje.");
          ejecutandoConsulta = false;
          return;
        }
      } else {
        mostrarDegradacionGracil("El servicio de inteligencia artificial no está disponible actualmente en el servidor.");
        ejecutandoConsulta = false;
        return;
      }
    } catch (netErr) {
      mostrarDegradacionGracil("Fallo de red al contactar con el servidor. Verifica la cobertura de tu dispositivo.");
      ejecutandoConsulta = false;
      return;
    }

    if (!intentData) {
      mostrarDegradacionGracil("No se obtuvo respuesta del servicio de inteligencia artificial.");
      ejecutandoConsulta = false;
      return;
    }

    const { sql, params, interpretacion, respuesta_directa, tipo_resultado, offline_mode, modelo_usado } = intentData;

    if (!sql && respuesta_directa) {
      const htmlBubble = `
        <div style="font-size: 0.95rem; font-weight: 700; color: #0369a1; margin-bottom: 4px;">
          ${escapeHtml(interpretacion || "Información Técnica:")}
        </div>
        <div class="ai-directa-box">
          ${escapeHtml(respuesta_directa)}
        </div>
      `;
      if (bubbleResponse) bubbleResponse.innerHTML = htmlBubble;
      if (cardsContainer) cardsContainer.innerHTML = "";
      AppState.conversacionIA.push({ role: "user", content: prompt });
      AppState.conversacionIA.push({ role: "assistant", content: respuesta_directa });
      ejecutandoConsulta = false;
      return;
    }

    if (!sql) {
      if (bubbleResponse) {
        bubbleResponse.innerHTML = `<div style="color: var(--text-muted);">${escapeHtml(interpretacion || "No se ha generado consulta.")}</div>`;
      }
      ejecutandoConsulta = false;
      return;
    }

    let filas = [];
    try {
      filas = ejecutarConsulta(sql, params || []);
    } catch (sqlErr) {
      if (cardsContainer) {
        cardsContainer.innerHTML = `
          <div style="background: #fff1f2; border: 1px solid #ffe4e6; color: #be123c; padding: 12px; border-radius: var(--radius-md); font-size: 0.88rem;">
            <strong>Error al consultar la base local:</strong> ${escapeHtml(sqlErr.message)}
          </div>
        `;
      }
      ejecutandoConsulta = false;
      return;
    }

    const tieneHistorialPrevio = AppState.conversacionIA.length > 0;
    const historyBadge = tieneHistorialPrevio ? '<span class="ai-history-badge">En contexto</span>' : '';

    if (filas.length === 0) {
      const htmlBubble = `
        <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px; margin-bottom: 4px;">
          <div style="font-size: 1rem; font-weight: 700; color: #14532d; display: flex; align-items: center; gap: 6px;">
            <span>${escapeHtml(interpretacion || "Consulta realizada:")}</span>
            ${historyBadge}
          </div>
          ${modelo_usado ? `
            <span style="font-size: 0.72rem; color: #15803d; opacity: 0.85; background: rgba(255,255,255,0.7); padding: 2px 8px; border-radius: 9999px; border: 1px solid #bbf7d0; font-family: monospace;">
              ${escapeHtml(modelo_usado)}
            </span>
          ` : ""}
        </div>
        <details style="margin-top: 8px; font-size: 0.78rem; color: #15803d;">
          <summary style="cursor: pointer; font-weight: 600; opacity: 0.9;">Ver consulta SQL generada</summary>
          <pre style="background: rgba(255,255,255,0.7); border: 1px solid #bbf7d0; padding: 6px 10px; border-radius: 4px; margin-top: 6px; overflow-x: auto; font-family: monospace; color: #14532d;">${escapeHtml(sql)}</pre>
        </details>
      `;
      if (bubbleResponse) bubbleResponse.innerHTML = htmlBubble;

      if (cardsContainer) {
        cardsContainer.innerHTML = `
          <div style="text-align: center; padding: 25px 15px; color: var(--text-dim); background: var(--bg-surface-subtle); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
            <p style="font-weight: 600; font-size: 0.95rem; color: var(--text-muted); margin-bottom: 4px;">0 registros encontrados</p>
            <p style="font-size: 0.82rem;">No hay registros en el censo que cumplan esa condición.</p>
          </div>
        `;
      }
      AppState.conversacionIA.push({ role: "user", content: prompt });
      AppState.conversacionIA.push({ role: "assistant", content: `${interpretacion} (0 registros)` });
      ejecutandoConsulta = false;
      return;
    }

    renderResultadosIA(filas, tipo_resultado, cardsContainer, cerrarModal);

    const keys = Object.keys(filas[0]);
    const esAnaliticaOSeguimiento = tipo_resultado === "conteo" ||
                                    filas.length <= 15 ||
                                    keys.some(k => /total|count|suma|cantidad|destino|uso|precio|promedio/i.test(k)) ||
                                    tieneHistorialPrevio;

    const htmlBubble = `
      <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px; margin-bottom: 4px;">
        <div style="font-size: 1rem; font-weight: 700; color: #14532d; display: flex; align-items: center; gap: 6px;">
          <span>${escapeHtml(interpretacion || "Consulta realizada:")}</span>
          ${historyBadge}
        </div>
        ${modelo_usado ? `
          <span style="font-size: 0.72rem; color: #15803d; opacity: 0.85; background: rgba(255,255,255,0.7); padding: 2px 8px; border-radius: 9999px; border: 1px solid #bbf7d0; font-family: monospace;">
            ${escapeHtml(modelo_usado)}
          </span>
        ` : ""}
      </div>
      ${esAnaliticaOSeguimiento ? `
        <div id="ai-sintesis-loading" style="font-size: 0.85rem; color: #15803d; margin: 8px 0; display: flex; align-items: center; gap: 6px;">
          <div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
          <span>Sintetizando explicación ganadera...</span>
        </div>
      ` : ""}
      <details style="margin-top: 8px; font-size: 0.78rem; color: #15803d;">
        <summary style="cursor: pointer; font-weight: 600; opacity: 0.9;">Ver consulta SQL generada</summary>
        <pre style="background: rgba(255,255,255,0.7); border: 1px solid #bbf7d0; padding: 6px 10px; border-radius: 4px; margin-top: 6px; overflow-x: auto; font-family: monospace; color: #14532d;">${escapeHtml(sql)}</pre>
      </details>
    `;
    if (bubbleResponse) bubbleResponse.innerHTML = htmlBubble;

    let sintesisTexto = null;
    if (esAnaliticaOSeguimiento && navigator.onLine) {
      try {
        const authHdrs = obtenerAuthHeaders();
        const respSynth = await fetch("./api/ai/synthesize", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            ...authHdrs
          },
          body: JSON.stringify({
            prompt,
            data: filas.slice(0, 30),
            columns: keys,
            history: AppState.conversacionIA.slice(-4),
            model_id: modelId
          })
        });
        const dataSynth = await respSynth.json();
        if (respSynth.ok && dataSynth.ok && dataSynth.sintesis) {
          sintesisTexto = dataSynth.sintesis;
        }
      } catch (synthErr) {
        console.warn("No se pudo generar síntesis adicional:", synthErr);
      }

      const elLoading = document.getElementById("ai-sintesis-loading");
      if (elLoading) {
        if (sintesisTexto) {
          elLoading.outerHTML = `
            <div class="ai-sintesis-box">
              ${escapeHtml(sintesisTexto)}
            </div>
          `;
        } else {
          elLoading.remove();
        }
      }
    }

    AppState.conversacionIA.push({ role: "user", content: prompt });
    AppState.conversacionIA.push({
      role: "assistant",
      content: sintesisTexto || `${interpretacion} (${filas.length} registros)`
    });

    ejecutandoConsulta = false;
  }
}

export function renderResultadosIA(filas, tipoResultado, container, cerrarModal) {
  if (!container || filas.length === 0) return;
  const keys = Object.keys(filas[0]);

  // 1. Caso conteo escalar único
  if (filas.length === 1 && keys.length === 1 && /total|count|suma|cantidad|censo/i.test(keys[0])) {
    const val = filas[0][keys[0]];
    container.innerHTML = `
      <div class="ai-conteo-card">
        <div class="ai-conteo-num">${formatearMoneda(val, 0)}</div>
        <div class="ai-conteo-label">${escapeHtml(keys[0].replace(/_/g, " "))}</div>
      </div>
    `;
    return;
  }

  // 2. Caso Animales
  const esAnimales = tipoResultado === "animales" || keys.includes("crotal") || keys.includes("crotal_4");
  if (esAnimales) {
    container.innerHTML = `
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px;">
        ${filas.length} ${filas.length === 1 ? "cabeza encontrada" : "cabezas encontradas"} (Toca para ver ficha):
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${filas.map((a) => {
          const crotal = a.crotal || "";
          const crotal4 = a.crotal_4 || (crotal.length >= 4 ? crotal.slice(-4) : crotal);
          const esActivo = a.estado === "A";
          const estadoClase = esActivo ? "activo" : "baja";
          const estadoTexto = esActivo ? "Activo" : "Baja";
          const lote = a.corral ? a.corral.trim() : (a.lote || "Sin lote");
          const raza = a.raza || "";
          const fechaNac = a.fecha_nacimiento;
          const partosInfo = a.total_partos != null ? `${a.total_partos} partos` : "";
          const fechaUltParto = a.fecha_ult_parto;

          return `
            <div class="ai-clickable-animal" data-crotal="${escapeHtml(crotal)}">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <div style="display: flex; align-items: baseline; gap: 8px;">
                  <span class="crotal-4-digits" style="font-size: 1.25rem;">${escapeHtml(crotal4)}</span>
                  <span class="crotal-full-code" style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(crotal)}</span>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <span class="status-pill ${estadoClase}">${estadoTexto}</span>
                  <span class="chip-action" style="font-size: 0.8rem;">Ver ficha →</span>
                </div>
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.82rem; color: var(--text-muted);">
                <span>Lote: <strong style="color: var(--text-main);">${escapeHtml(lote)}</strong></span>
                ${raza ? `<span>Raza: <strong>${escapeHtml(raza)}</strong></span>` : ""}
                ${fechaNac ? `<span>Nac: <strong>${formatearFecha(fechaNac)}</strong></span>` : ""}
                ${partosInfo ? `<span>${escapeHtml(partosInfo)}</span>` : ""}
                ${fechaUltParto ? `<span>Últ. parto: <strong>${formatearFecha(fechaUltParto)}</strong></span>` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    container.querySelectorAll(".ai-clickable-animal").forEach((card) => {
      card.addEventListener("click", () => {
        const crotal = card.dataset.crotal;
        if (!crotal || crotal === "undefined" || crotal === "") return;
        cerrarModal();
        if (AppState.tabActual !== "animales") {
          const tabBtn = document.querySelector('.nav-link[data-tab="animales"]') || document.querySelector('.mobile-tab-btn[data-tab="animales"]');
          if (tabBtn) tabBtn.click();
        }
        seleccionarAnimal(crotal, true);
      });
    });
    return;
  }

  // 3. Caso Compras de Alimento
  const esCompras = tipoResultado === "compras" || keys.includes("alimento") || keys.includes("precio_kg");
  if (esCompras) {
    container.innerHTML = `
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px;">
        ${filas.length} compras encontradas:
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${filas.map((c) => {
          const tieneImporte = c.importe > 0;
          const tieneKg = c.kg > 0;
          const precioKg = c.precio_kg > 0 ? c.precio_kg : (tieneImporte && tieneKg ? c.importe / c.kg : 0);
          const txtPrecio = precioKg > 0 ? `${formatearMoneda(precioKg, 4)} €/kg` : (c.proveedor === "ELABORACION PROPIA" ? "Propio" : "—");

          return `
            <article class="compra-card" style="margin: 0; padding: 12px 14px;">
              <div class="compra-header" style="margin-bottom: 6px;">
                <div class="compra-alimento-nombre" style="font-size: 0.95rem;">${escapeHtml(c.alimento || "Alimento")}</div>
                <span class="compra-date">${formatearFecha(c.fecha)}</span>
              </div>
              <div class="compra-specs-grid" style="gap: 8px; margin-bottom: 8px;">
                <div>
                  <div class="compra-metric-label">Kilos</div>
                  <div class="compra-metric-val" style="font-size: 0.95rem;">${formatearKg(c.kg)} kg</div>
                </div>
                <div>
                  <div class="compra-metric-label">Precio / kg</div>
                  <div class="compra-metric-val precio-unitario" style="font-size: 0.95rem;">${txtPrecio}</div>
                </div>
                <div>
                  <div class="compra-metric-label">Importe</div>
                  <div class="compra-metric-val" style="font-size: 0.95rem;">${tieneImporte ? `${formatearMoneda(c.importe, 2)} €` : "—"}</div>
                </div>
              </div>
              <div class="compra-footer" style="padding-top: 6px; font-size: 0.78rem;">
                <div>Proveedor: <strong>${escapeHtml(c.proveedor || "-")}</strong></div>
                ${c.albaran ? `<div>Albarán: ${escapeHtml(c.albaran)}</div>` : ""}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
    return;
  }

  // 4. Caso Recetas Veterinarias
  const esRecetas = tipoResultado === "recetas" || keys.includes("medicamento") || keys.includes("receta");
  if (esRecetas) {
    container.innerHTML = `
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px;">
        ${filas.length} tratamientos / recetas:
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${filas.map((r) => {
          return `
            <article class="receta-card" style="margin: 0; padding: 12px 14px;">
              <div class="receta-header" style="margin-bottom: 6px;">
                <div class="receta-med-nombre" style="font-size: 0.95rem;">${escapeHtml(r.medicamento || "Tratamiento")}</div>
                <span class="receta-date">${formatearFecha(r.fecha)}</span>
              </div>
              <div class="receta-specs-grid" style="gap: 8px; margin-bottom: 8px;">
                <div>
                  <div class="receta-metric-label">Receta Nº</div>
                  <div class="receta-metric-val" style="font-size: 0.9rem;">${escapeHtml(r.receta || "-")}</div>
                </div>
                <div>
                  <div class="receta-metric-label">Animales</div>
                  <div class="receta-metric-val" style="font-size: 0.9rem;">${r.n_animales ? `${r.n_animales} cabezas` : "1 cabeza"}</div>
                </div>
                <div>
                  <div class="receta-metric-label">Veterinario</div>
                  <div class="receta-metric-val" style="font-size: 0.85rem;">${escapeHtml(r.veterinario || "-")}</div>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
    return;
  }

  // 5. Tabla genérica para otras consultas
  container.innerHTML = `
    <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px;">
      ${filas.length} registros:
    </div>
    <div style="overflow-x: auto; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
      <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
        <thead>
          <tr style="background: var(--bg-surface-subtle); border-bottom: 1px solid var(--border-color);">
            ${keys.map((k) => `<th style="padding: 10px 12px; font-weight: 700; color: var(--text-muted);">${escapeHtml(k.replace(/_/g, " "))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${filas.map((fila, idx) => `
            <tr style="border-bottom: 1px solid var(--border-color); background: ${idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)'};">
              ${keys.map((k) => {
                const val = fila[k];
                if (k.toLowerCase().includes("corral") || k.toLowerCase().includes("lote")) {
                  return `
                    <td style="padding: 10px 12px;">
                      <button class="clickable-chip chip-corral" data-action="view-corral-ai" data-corral="${escapeHtml(val)}">
                        ${escapeHtml(val || "Sin lote")}
                      </button>
                    </td>
                  `;
                }
                return `<td style="padding: 10px 12px;">${val != null ? escapeHtml(val) : "—"}</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  container.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="view-corral-ai"]');
    if (btn && btn.dataset.corral) {
      cerrarModal();
      if (AppState.tabActual !== "animales") {
        const tabBtn = document.querySelector('.nav-link[data-tab="animales"]') || document.querySelector('.mobile-tab-btn[data-tab="animales"]');
        if (tabBtn) tabBtn.click();
      }
      verDetalleCorral(btn.dataset.corral, true);
    }
  });
}
