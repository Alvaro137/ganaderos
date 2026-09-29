// modules/views/detail_view.js
/**
 * Vista detallada de Ficha de Animal (con árbol genealógico, partos y supresión)
 * y Detalle de Corral / Lote con navegación histórica interconectada.
 */

import {
  AppState,
  formatearFecha,
  formatearExplotacionAmigable,
  calcularEdad,
  calcularTiempoTranscurrido,
  extraer4Digitos,
  esPantallaEscritorio,
  escapeHtml,
  registrarPasoHistorial,
  obtenerTextoBotonVolver
} from '../config.js';
import { obtenerDetalleAnimal, obtenerAnimalesDeLote } from '../db.js';
import { renderVistaAnimales } from './cattle_view.js';
import { abrirModalRegistroParto } from './birth_modal.js';

function adjuntarEventosDetalle(contenedor) {
  if (!contenedor) return;
  contenedor.querySelectorAll('[data-action="back"]').forEach((btn) => {
    btn.addEventListener("click", () => volverAtras());
  });
  contenedor.querySelectorAll('[data-action="select-animal"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const crotal = btn.dataset.crotal;
      if (crotal) seleccionarAnimal(crotal, true);
    });
  });
  contenedor.querySelectorAll('[data-action="view-corral"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const corral = btn.dataset.corral;
      if (corral) verDetalleCorral(corral, true);
    });
  });
  contenedor.querySelectorAll('[data-action="registrar-parto"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const crotal = btn.getAttribute("data-madre-crotal") || btn.dataset.madreCrotal;
      const c4 = btn.getAttribute("data-madre-4") || btn.dataset.madre4;
      const raza = btn.getAttribute("data-madre-raza") || btn.dataset.madreRaza;
      abrirModalRegistroParto({ madreCrotal: crotal, madre4: c4, madreRaza: raza });
    });
  });
}

