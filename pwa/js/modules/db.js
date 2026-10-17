// modules/db.js
/**
 * Módulo de acceso a base de datos SQLite en WebAssembly / IndexedDB.
 * Encapsula la capa de persistencia local y asegura queries parametrizadas.
 */

export function getDB() {
  if (typeof window !== "undefined" && window.campoDB) {
    return window.campoDB;
  }
  return null;
}

export async function inicializarDB(progresoCallback) {
  const db = getDB();
  if (!db) {
    throw new Error("Cliente de base de datos no cargado.");
  }
  return await db.inicializar(progresoCallback);
}

export function ejecutarConsulta(sql, params = []) {
  const db = getDB();
  if (!db || !db.db) {
    throw new Error("Base de datos no inicializada.");
  }
  return db.ejecutarQuery(sql, params);
}

export function contarAnimales(termino = "", soloActivos = true) {
  const db = getDB();
  if (!db) return 0;
  return db.contarAnimales(termino, soloActivos);
}

export function buscarAnimales(termino = "", soloActivos = true, limite = 50) {
  const db = getDB();
  if (!db) return [];
  return db.buscar(termino, soloActivos, limite);
}

export async function sincronizarBaseDatosAhora(authToken = null) {
  const db = getDB();
  if (!db) {
    throw new Error("Base de datos no inicializada.");
  }
  return await db.sincronizarAhora(authToken);
}

export async function comprobarActualizacionServidor(authToken = null) {
  const db = getDB();
  if (!db || typeof db.verificarActualizacionServidor !== "function") return null;
  return await db.verificarActualizacionServidor(authToken);
}

export function obtenerEstadoSync() {
  const db = getDB();
  if (!db || typeof db.obtenerEstadoSync !== "function") return { localMeta: null, historial: [] };
  return db.obtenerEstadoSync();
}

export function obtenerDetalleAnimal(crotal) {
  const db = getDB();
  if (!db) return null;
  return db.obtenerDetalleAnimal(crotal);
}

export function obtenerAnimalesDeLote(nombreLote) {
  const db = getDB();
  if (!db) return [];
  return db.obtenerAnimalesDeLote(nombreLote);
}

export function obtenerRecetas(filtro = "") {
  const db = getDB();
  if (!db) return [];
  return db.obtenerRecetas(filtro);
}

export function obtenerComprasAlimento(filtro = "") {
  const db = getDB();
  if (!db) return [];
  return db.obtenerComprasAlimento(filtro);
}

export function obtenerMovimientos(opciones = {}) {
  const db = getDB();
  if (!db) return [];
  return db.obtenerMovimientos(opciones);
}

export function obtenerAniosMovimientos() {
  const db = getDB();
  if (!db || typeof db.obtenerAniosMovimientos !== "function") return [];
  return db.obtenerAniosMovimientos();
}

export function getMetadata() {
  const db = getDB();
  return db ? db.meta : {};
}

export async function registrarPartoOptimista(datos) {
  const db = getDB();
  if (!db) {
    throw new Error("Base de datos no inicializada.");
  }
  return await db.registrarPartoOptimista(datos);
}

export function obtenerLiquidaciones(filtro = "") {
  const db = getDB();
  if (!db || typeof db.obtenerLiquidaciones !== "function") return [];
  return db.obtenerLiquidaciones(filtro);
}

export function obtenerDetalleLiquidacion(facturaId) {
  const db = getDB();
  if (!db || typeof db.obtenerDetalleLiquidacion !== "function") return null;
  return db.obtenerDetalleLiquidacion(facturaId);
}

export function obtenerResumenKpisLiquidaciones() {
  const db = getDB();
  if (!db || typeof db.obtenerResumenKpisLiquidaciones !== "function") {
    return {
      total_facturas: 0,
      total_importe: 0,
      total_cabezas: 0,
      total_kilos: 0,
      peso_medio: 0,
      precio_medio: 0,
      total_canales_pesadas: 0
    };
  }
  return db.obtenerResumenKpisLiquidaciones();
}

export function registrarPesaje(datos) {
  const db = getDB();
  if (!db || typeof db.registrarPesaje !== "function") {
    throw new Error("Cliente de base de datos no soporta registro de pesajes.");
  }
  return db.registrarPesaje(datos);
}

export function obtenerAniosDisponiblesFinancieros() {
  const db = getDB();
  if (!db || typeof db.obtenerAniosDisponiblesFinancieros !== "function") return [new Date().getFullYear().toString()];
  return db.obtenerAniosDisponiblesFinancieros();
}

export function obtenerResumenFinancieroGlobal(anio = null, categoria = null) {
  const db = getDB();
  if (!db || typeof db.obtenerResumenFinancieroGlobal !== "function") {
    return {
      ingresos_carne: 0,
      gasto_pienso: 0,
      margen_bruto_alimentacion: 0,
      ratio_carne_pienso: null,
      desglose_categorias: []
    };
  }
  return db.obtenerResumenFinancieroGlobal(anio, categoria);
}

export function obtenerSerieMensualFinanciera(anio = null) {
  const db = getDB();
  if (!db || typeof db.obtenerSerieMensualFinanciera !== "function") return [];
  return db.obtenerSerieMensualFinanciera(anio);
}

