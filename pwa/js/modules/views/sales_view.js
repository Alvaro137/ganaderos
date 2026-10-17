// modules/views/sales_view.js
/**
 * Vista de Liquidaciones de Venta y Canales (GANAVAEX).
 * Aplica el principio de profundidad progresiva:
 * Nivel 1: Resumen de KPIs y lista limpia de facturas de venta.
 * Nivel 2: Desglose completo de canales individuales (pesos, precios, importes y crotales vinculados).
 * Nivel 3: Acceso directo a la ficha del animal desde el canal liquidado.
 */

import {
  AppState,
  escapeHtml,
  extraer4Digitos,
  formatearFecha,
  formatearKg,
  formatearMoneda,
  registrarPasoHistorial,
  obtenerTextoBotonVolver
} from '../config.js';
import {
  obtenerLiquidaciones,
  obtenerDetalleLiquidacion,
  obtenerResumenKpisLiquidaciones,
  sincronizarBaseDatosAhora
} from '../db.js';
import { seleccionarAnimal } from './detail_view.js';

export function renderVistaLiquidaciones() {
  const container = document.getElementById("app-container");
  if (!container) return;

  AppState.tabActual = "ventas";
  AppState.crotalSeleccionado = null;
  AppState.corralSeleccionado = null;

  // Si hay una factura seleccionada, renderizar su vista de profundidad
  if (AppState.facturaSeleccionada) {
    verDetalleLiquidacion(AppState.facturaSeleccionada, false);
    return;
  }

  const kpis = obtenerResumenKpisLiquidaciones();
  const filtro = AppState.filtroLiquidaciones || "";
  const facturas = obtenerLiquidaciones(filtro);

  const html = `
    <div style="max-width: 960px; margin: 0 auto;">
      <!-- Cabecera con botón volver -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <button class="btn-volver" id="btn-volver-desde-ventas" title="Volver a la vista anterior">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>${escapeHtml(obtenerTextoBotonVolver())}</span>
            </button>
          </div>
          <h2 style="font-size: 1.45rem; font-weight: 800; color: var(--brand-primary); margin-top: 6px;">
            Liquidaciones de Venta y Canales
          </h2>
          <p style="font-size: 0.9rem; color: var(--text-muted); margin-top: 2px;">
            Rendimiento en matadero, canales pesadas y facturas de venta (GANAVAEX, S.COOP).
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="btn-action-small" id="btn-subir-factura-pdf" style="min-height: 44px; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; background: var(--brand-primary); color: #fff; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <span>Subir Factura PDF</span>
          </button>
          <input type="file" id="input-subir-pdf-factura" accept=".pdf,application/pdf" style="display: none;" />
        </div>
      </div>

      <!-- Tarjetas de KPIs principales (Material Design 3) -->
      <div class="kpis-liquidaciones-grid">
        <div class="kpi-card-tonal">
          <span class="kpi-label">Total Liquidado</span>
          <span class="kpi-val" style="color: var(--brand-primary);">${formatearMoneda(kpis.total_importe, 2)} €</span>
          <span class="kpi-sub">${kpis.total_facturas} facturas oficiales</span>
        </div>
        <div class="kpi-card-tonal">
          <span class="kpi-label">Canales Pesadas</span>
          <span class="kpi-val">${kpis.total_canales_pesadas}</span>
          <span class="kpi-sub">${formatearKg(kpis.total_kilos)} kg canal totales</span>
        </div>
        <div class="kpi-card-tonal">
          <span class="kpi-label">Peso Canal Medio</span>
          <span class="kpi-val" style="color: var(--md-secondary);">${kpis.peso_medio > 0 ? `${kpis.peso_medio} kg` : "N/D"}</span>
          <span class="kpi-sub">Cebo y desvieje</span>
        </div>
        <div class="kpi-card-tonal">
          <span class="kpi-label">Cotización Media</span>
          <span class="kpi-val" style="color: var(--md-tertiary, #785a00);">${kpis.precio_medio > 0 ? `${Number(kpis.precio_medio).toFixed(2)} €/kg` : "N/D"}</span>
          <span class="kpi-sub">Precio base canal</span>
        </div>
      </div>

      <!-- Buscador de facturas -->
      <div class="search-input-wrapper" style="margin: 20px 0 16px 0;">
        <input 
          type="text" 
          id="txt-busqueda-liquidaciones" 
          class="search-input" 
          placeholder="Buscar factura (ej. G015/3, 1/51), fecha o cooperativa..." 
          value="${escapeHtml(filtro)}"
          autocomplete="off"
          spellcheck="false"
        />
        ${filtro ? '<button class="btn-input-clear" id="btn-clear-liquidaciones">✕</button>' : ""}
      </div>

      <!-- Lista de Facturas -->
      <div class="list-meta" style="margin-bottom: 12px;">
        <span>Facturas oficiales de liquidación</span>
        <span>${facturas.length} ${facturas.length === 1 ? "factura" : "facturas"}</span>
      </div>

      <div class="liquidaciones-lista">
        ${
          facturas.length === 0
            ? `<div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-muted);">
                <p style="font-size: 1.1rem; font-weight: 700;">No se encontraron facturas</p>
                <p style="font-size: 0.85rem; margin-top: 4px;">Comprueba el término de búsqueda o importa nuevas liquidaciones en PDF.</p>
              </div>`
            : facturas
                .map((f) => {
                  const cabezas = f.total_cabezas != null ? `${f.total_cabezas} cabezas` : "Lote";
                  const kilos = f.total_kilos_canal != null && f.total_kilos_canal > 1 ? `${formatearKg(f.total_kilos_canal)} kg` : null;
                  return `
                    <div class="liquidacion-card" data-action="ver-factura" data-factura-id="${f.id}" style="cursor: pointer;">
                      <div class="card-header-row" style="margin-bottom: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <span class="badge-factura">Factura ${escapeHtml(f.numero_factura)}</span>
                          <span class="liquidacion-fecha">${formatearFecha(f.fecha_factura)}</span>
                        </div>
                        <span class="liquidacion-total">${formatearMoneda(f.total_factura)} €</span>
                      </div>

                      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px;">
                        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text-muted);">
                          <span class="chip-kpis-mini">🐄 ${escapeHtml(cabezas)}</span>
                          ${kilos ? `<span class="chip-kpis-mini">⚖️ ${escapeHtml(kilos)} canal</span>` : ""}
                          <span class="chip-kpis-mini">🏛️ ${escapeHtml(f.cliente_cooperativa || "GANAVAEX")}</span>
                        </div>
                        <button class="btn-profundizar btn-ver-canales" data-action="ver-factura" data-factura-id="${f.id}">
                          <span>Ver canales (${escapeHtml(f.total_cabezas != null ? String(f.total_cabezas) : "desglose")})</span>
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                          </svg>
                        </button>
                      </div>
                    </div>
                  `;
                })
                .join("")
        }
      </div>
    </div>
  `;

  container.innerHTML = html;
  adjuntarEventosLiquidaciones(container);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function verDetalleLiquidacion(facturaId, pushHistory = true) {
  const container = document.getElementById("app-container");
  if (!container) return;

  const factura = obtenerDetalleLiquidacion(facturaId);
  if (!factura) {
    console.warn(`[Ventas] Factura #${facturaId} no encontrada`);
    AppState.facturaSeleccionada = null;
    renderVistaLiquidaciones();
    return;
  }

  if (pushHistory) {
    registrarPasoHistorial("liquidaciones", facturaId, `Factura ${factura.numero_factura || facturaId}`, {
      numero_factura: factura.numero_factura
    });
  }
  AppState.facturaSeleccionada = facturaId;

  const canales = factura.canales || [];
  const gastos = factura.gastos || [];

  const html = `
    <div style="max-width: 960px; margin: 0 auto;">
      <!-- Botón Volver y migas -->
      <div style="margin-bottom: 16px;">
        <button class="btn-volver btn-volver-liq" id="btn-volver-a-liquidaciones" title="Volver a la lista de liquidaciones">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Volver a Liquidaciones</span>
        </button>
      </div>

      <!-- Ficha técnica de la Factura -->
      <div class="ficha-factura-header">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="badge-factura" style="font-size: 1rem; padding: 4px 10px;">Factura ${escapeHtml(factura.numero_factura)}</span>
              <span class="status-pill venta">Liquidada</span>
            </div>
            <h2 style="font-size: 1.35rem; font-weight: 800; color: var(--text-main); margin-top: 8px;">
              ${escapeHtml(factura.cliente_cooperativa || "GANAVAEX, S.COOP")}
            </h2>
            <div style="font-size: 0.84rem; color: var(--text-muted); margin-top: 3px;">
              CIF: ${escapeHtml(factura.cif_cliente || "F37335411")} • Emisión: ${escapeHtml(formatearFecha(factura.fecha_factura))} ${factura.fecha_pago ? `• Cobrada: ${escapeHtml(formatearFecha(factura.fecha_pago))}` : ""}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Total Factura</div>
            <div style="font-size: 1.6rem; font-weight: 900; color: var(--brand-primary);">${formatearMoneda(factura.total_factura)} €</div>
          </div>
        </div>

        <div class="factura-resumen-banda">
          <div><strong>${canales.length}</strong> canales liquidadas</div>
          ${factura.total_kilos_canal ? `<div><strong>${formatearKg(factura.total_kilos_canal)} kg</strong> peso canal</div>` : ""}
          <div>Base: <strong>${formatearMoneda(factura.base_imponible)} €</strong></div>
          <div>Compensación REAGP (${escapeHtml(String(factura.porcentaje_iva || 10.5))}%): <strong>+${formatearMoneda(factura.cuota_iva)} €</strong></div>
          ${factura.gastos_total ? `<div>Deducciones: <strong style="color: var(--md-error, #ba1a1a);">${formatearMoneda(factura.gastos_total)} €</strong></div>` : ""}
        </div>
      </div>

      <!-- Desglose de canales / animales individuales -->
      <div class="list-meta" style="margin-top: 24px; margin-bottom: 12px;">
        <span>Canales y Rendimiento Individual (${canales.length} animales)</span>
        <span>Pesos oficiales en báscula matadero</span>
      </div>

      <div class="canales-lista canales-table" style="display: flex; flex-direction: column; gap: 10px;">
        ${
          canales.length === 0
            ? '<p style="color: var(--text-muted); font-size: 0.9rem; padding: 12px;">No se registraron líneas de canal individuales para esta factura.</p>'
            : canales
                .map((c, i) => {
                  const tieneCrotal = !!c.crotal_asignado;
                  return `
                    <div class="canal-item-card">
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <span class="canal-linea-num">#${c.linea_numero || i + 1}</span>
                          <span style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">${escapeHtml(c.articulo || "TERNERO/A CEBO")}</span>
                        </div>
                        <span style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">${formatearMoneda(c.importe_linea)} €</span>
                      </div>

                      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 12px; font-size: 0.88rem; color: var(--text-muted);">
                          <span>Peso: <strong style="color: var(--brand-primary); font-size: 1rem;">${formatearKg(c.peso_canal_kg)} kg</strong></span>
                          <span>Precio: <strong>${c.precio_unitario != null ? `${Number(c.precio_unitario).toFixed(2)} €/kg` : "N/D"}</strong></span>
                        </div>

                        ${
                          tieneCrotal
                            ? `
                            <button class="clickable-chip chip-cria" data-action="select-animal" data-crotal="${escapeHtml(c.crotal_asignado)}" title="Ver historial y genealogía del animal">
                              <span style="font-weight: 800; font-size: 0.95rem; color: var(--brand-primary);">${escapeHtml(c.crotal_4 || extraer4Digitos(c.crotal_asignado))}</span>
                              <span style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(c.crotal_asignado)}</span>
                              <span class="chip-action">Ver ficha animal →</span>
                            </button>
                            `
                            : `<span style="font-size: 0.8rem; color: var(--text-dim); font-style: italic;">Lote de salida ${c.fecha_salida_lote ? escapeHtml(formatearFecha(c.fecha_salida_lote)) : ""}</span>`
                        }
                      </div>
                    </div>
                  `;
                })
                .join("")
        }
      </div>

      <!-- Deducciones de la liquidación -->
      ${
        gastos.length > 0
          ? `
          <div class="list-meta" style="margin-top: 24px; margin-bottom: 12px;">
            <span>Deducciones y Gastos Operativos</span>
            <span>Portes, cuota cooperativa y tramos</span>
          </div>
          <div class="gastos-card" style="background: var(--md-surface-container-lowest); border: 1px solid var(--md-outline-variant); border-radius: var(--md-shape-md); padding: 12px 16px;">
            ${gastos
              .map(
                (g) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--md-surface-container-high); font-size: 0.88rem;">
                <span style="color: var(--text-muted);">${escapeHtml(g.concepto)}</span>
                <span style="font-weight: 700; color: var(--md-error, #ba1a1a);">${formatearMoneda(g.importe)} €</span>
              </div>
            `
              )
              .join("")}
          </div>
          `
          : ""
      }
    </div>
  `;

  container.innerHTML = html;
  adjuntarEventosLiquidaciones(container);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function adjuntarEventosLiquidaciones(container) {
  if (!container) return;

  // Botón Volver
  const btnVolver = container.querySelector("#btn-volver-desde-ventas");
  if (btnVolver) {
    btnVolver.addEventListener("click", () => {
      if (AppState.historial.length > 0) {
        const anterior = AppState.historial.pop();
        if (anterior.tipo === "movimientos") {
          window.dispatchEvent(new CustomEvent("campo:navegar-tab", { detail: { tab: "movimientos" } }));
        } else if (anterior.tipo === "animal") {
          seleccionarAnimal(anterior.id, false);
        } else {
          window.dispatchEvent(new CustomEvent("campo:navegar-tab", { detail: { tab: "animales" } }));
        }
      } else {
        window.dispatchEvent(new CustomEvent("campo:navegar-tab", { detail: { tab: "movimientos" } }));
      }
    });
  }

  const btnVolverLiq = container.querySelector("#btn-volver-a-liquidaciones");
  if (btnVolverLiq) {
    btnVolverLiq.addEventListener("click", () => {
      if (AppState.historial.length > 0 && AppState.historial[AppState.historial.length - 1].tipo === "liquidaciones") {
        AppState.historial.pop();
      }
      AppState.facturaSeleccionada = null;
      renderVistaLiquidaciones();
    });
  }

  // Ver detalle de una factura
  container.querySelectorAll('[data-action="ver-factura"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const rawFid = el.dataset.facturaId;
      const fid = Number(rawFid);
      if (rawFid && !isNaN(fid) && fid > 0) {
        verDetalleLiquidacion(fid, true);
      }
    });
  });

  // Saltar a ficha de animal desde canal
  container.querySelectorAll('[data-action="select-animal"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const crotal = el.dataset.crotal;
      if (crotal) {
        if (AppState.facturaSeleccionada) {
          registrarPasoHistorial("liquidaciones", AppState.facturaSeleccionada, "Liquidaciones");
        }
        seleccionarAnimal(crotal, true);
      }
    });
  });

  // Buscador de facturas
  const txtBusqueda = container.querySelector("#txt-busqueda-liquidaciones");
  if (txtBusqueda) {
    txtBusqueda.addEventListener("input", (e) => {
      AppState.filtroLiquidaciones = e.target.value;
      renderVistaLiquidaciones();
    });
  }

  const btnClear = container.querySelector("#btn-clear-liquidaciones");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      AppState.filtroLiquidaciones = "";
      renderVistaLiquidaciones();
    });
  }

  // Subir factura PDF
  const btnSubirPdf = container.querySelector("#btn-subir-factura-pdf");
  const inputPdf = container.querySelector("#input-subir-pdf-factura");
  if (btnSubirPdf && inputPdf) {
    btnSubirPdf.addEventListener("click", () => inputPdf.click());
    inputPdf.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".pdf")) {
        alert("Por favor selecciona un archivo PDF válido.");
        inputPdf.value = "";
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        alert("El archivo excede el tamaño máximo permitido (10 MB).");
        inputPdf.value = "";
        return;
      }

      let toast = document.getElementById("pwa-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "pwa-toast";
        toast.className = "pwa-toast";
        document.body.appendChild(toast);
      }
      toast.textContent = `📄 Procesando factura ${file.name}...`;
      toast.style.backgroundColor = "var(--brand-primary)";
      toast.style.color = "#ffffff";
      toast.classList.add("pwa-toast--visible");

      const fd = new FormData();
      fd.append("file", file);

      try {
        const token = localStorage.getItem("campo_pwa_token") || "";
        const headers = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch("./api/ventas/ingest-pdf", {
          method: "POST",
          headers,
          body: fd,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Error del servidor (${res.status})`);
        }

        const data = await res.json();
        toast.textContent = `✓ Factura ${data.numero_factura} subida (${data.total_cabezas} canales). Actualizando...`;

        await sincronizarBaseDatosAhora(token).catch(() => {});
        setTimeout(() => {
          toast.classList.remove("pwa-toast--visible");
          renderVistaLiquidaciones();
        }, 1500);
      } catch (err) {
        console.error("[Ventas] Error subiendo factura PDF:", err);
        toast.textContent = `⚠️ Error subiendo factura: ${err.message}`;
        toast.style.backgroundColor = "var(--md-error, #ba1a1a)";
        setTimeout(() => toast.classList.remove("pwa-toast--visible"), 4000);
      } finally {
        inputPdf.value = "";
      }
    });
  }
}