export function seleccionarAnimal(crotal, pushHistory = true) {
  if (!crotal) return;

  const animal = obtenerDetalleAnimal(crotal);
  if (!animal) {
    alert(`El animal con crotal ${crotal} no se encuentra en la base de datos.`);
    return;
  }

  if (pushHistory) {
    if (AppState.crotalSeleccionado && AppState.crotalSeleccionado !== crotal) {
      const prevAnimal = obtenerDetalleAnimal(AppState.crotalSeleccionado);
      registrarPasoHistorial("animal", AppState.crotalSeleccionado, `Vaca ${prevAnimal ? prevAnimal.crotal_4 : ""}`, {
        crotal_4: prevAnimal ? prevAnimal.crotal_4 : ""
      });
    } else if (AppState.corralSeleccionado) {
      registrarPasoHistorial("corral", AppState.corralSeleccionado, `Lote ${AppState.corralSeleccionado}`);
    } else {
      registrarPasoHistorial("buscar", null, "Búsqueda");
    }
  }

  AppState.crotalSeleccionado = crotal;
  AppState.corralSeleccionado = null;

  document.querySelectorAll(".animal-card").forEach((c) => {
    c.classList.toggle("selected", c.dataset.crotal === crotal);
  });

  const htmlFicha = generarHtmlDetalleAnimal(animal);

  if (esPantallaEscritorio()) {
    const rightPanel = document.getElementById("detail-panel");
    if (rightPanel) {
      rightPanel.innerHTML = htmlFicha;
      adjuntarEventosDetalle(rightPanel);
    }
  } else {
    const container = document.getElementById("app-container");
    if (container) {
      container.innerHTML = htmlFicha;
      adjuntarEventosDetalle(container);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
}

export function verDetalleCorral(nombreLote, pushHistory = true) {
  if (!nombreLote) return;

  if (pushHistory) {
    if (AppState.crotalSeleccionado) {
      const prevAnimal = obtenerDetalleAnimal(AppState.crotalSeleccionado);
      registrarPasoHistorial("animal", AppState.crotalSeleccionado, `Vaca ${prevAnimal ? prevAnimal.crotal_4 : ""}`, {
        crotal_4: prevAnimal ? prevAnimal.crotal_4 : ""
      });
    } else {
      registrarPasoHistorial("buscar", null, "Búsqueda");
    }
  }

  AppState.corralSeleccionado = nombreLote;
  const textoVolver = obtenerTextoBotonVolver();
  const animalesLote = obtenerAnimalesDeLote(nombreLote);

  const htmlCorral = `
    <div class="detail-card">
      <button class="btn-back-link" data-action="back">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        <span>${escapeHtml(textoVolver)}</span>
      </button>

      <div class="corral-header-card">
        <div class="corral-header-row">
          <div>
            <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em;">Censo del Lote</div>
            <div class="corral-title">${escapeHtml(nombreLote)}</div>
          </div>
          <div class="corral-badge-count">
            ${animalesLote.length} vacas activas
          </div>
        </div>
      </div>

      <div class="list-meta" style="margin-top: 18px;">
        <span>Animales en ${escapeHtml(nombreLote)} (Toca para ver ficha)</span>
        <span>${animalesLote.length} cabezas</span>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;">
        ${animalesLote
          .map(
            (a) => `
          <div class="animal-card" data-action="select-animal" data-crotal="${escapeHtml(a.crotal)}" style="cursor: pointer;">
            <div class="card-header-row">
              <span class="crotal-4-digits">${escapeHtml(a.crotal_4)}</span>
              <span class="status-pill activo">Activo</span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
              ${escapeHtml(a.raza || "")} • ${calcularEdad(a.fecha_nacimiento)}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 0.8rem; color: var(--text-dim);">
              <span>${escapeHtml(a.crotal)}</span>
              <span>${a.total_partos > 0 ? `${a.total_partos} partos` : "0 partos"}</span>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;

  if (esPantallaEscritorio()) {
    const rightPanel = document.getElementById("detail-panel");
    if (rightPanel) {
      rightPanel.innerHTML = htmlCorral;
      adjuntarEventosDetalle(rightPanel);
    }
  } else {
    const container = document.getElementById("app-container");
    if (container) {
      container.innerHTML = htmlCorral;
      adjuntarEventosDetalle(container);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
}

export function volverAtras() {
  if (AppState.historial.length === 0) {
    AppState.crotalSeleccionado = null;
    AppState.corralSeleccionado = null;
    renderVistaAnimales();
    return;
  }

  const anterior = AppState.historial.pop();
  if (anterior.tipo === "buscar") {
    AppState.crotalSeleccionado = null;
    AppState.corralSeleccionado = null;
    renderVistaAnimales();
  } else if (anterior.tipo === "animal") {
    seleccionarAnimal(anterior.id, false);
  } else if (anterior.tipo === "corral") {
    verDetalleCorral(anterior.id, false);
  }
}

export function generarHtmlDetalleAnimal(animal) {
  const esActivo = animal.estado === "A";
  const estadoClase = esActivo ? "activo" : "baja";
  const estadoTexto = esActivo ? "Activo" : "Baja";
  const textoVolver = obtenerTextoBotonVolver();

  // Detección de redundancia en Alta vs Nacimiento:
  // Si nació en la propia finca, fecha_alta coincide con fecha_nacimiento (redundante).
  // Solo se muestra 'Alta' si la vaca entró con posterioridad (compra o traspaso externo).
  const tieneAltaDiferente = animal.fecha_alta &&
    String(animal.fecha_alta).trim() !== "" &&
    String(animal.fecha_alta).trim() !== String(animal.fecha_nacimiento || "").trim();

  // Información de Baja para animales inactivos
  const esBaja = !esActivo;
  let fechaBaja = null;
  let motivoBaja = "Baja en censo";
  let destinoBaja = null;

  if (esBaja && animal.movimientos && animal.movimientos.length > 0) {
    const movSalida = animal.movimientos.find((m) => {
      const t = (m.tipo || "").toUpperCase();
      return ["SACRIFICIO", "MUERTE", "VENTA"].includes(t) ||
        (m.origen && m.origen.endsWith("122") && m.destino && !m.destino.endsWith("121") && !m.destino.endsWith("671") && !m.destino.endsWith("591"));
    }) || animal.movimientos[0];

    if (movSalida) {
      fechaBaja = movSalida.fecha;
      destinoBaja = movSalida.destino;
      const t = (movSalida.tipo || "").toUpperCase();
      if (t === "MUERTE") {
        motivoBaja = "Baja en campo / Muerte natural";
      } else if (t === "SACRIFICIO") {
        if (movSalida.origen && movSalida.origen.endsWith("122")) {
          motivoBaja = "Venta / Matadero (Cebadero)";
        } else {
          motivoBaja = "Sacrificio / Desvieje";
        }
      } else if (t === "VENTA") {
        motivoBaja = "Venta comercial";
      } else {
        motivoBaja = movSalida.tipo || "Baja";
      }
    }
  }

  // Partos y Becerros
  let htmlPartos = '<p style="color: var(--text-dim); font-size: 0.88rem; padding: 10px 0;">No tiene partos registrados</p>';
  if (animal.partos && animal.partos.length > 0) {
    htmlPartos = animal.partos
      .map((p) => {
        const digitosCria = extraer4Digitos(p.cria_crotal);
        const tiempoParto = calcularTiempoTranscurrido(p.fecha_parto);
        const sexoTexto = p.cria_sexo === "M" ? "Macho" : p.cria_sexo === "H" ? "Hembra" : (p.cria_sexo || "Sexo N/D");

        return `
          <div class="history-item" style="flex-direction: column; align-items: stretch; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="history-main-title">
                Parto: ${formatearFecha(p.fecha_parto)}
              </div>
              <div class="history-date">${escapeHtml(tiempoParto)}</div>
            </div>
            
            ${
              p.cria_crotal
                ? `
                <button class="clickable-chip chip-cria" data-action="select-animal" data-crotal="${escapeHtml(p.cria_crotal)}">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-weight: 800; font-size: 1.05rem; color: var(--brand-primary);">${escapeHtml(digitosCria)}</span>
                    <span style="font-size: 0.84rem; color: var(--text-muted);">${escapeHtml(p.cria_crotal)} • ${escapeHtml(sexoTexto)}</span>
                  </div>
                  <span class="chip-action">Ver ficha cría →</span>
                </button>
                `
                : `<span style="font-size: 0.85rem; color: var(--text-muted);">Cría sin crotal asignado (${escapeHtml(sexoTexto)})</span>`
            }
          </div>
        `;
      })
      .join("");
  }

  // Movimientos
  let htmlMovimientos = '<p style="color: var(--text-dim); font-size: 0.88rem; padding: 10px 0;">Sin movimientos registrados</p>';
  if (animal.movimientos && animal.movimientos.length > 0) {
    htmlMovimientos = animal.movimientos
      .map(
        (m) => `
        <div class="history-item">
          <div>
            <div class="history-main-title">${escapeHtml(m.tipo || "Movimiento")}</div>
            <div class="history-sub-title">
              ${m.origen ? `Origen: ${escapeHtml(m.origen)}` : ""} ${m.destino ? `→ Destino: ${escapeHtml(m.destino)}` : ""}
            </div>
          </div>
          <div class="history-date">${formatearFecha(m.fecha)}</div>
        </div>
      `
      )
      .join("");
  }

  // Botón Madre interactivo
  let componenteMadre = '<span class="spec-val">Desconocida</span>';
  if (animal.madre_crotal) {
    const madre4 = extraer4Digitos(animal.madre_crotal);
    componenteMadre = `
      <button class="clickable-chip chip-madre" data-action="select-animal" data-crotal="${escapeHtml(animal.madre_crotal)}">
        <span>Vaca <strong>${escapeHtml(madre4)}</strong> (${escapeHtml(animal.madre_crotal)})</span>
        <span class="chip-action">Ver madre →</span>
      </button>
    `;
  }

  // Botón Corral / Lote interactivo
  let componenteCorral = '<span class="spec-val">Sin lote asignado</span>';
  if (animal.corral && animal.corral.trim()) {
    const corralNombre = animal.corral.trim();
    componenteCorral = `
      <button class="clickable-chip chip-corral" data-action="view-corral" data-corral="${escapeHtml(corralNombre)}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        <span>${escapeHtml(corralNombre)}</span>
        <span class="chip-action">Ver lote completo →</span>
      </button>
    `;
  }

  const esHembra = !animal.sexo || ['H', 'V'].includes(animal.sexo.trim().toUpperCase()[0]);
  const descSexo = (animal.sexo === 'M' || animal.sexo === 'Machos') ? 'Macho' : esHembra ? 'Hembra' : escapeHtml(animal.sexo || 'N/D');

  return `
    <div class="detail-card">
      <button class="btn-back-link" data-action="back">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        <span>${escapeHtml(textoVolver)}</span>
      </button>

      <div class="detail-headline">
        <div>
          <div class="detail-crotal-big">${escapeHtml(animal.crotal_4)}</div>
          <div class="detail-crotal-full">${escapeHtml(animal.crotal)} ${animal.nombre ? `• ${escapeHtml(animal.nombre)}` : ""}</div>
        </div>
        <span class="status-pill ${estadoClase}">${estadoTexto}</span>
      </div>

      <div class="animal-specs-grid" style="padding-top: 14px; gap: 14px 20px;">
        <div style="grid-column: 1 / -1;">
          <div class="spec-label">Ubicación / Lote actual (Clic para ver animales del lote)</div>
          <div style="margin-top: 4px;">${componenteCorral}</div>
        </div>

        <div>
          <div class="spec-label">Raza y Sexo</div>
          <div class="spec-val">${escapeHtml(animal.raza || "")} (${descSexo})</div>
        </div>

        <div>
          <div class="spec-label">Fecha Nacimiento</div>
          <div class="spec-val">${formatearFecha(animal.fecha_nacimiento)} (${calcularEdad(animal.fecha_nacimiento)})</div>
        </div>

        ${tieneAltaDiferente ? `
        <div>
          <div class="spec-label">Alta en Explotación</div>
          <div class="spec-val">${formatearFecha(animal.fecha_alta)} <span style="font-size: 0.75rem; color: var(--text-dim);">(Entrada en finca)</span></div>
        </div>
        ` : ""}

        ${esBaja ? `
        <div>
          <div class="spec-label" style="color: #b91c1c; font-weight: 700;">Fecha de Baja</div>
          <div class="spec-val" style="color: #b91c1c; font-weight: 700;">${formatearFecha(fechaBaja)}</div>
        </div>

        <div>
          <div class="spec-label" style="color: #b91c1c; font-weight: 700;">Motivo de Baja</div>
          <div class="spec-val" style="font-weight: 700; color: var(--text-main);">
            ${escapeHtml(motivoBaja)}
            ${destinoBaja ? `<span style="font-size: 0.78rem; font-weight: 500; color: var(--text-muted); display: block;">Destino: ${escapeHtml(formatearExplotacionAmigable(destinoBaja))}</span>` : ""}
          </div>
        </div>
        ` : ""}

        <div>
          <div class="spec-label">Último Parto</div>
          <div class="spec-val">${animal.fecha_ult_parto ? formatearFecha(animal.fecha_ult_parto) : "Sin partos"}</div>
        </div>

        <div style="grid-column: 1 / -1;">
          <div class="spec-label">Madre (Clic para ver ficha de la madre)</div>
          <div style="margin-top: 4px;">${componenteMadre}</div>
        </div>
      </div>

      <div class="section-heading" style="display: flex; justify-content: space-between; align-items: center;">
        <span>Historial de Partos y Crías (${animal.partos ? animal.partos.length : 0})</span>
        ${esHembra && esActivo ? `
          <button data-action="registrar-parto" data-madre-crotal="${escapeHtml(animal.crotal)}" data-madre-4="${escapeHtml(animal.crotal_4)}" data-madre-raza="${escapeHtml(animal.raza || '')}" style="background: #10b981; color: #ffffff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.15);">
            <span>➕ Registrar Parto</span>
          </button>
        ` : ""}
      </div>
      <div>${htmlPartos}</div>

      <div class="section-heading">Historial de Movimientos (${animal.movimientos ? animal.movimientos.length : 0})</div>
      <div>${htmlMovimientos}</div>
    </div>
  `;
}