export function obtenerMargenTecnicoCebo(anio = null, categoria = null, usarEstimaciones = false) {
  const db = getDB();
  if (!db || typeof db.obtenerMargenTecnicoCebo !== "function") {
    return {
      total_animales: 0,
      margen_tecnico_total: 0,
      margen_medio_cabeza: 0,
      coste_pienso_medio_cabeza: 0,
      estancia_media_dias: 0,
      prima_media_lonja_kg: null,
      usar_estimaciones: usarEstimaciones,
      animales: []
    };
  }
  return db.obtenerMargenTecnicoCebo(anio, categoria, usarEstimaciones);
}

export function obtenerRadarMateriasPrimas(anio = null, usarEstimaciones = false) {
  const db = getDB();
  if (!db || typeof db.obtenerRadarMateriasPrimas !== "function") return [];
  return db.obtenerRadarMateriasPrimas(anio, usarEstimaciones);
}

export function obtenerRadarLonjaCarne(anio = null, usarEstimaciones = false) {
  const db = getDB();
  if (!db || typeof db.obtenerRadarLonjaCarne !== "function") return [];
  return db.obtenerRadarLonjaCarne(anio, usarEstimaciones);
}

export function obtenerEstacionalidadLonjaCarne() {
  const db = getDB();
  if (!db || typeof db.obtenerEstacionalidadLonjaCarne !== "function") return [];
  return db.obtenerEstacionalidadLonjaCarne();
}

export function calcularSimulacionTimingVenta(params = {}) {
  const db = getDB();
  if (db && typeof db.calcularSimulacionTimingVenta === "function") {
    return db.calcularSimulacionTimingVenta(params);
  }
  const {
    pesoCanalActual = 330.0,
    diasRetraso = 21,
    gmdVivo = 1.35,
    costeDiarioPienso = 2.65,
    precioActualKg = 7.15,
    precioEsperadoKg = 7.20,
    esMacho = true
  } = params;

  const rendimiento = esMacho ? 0.58 : 0.56;
  const pesoVivoActual = pesoCanalActual / rendimiento;
  const gananciaVivo = diasRetraso * gmdVivo;
  const pesoVivoNuevo = pesoVivoActual + gananciaVivo;
  const pesoCanalNuevo = Number((pesoVivoNuevo * rendimiento).toFixed(1));
  const gananciaCanal = Number((pesoCanalNuevo - pesoCanalActual).toFixed(1));

  let penalizacionSobrepeso = 0;
  let precioFinalEfectivo = precioEsperadoKg;
  let saltaSobrepeso = false;

  if (esMacho && pesoCanalActual <= 350.0 && pesoCanalNuevo > 350.0) {
    saltaSobrepeso = true;
    precioFinalEfectivo = Math.max(0, Number((precioEsperadoKg - 0.25).toFixed(3)));
    penalizacionSobrepeso = Number(((precioEsperadoKg - precioFinalEfectivo) * pesoCanalNuevo).toFixed(2));
  }

  const ingresoActual = Number((pesoCanalActual * precioActualKg).toFixed(2));
  const ingresoNuevo = Number((pesoCanalNuevo * precioFinalEfectivo).toFixed(2));
  const ingresoMarginal = Number((ingresoNuevo - ingresoActual).toFixed(2));

  const costePiensoAcumulado = Number((diasRetraso * costeDiarioPienso).toFixed(2));
  const margenNetoRetraso = Number((ingresoMarginal - costePiensoAcumulado).toFixed(2));

  const precioUmbralEquilibrio = pesoCanalNuevo > 0 
    ? Number(((ingresoActual + costePiensoAcumulado) / pesoCanalNuevo).toFixed(3))
    : precioActualKg;

  return {
    pesoCanalActual,
    pesoCanalNuevo,
    gananciaCanal,
    saltaSobrepeso,
    penalizacionSobrepeso,
    ingresoActual,
    ingresoNuevo,
    ingresoMarginal,
    costePiensoAcumulado,
    margenNetoRetraso,
    esRentable: margenNetoRetraso > 0,
    precioFinalEfectivo,
    precioUmbralEquilibrio
  };
}

export function obtenerSeriesTradingCarne(anio = null, usarEstimaciones = false) {
  const db = getDB();
  if (!db || typeof db.obtenerSeriesTradingCarne !== "function") {
    return { anojo_extra: [], anojo_pesado: [], ternera_extra: [], vaca_desvieje: [], precio_granja: [] };
  }
  return db.obtenerSeriesTradingCarne(anio, usarEstimaciones);
}

export function obtenerSeriesTradingMateriasPrimas(anio = null, usarEstimaciones = false) {
  const db = getDB();
  if (!db || typeof db.obtenerSeriesTradingMateriasPrimas !== "function") {
    return { pienso_lonja: [], pienso_granja: [], cebada_lonja: [], maiz_lonja: [] };
  }
  return db.obtenerSeriesTradingMateriasPrimas(anio, usarEstimaciones);
}

export function obtenerSeriesTradingTesoreria(anio = null) {
  const db = getDB();
  if (!db || typeof db.obtenerSeriesTradingTesoreria !== "function") {
    return { ingresos_carne: [], gastos_pienso: [], margen_neto: [] };
  }
  return db.obtenerSeriesTradingTesoreria(anio);
}
