// modules/config.js
/**
 * Configuración global del estado y utilidades de formateo y sanitización.
 */

export const AppState = {
  tabActual: "animales",
  terminoBusqueda: "",
  soloActivos: true,
  crotalSeleccionado: null,
  corralSeleccionado: null,
  filtroRecetas: "",
  filtroAlimentos: "",
  filtroMovimientos: "",
  tipoMovimiento: "TODOS",
  anioMovimiento: "TODOS",
  destinoMovimiento: "TODOS",
  limiteMovimientos: 100,
  limiteAnimales: 50,
  tecladoTactilVisible: false,
  // Historial conversacional para preguntas de seguimiento (multi-turno) con IA
  conversacionIA: [],
  // Pila de navegación para permitir clics encadenados (vaca -> madre -> corral -> ternero -> ...)
  historial: []
};

export function formatearFecha(isoStr) {
  if (!isoStr) return "-";
  const partes = String(isoStr).split("T")[0].split("-");
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : isoStr;
}

export function formatearKg(kg) {
  if (kg == null) return "0";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(kg);
}

export function formatearMoneda(val, decimales = 2) {
  if (val == null) return "0";
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  }).format(val);
}

export function calcularEdad(fnacStr) {
  if (!fnacStr) return "-";
  const nac = new Date(fnacStr);
  if (isNaN(nac.getTime())) return "-";
  const hoy = new Date();
  let anios = hoy.getFullYear() - nac.getFullYear();
  let meses = hoy.getMonth() - nac.getMonth();
  if (meses < 0) {
    anios--;
    meses += 12;
  }
  if (anios === 0) return `${meses} meses`;
  if (meses === 0) return `${anios} años`;
  return `${anios} a, ${meses} m`;
}

export function calcularTiempoTranscurrido(fechaStr) {
  if (!fechaStr) return "";
  const f = new Date(fechaStr);
  if (isNaN(f.getTime())) return "";
  const hoy = new Date();
  const diffMs = hoy - f;
  const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (dias < 30) return `hace ${dias} d`;
  const meses = Math.floor(dias / 30.4);
  if (meses < 12) return `hace ${meses} m`;
  const anios = Math.floor(meses / 12);
  return `hace ${anios} a`;
}

export function extraer4Digitos(crotal) {
  if (!crotal) return "";
  const digitos = String(crotal).replace(/\D/g, "");
  return digitos.length >= 4 ? digitos.slice(-4) : digitos;
}

