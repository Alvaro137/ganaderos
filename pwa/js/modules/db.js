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

