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

export function buscarAnimales(termino = "", soloActivos = true) {
  const db = getDB();
  if (!db) return [];
  return db.buscar(termino, soloActivos);
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

export function getMetadata() {
  const db = getDB();
  return db ? db.meta : {};
}