export function esPantallaEscritorio() {
  return typeof window !== "undefined" && window.innerWidth >= 768;
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatearExplotacionAmigable(codigo) {
  if (!codigo) return "Desconocido";
  const c = String(codigo).trim();
  if (c.includes("121") || c.endsWith("121")) return `${c} (Vida / Nodrizas)`;
  if (c.includes("122") || c.endsWith("122")) return `${c} (Cebadero)`;
  if (c.includes("671") || c.endsWith("671")) return `${c} (Cipérez - Histórica)`;
  if (c.includes("591") || c.endsWith("591")) return `${c} (Cerezal - Histórica)`;
  return c;
}

export function registrarPasoHistorial(tipo, id, titulo, meta = {}) {
  if (AppState.historial.length > 0) {
    const ultimo = AppState.historial[AppState.historial.length - 1];
    if (ultimo.tipo === tipo && String(ultimo.id) === String(id)) {
      return;
    }
  }
  AppState.historial.push({ tipo, id, titulo, meta });
}

export function obtenerTextoBotonVolver() {
  if (AppState.historial.length === 0) {
    return "Volver a la búsqueda";
  }
  const prev = AppState.historial[AppState.historial.length - 1];
  if (prev.tipo === "animal") {
    return `Volver a Vaca ${prev.meta?.crotal_4 || prev.id}`;
  }
  if (prev.tipo === "corral") {
    return `Volver a Lote ${prev.id}`;
  }
  if (prev.tipo === "liquidaciones") {
    return prev.id ? `Volver a Factura ${prev.meta?.numero_factura || prev.id}` : "Volver a Liquidaciones";
  }
  if (prev.tipo === "movimientos") {
    return "Volver a Movimientos";
  }
  return "Volver a la búsqueda";
}

/**
 * Clasifica un movimiento según el modelo de dominio unificado:
 * - VENTA: Salidas comerciales (terneros cebados a matadero, vacas de desvieje a matadero, ventas a terceros).
 * - TRASPASO_CEBADERO: Traspasos de animales desde cría/vida (121, 671, 591) hacia cebadero propio (122).
 * - MOVIMIENTO_INTERNO: Movimientos entre fincas reproductoras (121, 671, 591) o cambios de cerca/corral.
 * - NACIMIENTO: Parideras y altas por nacimiento.
 * - COMPRA: Entradas de ganado comprado a terceros.
 * - MUERTE: Bajas en campo / muerte natural.
 * - SACRIFICIO: Sacrificios en campo no derivados a matadero comercial.
 */
export function clasificarMovimientoUnificado(orig = "", dest = "", tipo = "") {
  const o = String(orig || "").trim();
  const d = String(dest || "").trim();
  const t = String(tipo || "").trim().toUpperCase();

  const esFincaInterna = (code) => code.endsWith("121") || code.endsWith("671") || code.endsWith("591");
  const esMatadero = (code) =>
    code.endsWith("081") ||
    code.endsWith("014") ||
    code.endsWith("061") ||
    code.endsWith("078") ||
    code.toUpperCase().includes("MATADERO") ||
    code.startsWith("ES37376") ||
    code.startsWith("ES47086") ||
    code.startsWith("ES28129");

  // 1. Nacimiento siempre es Nacimiento
  if (t === "NACIMIENTO" || t === "N") {
    return {
      tipo_display: "NACIMIENTO",
      label: "Nacimiento",
      badge_class: "nacimiento"
    };
  }

  // 2. Movimientos internos entre 121, 671 y 591 (independientemente de cómo se registrara en Access)
  if (esFincaInterna(o) && esFincaInterna(d) && o !== d) {
    return {
      tipo_display: "MOVIMIENTO_INTERNO",
      label: "Movimiento Interno",
      badge_class: "interno"
    };
  }

  // 3. Ubicaciones o movimientos dentro de la misma finca
  if (t === "UBICACIÓN" || t === "UBICACION" || t === "U") {
    return {
      tipo_display: "MOVIMIENTO_INTERNO",
      label: "Movimiento Interno",
      badge_class: "interno"
    };
  }

  // 4. Traspasos a Cebadero (122) desde explotaciones de vida/cría
  if (d.endsWith("122") && (esFincaInterna(o) || t === "TRASPASO" || t === "T")) {
    return {
      tipo_display: "TRASPASO_CEBADERO",
      label: "Traspaso Cebadero",
      badge_class: "traspaso"
    };
  }

  // 5. Salidas a matadero (desde cebadero 122 o fincas de vida 121/671/591) -> Venta comercial
  if ((o.endsWith("122") || esFincaInterna(o)) && esMatadero(d)) {
    if (t === "SACRIFICIO" || t === "VENTA" || t === "S" || t === "V") {
      return {
        tipo_display: "VENTA",
        label: "Venta",
        badge_class: "venta"
      };
    }
  }

  // 6. Cualquier salida desde el Cebadero (122) hacia destinos no internos -> Venta comercial
  if (o.endsWith("122") && !esFincaInterna(d) && d !== "") {
    return {
      tipo_display: "VENTA",
      label: "Venta",
      badge_class: "venta"
    };
  }

  // 7. Ventas explícitas de la base de datos
  if (t === "VENTA" || t === "V") {
    return {
      tipo_display: "VENTA",
      label: "Venta",
      badge_class: "venta"
    };
  }

  // 8. Compras
  if (t === "COMPRA" || t === "C") {
    return {
      tipo_display: "COMPRA",
      label: "Compra",
      badge_class: "compra"
    };
  }

  // 9. Bajas en campo / muerte natural
  if (t === "MUERTE" || t === "M") {
    return {
      tipo_display: "MUERTE",
      label: "Baja en campo",
      badge_class: "muerte"
    };
  }

  // 10. Sacrificios en campo no derivados a matadero comercial
  if (t === "SACRIFICIO" || t === "S") {
    return {
      tipo_display: "SACRIFICIO",
      label: "Sacrificio",
      badge_class: "sacrificio"
    };
  }

  // 11. Traspasos genéricos
  if (t === "TRASPASO" || t === "T") {
    return {
      tipo_display: "TRASPASO",
      label: "Traspaso",
      badge_class: "traspaso"
    };
  }

  return {
    tipo_display: t || "OTRO",
    label: t || "Movimiento",
    badge_class: "otro"
  };

}

export function dispararToast(msg, esError = false) {
  if (typeof document === "undefined") return;
  let toast = document.getElementById("pwa-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "pwa-toast";
    toast.className = "pwa-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.backgroundColor = esError ? "var(--md-error, #ba1a1a)" : "var(--md-primary, #1b5e20)";
  toast.style.color = "#ffffff";
  toast.classList.add("pwa-toast--visible");
  setTimeout(() => {
    toast.classList.remove("pwa-toast--visible");
  }, 3500);
}
