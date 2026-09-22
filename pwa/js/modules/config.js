// modules/config.js
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
  tecladoTactilVisible: false,
  conversacionIA: [],
  historial: []
};

export function formatearFecha(isoStr) {
  if (!isoStr) return "-";
  const partes = isoStr.split("T")[0].split("-");
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
  const digitos = crotal.replace(/\D/g, "");
  return digitos.length >= 4 ? digitos.slice(-4) : digitos;
}

export function esPantallaEscritorio() {
  return window.innerWidth >= 768;
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
