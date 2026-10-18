/**
 * Cliente de base de datos SQLite en WebAssembly para Ganaderos Campo.
 * Ejecuta todas las consultas 100% en local en el navegador del móvil.
 */

const IDB_CONFIG = {
  name: "GanaderosCampoOffline",
  version: 1,
  store: "censo_storage",
  key: "sqlite_db_file"
};

function openIndexedDB() {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const req = window.indexedDB.open(IDB_CONFIG.name, IDB_CONFIG.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_CONFIG.store)) {
          db.createObjectStore(IDB_CONFIG.store);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.error("[IDB] Error abriendo IndexedDB:", req.error);
        resolve(null);
      };
      req.onblocked = () => {
        console.warn("[IDB] Apertura de IndexedDB bloqueada por otra pestaña.");
      };
    } catch (e) {
      console.error("[IDB] Excepción abriendo IndexedDB:", e);
      resolve(null);
    }
  });
}

async function guardarBaseDatosLocal(buffer) {
  try {
    const db = await openIndexedDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_CONFIG.store, "readwrite");
        tx.objectStore(IDB_CONFIG.store).put(buffer, IDB_CONFIG.key);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          console.warn("[IDB] Error guardando base de datos local:", tx.error);
          db.close();
          resolve(false);
        };
      } catch (e) {
        db.close();
        resolve(false);
      }
    });
  } catch (err) {
    console.warn("[IDB] Excepción guardando base de datos local:", err);
    return false;
  }
}

async function obtenerBaseDatosLocal() {
  try {
    const db = await openIndexedDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_CONFIG.store, "readonly");
        const req = tx.objectStore(IDB_CONFIG.store).get(IDB_CONFIG.key);
        req.onsuccess = () => {
          try { db.close(); } catch (_) {}
          resolve(req.result || null);
        };
        req.onerror = () => {
          console.warn("[IDB] Error leyendo base de datos local:", req.error);
          try { db.close(); } catch (_) {}
          resolve(null);
        };
      } catch (e) {
        try { db.close(); } catch (_) {}
        resolve(null);
      }
    });
  } catch (err) {
    console.warn("[IDB] Excepción leyendo base de datos local:", err);
    return null;
  }
}

const DB_META_STORAGE_KEY = "campo_pwa_db_meta";
const DB_SYNC_HISTORY_KEY = "campo_pwa_sync_history";

function getStoredDBMeta() {
  try {
    const raw = localStorage.getItem(DB_META_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStoredDBMeta(meta) {
  try {
    localStorage.setItem(DB_META_STORAGE_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn("[DB] Error guardando meta local:", e);
  }
}

function getStoredSyncHistory() {
  try {
    const raw = localStorage.getItem(DB_SYNC_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function appendSyncHistory(evento) {
  try {
    const list = getStoredSyncHistory();
    list.unshift({
      timestamp: new Date().toISOString(),
      ...evento
    });
    const trimmed = list.slice(0, 15);
    localStorage.setItem(DB_SYNC_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn("[DB] Error guardando historial de sync:", e);
  }
}

class CampoDB {
  constructor() {
    this.db = null;
    this.ready = false;
    this.meta = {};
    this.SQL = null;
  }

  _cargarMetadatos() {
    try {
      const resMeta = this.ejecutarQuery("SELECT clave, valor FROM meta");
      for (const row of resMeta) {
        this.meta[row.clave] = row.valor;
      }
    } catch (e) {
      console.warn("[DB] No se pudieron cargar metadatos:", e);
    }
  }

  _reemplazarBaseDatosEnCaliente(newBuf) {
    if (!this.SQL) return false;
    try {
      const nuevaInstancia = new this.SQL.Database(new Uint8Array(newBuf));
      const stmt = nuevaInstancia.prepare("SELECT clave, valor FROM meta");
      const nuevosMetas = {};
      while (stmt.step()) {
        const obj = stmt.getAsObject();
        nuevosMetas[obj.clave] = obj.valor;
      }
      stmt.free();

      try {
        if (this.db) this.db.close();
      } catch (e) {
        console.warn("[DB] Error cerrando instancia anterior:", e);
      }

      this.db = nuevaInstancia;
      this.meta = nuevosMetas;
      console.log("[DB] Base de datos actualizada en caliente con éxito. Metadatos:", nuevosMetas);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("campo:db-updated", {
          detail: { meta: nuevosMetas }
        }));
      }
      return true;
    } catch (err) {
      console.error("[DB] Error reemplazando base de datos en caliente:", err);
      return false;
    }
  }

  async _verificarYVaciarOutbox(token) {
    try {
      const { contarMutacionesPendientes, sincronizarOutboxConServidor } = await import("./modules/outbox.js");
      const pendientes = await contarMutacionesPendientes();
      if (pendientes > 0) {
        console.log(`[DB Sync] Detectadas ${pendientes} mutaciones pendientes en Outbox. Sincronizando antes de actualizar censo...`);
        await sincronizarOutboxConServidor(token);
        const restantes = await contarMutacionesPendientes();
        if (restantes > 0) {
          console.warn(`[DB Sync] Aún quedan ${restantes} mutaciones pendientes en Outbox. Se pospone la descarga del censo para proteger los datos locales.`);
          return false;
        }
      }
      return true;
    } catch (e) {
      console.warn("[DB Sync] No se pudo comprobar el estado del Outbox:", e);
      return true;
    }
  }

  async _sincronizarEnSegundoPlano(authToken = null) {
    if (!navigator.onLine) return;
    const token = authToken || localStorage.getItem("campo_pwa_token") || "";
    if (!token) return;

    // Protección Local-First: nunca sobrescribir si hay partos/mutaciones pendientes en Outbox
    const outboxLimpio = await this._verificarYVaciarOutbox(token);
    if (!outboxLimpio) return;

    try {
      const headers = {
        "Authorization": `Bearer ${token}`,
        "X-Auth-Token": token
      };
      const resp = await fetch("./api/database", { headers });
      if (resp.ok) {
        const newBuf = await resp.arrayBuffer();
        await guardarBaseDatosLocal(newBuf);
        console.log("[DB] Censo local actualizado en segundo plano en IndexedDB.");
        this._reemplazarBaseDatosEnCaliente(newBuf);
        appendSyncHistory({
          accion: "Sincronización en segundo plano",
          estado: "Éxito",
          detalle: "Censo actualizado silenciosamente en segundo plano"
        });
      }
    } catch {
      // Silencioso: las operaciones offline tienen prioridad
    }
  }

  async verificarActualizacionServidor(authToken = null) {
    if (!navigator.onLine) {
      return { ok: false, razon: "offline" };
    }
    const token = authToken || localStorage.getItem("campo_pwa_token") || "";
    const headers = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["X-Auth-Token"] = token;
    }
    try {
      const resp = await fetch("./api/database/meta", { headers });
      if (!resp.ok) {
        if (resp.status === 401) return { ok: false, razon: "auth_required" };
        return { ok: false, razon: "error_servidor", status: resp.status };
      }
      const serverMeta = await resp.json();
      const localMeta = getStoredDBMeta();

      const mtimeLocal = (localMeta && localMeta.mtime) ? localMeta.mtime : 0;
      const hayActualizacion = (serverMeta.mtime > mtimeLocal);

      return {
        ok: true,
        hayActualizacion,
        serverMeta,
        localMeta
      };
    } catch (err) {
      return { ok: false, razon: "network_error", error: String(err) };
    }
  }

  obtenerEstadoSync() {
    return {
      localMeta: getStoredDBMeta(),
      historial: getStoredSyncHistory()
    };
  }

  async sincronizarAhora(authToken = null) {
    if (!navigator.onLine) {
      appendSyncHistory({ accion: "Descarga manual", estado: "Error", detalle: "Sin conexión a internet" });
      throw new Error("SIN_CONEXION");
    }
    const token = authToken || localStorage.getItem("campo_pwa_token") || "";
    if (!token) {
      appendSyncHistory({ accion: "Descarga manual", estado: "Error", detalle: "Sesión no autenticada" });
      throw new Error("AUTH_REQUIRED");
    }

    // Protección Local-First: vaciar Outbox antes de sobrescribir el censo local
    const outboxLimpio = await this._verificarYVaciarOutbox(token);
    if (!outboxLimpio) {
      appendSyncHistory({ accion: "Descarga manual", estado: "Pospuesta", detalle: "Partos pendientes en Outbox" });
      throw new Error("MUTACIONES_PENDIENTES: Hay partos o registros locales en cola que no pudieron subirse al servidor. Resuelve los envíos pendientes antes de reemplazar el censo.");
    }

    const headers = {
      "Authorization": `Bearer ${token}`,
      "X-Auth-Token": token
    };

    let serverMeta = null;
    try {
      const metaResp = await fetch("./api/database/meta", { headers });
      if (metaResp.ok) {
        serverMeta = await metaResp.json();
      }
    } catch (_) {}

    const resp = await fetch("./api/database", { headers });
    if (!resp.ok) {
      appendSyncHistory({ accion: "Descarga manual", estado: "Error", detalle: `Fallo HTTP ${resp.status}` });
      if (resp.status === 401) throw new Error("AUTH_REQUIRED");
      throw new Error(`Error en el servidor (${resp.status})`);
    }

    const newBuf = await resp.arrayBuffer();
    await guardarBaseDatosLocal(newBuf);
    const hotOk = this._reemplazarBaseDatosEnCaliente(newBuf);

    const mtimeVal = serverMeta ? serverMeta.mtime : Math.floor(Date.now() / 1000);
    const mtimeIso = serverMeta ? serverMeta.mtime_iso : new Date().toISOString();
    const countAnimales = this.contarAnimales("", false);

    setStoredDBMeta({
      mtime: mtimeVal,
      mtime_iso: mtimeIso,
      descargado_en: new Date().toISOString(),
      total_animales: serverMeta ? serverMeta.total_animales : countAnimales,
      filename: serverMeta ? serverMeta.filename : "ganaderos_campo.sqlite"
    });

    appendSyncHistory({
      accion: "Actualización censo",
      estado: "Éxito",
      detalle: `Descargado censo (${countAnimales} animales en total)`
    });

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("campo:db-sync-completed", {
        detail: { meta: this.meta, serverMeta }
      }));
    }

    return { ok: true, hotReloaded: hotOk, meta: this.meta, serverMeta };
  }

  async inicializar(onProgress, authToken = null) {
    if (this.ready) return;

    if (onProgress) onProgress("Cargando motor de datos...");
    const SQL = await initSqlJs({
      locateFile: (file) => `./js/${file}`
    });
    this.SQL = SQL;

    // 1. OFFLINE-FIRST: Comprobar si ya existe el censo en almacenamiento persistente local
    if (onProgress) onProgress("Comprobando censo local...");
    const bufferLocal = await obtenerBaseDatosLocal();

    if (bufferLocal) {
      if (onProgress) onProgress("Abriendo base de datos local...");
      this.db = new SQL.Database(new Uint8Array(bufferLocal));
      this.ready = true;
      this._cargarMetadatos();

      // Sincronización en segundo plano silenciosa si hay conexión
      this._sincronizarEnSegundoPlano(authToken);
      return;
    }

    // 2. Si no hay copia local, descargamos del servidor (requiere conexión y autenticación la 1ª vez)
    if (onProgress) onProgress("Descargando censo por primera vez...");
    const headers = {};
    const token = authToken || localStorage.getItem("campo_pwa_token") || "";
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["X-Auth-Token"] = token;
    }

    let response;
    try {
      response = await fetch("./api/database", { headers });
    } catch (netErr) {
      throw new Error("SIN_CONEXION_INICIAL");
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("AUTH_REQUIRED");
      }
      throw new Error(`No se pudo cargar el censo (${response.status})`);
    }

    const buf = await response.arrayBuffer();

    // Guardar inmediatamente en IndexedDB para disponibilidad 100% offline a partir de ahora
    await guardarBaseDatosLocal(buf);

    if (onProgress) onProgress("Abriendo base de datos...");
    this.db = new SQL.Database(new Uint8Array(buf));
    this.ready = true;
    this._cargarMetadatos();

    const countInit = this.contarAnimales("", false);
    setStoredDBMeta({
      mtime: Math.floor(Date.now() / 1000),
      mtime_iso: new Date().toISOString(),
      descargado_en: new Date().toISOString(),
      total_animales: countInit,
      filename: "ganaderos_campo.sqlite"
    });
    appendSyncHistory({
      accion: "Descarga inicial",
      estado: "Éxito",
      detalle: `Primera descarga del censo (${countInit} animales)`
    });
  }

  ejecutarQuery(sql, params = []) {
    if (!this.db) throw new Error("Base de datos no inicializada");
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const resultados = [];
    while (stmt.step()) {
      resultados.push(stmt.getAsObject());
    }
    stmt.free();
    return resultados;
  }

  contarAnimales(termino = "", soloActivos = true) {
    if (!this.db) return 0;
    try {
      if (!termino || termino.trim() === "") {
        const cond = soloActivos ? "WHERE estado = 'A'" : "";
        const res = this.ejecutarQuery(`SELECT COUNT(*) as total FROM animales ${cond}`);
        return res[0] ? res[0].total : 0;
      }
      const t = termino.trim();
      const soloDigitos = t.replace(/\D/g, "");
      let sql, params;
      if (soloDigitos.length >= 1 && soloDigitos.length <= 4) {
        const condActivo = soloActivos ? "AND estado = 'A'" : "";
        sql = `SELECT COUNT(*) as total FROM animales WHERE crotal_4 LIKE ? ${condActivo}`;
        params = [`${soloDigitos}%`];
      } else {
        const condActivo = soloActivos ? "AND estado = 'A'" : "";
        sql = `SELECT COUNT(*) as total FROM animales WHERE (crotal LIKE ? OR corral LIKE ? OR nombre LIKE ?) ${condActivo}`;
        params = [`%${t}%`, `%${t}%`, `%${t}%`];
      }
      const res = this.ejecutarQuery(sql, params);
      return res[0] ? res[0].total : 0;
    } catch (e) {
      console.warn("[DB] Error contando animales:", e);
      return 0;
    }
  }

  buscar(termino, soloActivos = true, limite = 50) {
    const lim = Number.isInteger(limite) && limite > 0 ? limite : 50;
    if (!termino || termino.trim() === "") {
      const cond = soloActivos ? "WHERE estado = 'A'" : "";
      return this.ejecutarQuery(`
        SELECT crotal, crotal_4, nombre, sexo, raza, estado, corral, fecha_ult_parto, total_partos, fecha_nacimiento
        FROM animales
        ${cond}
        ORDER BY crotal_4 ASC
        LIMIT ${lim}
      `);
    }

    const t = termino.trim();
    const soloDigitos = t.replace(/\D/g, "");

    let sql;
    let params;

    if (soloDigitos.length >= 1 && soloDigitos.length <= 4) {
      // Coincidencia flexible por dígitos:
      // 1. Prefijo incremental mientras teclea: '10%' -> 1045, 1022
      // 2. Padding de ceros a la izquierda: '45' -> '0045'
      // 3. Coincidencia por sufijo: '%45'
      const condActivo = soloActivos ? "AND estado = 'A'" : "";
      const conCeros = soloDigitos.padStart(4, "0");
      sql = `
        SELECT crotal, crotal_4, nombre, sexo, raza, estado, corral, fecha_ult_parto, total_partos, fecha_nacimiento
        FROM animales
        WHERE (crotal_4 LIKE ? OR crotal_4 = ? OR crotal_4 LIKE ? OR crotal LIKE ?) ${condActivo}
        ORDER BY (crotal_4 = ?) DESC, (crotal_4 = ?) DESC, (crotal_4 LIKE ?) DESC, (estado = 'A') DESC, crotal_4 ASC
        LIMIT ${lim}
      `;
      params = [`${soloDigitos}%`, conCeros, `%${soloDigitos}`, `%${soloDigitos}`, soloDigitos, conCeros, `${soloDigitos}%`];
    } else {
      // Búsqueda por crotal completo o corral
      const condActivo = soloActivos ? "AND estado = 'A'" : "";
      sql = `
        SELECT crotal, crotal_4, nombre, sexo, raza, estado, corral, fecha_ult_parto, total_partos, fecha_nacimiento
        FROM animales
        WHERE (crotal LIKE ? OR corral LIKE ? OR nombre LIKE ?) ${condActivo}
        ORDER BY (estado = 'A') DESC, crotal_4 ASC
        LIMIT ${lim}
      `;
      params = [`%${t}%`, `%${t}%`, `%${t}%`];
    }

    return this.ejecutarQuery(sql, params);
  }

  obtenerDetalleAnimal(crotal) {
    const animales = this.ejecutarQuery(
      "SELECT * FROM animales WHERE crotal = ?",
      [crotal]
    );
    if (!animales || animales.length === 0) return null;

    const animal = animales[0];

    // Partos de la madre
    animal.partos = this.ejecutarQuery(
      "SELECT * FROM partos WHERE madre_crotal = ? ORDER BY fecha_parto DESC",
      [crotal]
    );

    // Movimientos del animal
    animal.movimientos = this.ejecutarQuery(
      "SELECT * FROM movimientos WHERE crotal = ? ORDER BY fecha DESC",
      [crotal]
    );

    // Madre del animal
    if (animal.madre_crotal) {
      const madreRows = this.ejecutarQuery(
        "SELECT crotal, crotal_4, estado, corral, raza FROM animales WHERE crotal = ?",
        [animal.madre_crotal]
      );
      animal.madre_info = madreRows.length > 0 ? madreRows[0] : null;
    }

    // Liquidación y rendimiento de canal (si el animal fue vendido a matadero / GANAVAEX)
    try {
      const canalRows = this.ejecutarQuery(`
        SELECT c.*, f.numero_factura, f.fecha_factura, f.fecha_pago, f.cliente_cooperativa
        FROM ventas_canales c
        JOIN ventas_liquidaciones f ON c.factura_id = f.id
        WHERE c.crotal_asignado = ?
        ORDER BY f.fecha_factura DESC
        LIMIT 1
      `, [crotal]);
      animal.liquidacion_canal = (canalRows && canalRows.length > 0) ? canalRows[0] : null;
    } catch (_) {
      animal.liquidacion_canal = null;
    }

    // Historial de pesajes en manga / tolva y ganancia media diaria (GMD)
    try {
      animal.pesajes = this.ejecutarQuery(
        "SELECT * FROM pesajes WHERE crotal = ? ORDER BY fecha ASC, id ASC",
        [crotal]
      );
      if (animal.pesajes && animal.pesajes.length > 0) {
        for (let i = 0; i < animal.pesajes.length; i++) {
          if (i > 0) {
            const pPrev = animal.pesajes[i - 1];
            const pCurr = animal.pesajes[i];
            const dPrev = new Date(pPrev.fecha);
            const dCurr = new Date(pCurr.fecha);
            const diffDias = Math.round((dCurr - dPrev) / (1000 * 60 * 60 * 24));
            if (diffDias > 0 && pCurr.peso_kg != null && pPrev.peso_kg != null) {
              pCurr.gmd = Number(((pCurr.peso_kg - pPrev.peso_kg) / diffDias).toFixed(3));
            } else {
              pCurr.gmd = null;
            }
          } else {
            animal.pesajes[0].gmd = null;
          }
        }
      }
    } catch (_) {
      animal.pesajes = [];
    }

    // Rendimiento a la canal: (peso canal / peso vivo de salida o último) * 100
    animal.rendimiento_canal_pct = null;
    animal.ultimo_peso_vivo = null;
    if (animal.liquidacion_canal && animal.pesajes && animal.pesajes.length > 0) {
      const pSalida = animal.pesajes.slice().reverse().find(p => p.tipo === "Salida") || animal.pesajes[animal.pesajes.length - 1];
      if (pSalida && pSalida.peso_kg > 0 && animal.liquidacion_canal.peso_canal_kg > 0) {
        animal.rendimiento_canal_pct = Number(
          ((animal.liquidacion_canal.peso_canal_kg / pSalida.peso_kg) * 100).toFixed(1)
        );
        animal.ultimo_peso_vivo = pSalida.peso_kg;
      }
    }

    // Historial de tratamientos veterinarios y detección de alerta de retirada activa
    try {
      animal.tratamientos = this.ejecutarQuery(
        "SELECT * FROM tratamientos WHERE crotal = ? ORDER BY fecha_inicio DESC, id DESC",
        [crotal]
      );
      const hoyIso = new Date().toISOString().slice(0, 10);
      animal.alerta_retirada = (animal.tratamientos || []).find(t => {
        let fin = t.fecha_fin_retirada;
        if (!fin && Number(t.dias_retirada) > 0) {
          const baseStr = t.fecha_fin || t.fecha_inicio;
          if (baseStr) {
            const d = new Date(baseStr);
            d.setDate(d.getDate() + Number(t.dias_retirada));
            fin = d.toISOString().slice(0, 10);
            t.fecha_fin_retirada = fin;
          }
        } else if (!fin) {
          fin = t.fecha_fin;
        }
        return t.fecha_inicio <= hoyIso && fin && fin >= hoyIso;
      }) || null;
    } catch (_) {
      animal.tratamientos = [];
      animal.alerta_retirada = null;
    }

    return animal;
  }

  registrarPesaje({ crotal, fecha, peso_kg, tipo = "Control", notas = null, operador = "Álvaro" }) {
    if (!this.db) throw new Error("Base de datos no inicializada");
    const fStr = fecha || new Date().toISOString().slice(0, 10);
    const sql = `
      INSERT INTO pesajes (crotal, fecha, peso_kg, tipo, notas, operador)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    this.ejecutarQuery(sql, [crotal, fStr, Number(peso_kg), tipo, notas, operador]);
    try {
      const data = this.db.export();
      guardarBaseDatosLocal(data.buffer);
    } catch (e) {
      console.warn("[DB] Advertencia persistiendo en IndexedDB:", e);
    }
    return true;
  }


  obtenerLotes() {
    return this.ejecutarQuery(`
      SELECT 
        COALESCE(NULLIF(TRIM(corral), ''), 'Sin lote asignado') as nombre_lote,
        COUNT(*) as total
      FROM animales
      WHERE estado = 'A'
      GROUP BY corral
      ORDER BY total DESC, nombre_lote ASC
    `);
  }

  obtenerAnimalesDeLote(lote) {
    const cond = lote === "Sin lote asignado" 
      ? "(corral IS NULL OR TRIM(corral) = '')"
      : "corral = ?";
    const params = lote === "Sin lote asignado" ? [] : [lote];

    return this.ejecutarQuery(`
      SELECT crotal, crotal_4, nombre, sexo, raza, estado, corral, fecha_ult_parto, total_partos, fecha_nacimiento
      FROM animales
      WHERE estado = 'A' AND ${cond}
      ORDER BY crotal_4 ASC
    `, params);
  }

  obtenerUltimosPartos(limite = 40) {
    return this.ejecutarQuery(`
      SELECT p.*, a.crotal_4 as madre_crotal_4, a.corral, a.raza
      FROM partos p
      LEFT JOIN animales a ON p.madre_crotal = a.crotal
      ORDER BY p.fecha_parto DESC
      LIMIT ?
    `, [limite]);
  }

  obtenerRecetas(filtro = "") {
    let rows;
    if (!filtro || filtro.trim() === "") {
      rows = this.ejecutarQuery(`
        SELECT id, fecha, receta, medicamento, unidades, dosis_unitaria, n_animales, veterinario, tiempo_carne, proveedor
        FROM recetas
        ORDER BY fecha DESC
        LIMIT 80
      `);
    } else {
      const f = `%${filtro.trim()}%`;
      rows = this.ejecutarQuery(`
        SELECT id, fecha, receta, medicamento, unidades, dosis_unitaria, n_animales, veterinario, tiempo_carne, proveedor
        FROM recetas
        WHERE receta LIKE ? OR medicamento LIKE ? OR veterinario LIKE ?
        ORDER BY fecha DESC
        LIMIT 80
      `, [f, f, f]);
    }

    return (rows || []).map((r) => {
      let u = r.unidades != null ? Number(r.unidades) : 0;
      let d = r.dosis_unitaria != null ? Number(r.dosis_unitaria) : 0;
      // Blindaje contra artefactos de escalado Jet Currency (x10.000)
      if (u >= 10000 && (u % 5000 === 0 || u % 10000 === 0)) {
        u = Math.round((u / 10000) * 100) / 100;
      }
      if (d >= 10000 && (d % 5000 === 0 || d % 10000 === 0)) {
        d = Math.round((d / 10000) * 100) / 100;
      }
      let nAnim = r.n_animales != null ? Number(r.n_animales) : null;
      if (d > 0 && u > 0) {
        nAnim = Math.max(1, Math.round(u / d));
      } else if (nAnim == null || nAnim > 500 || d === 0) {
        nAnim = null; // No inventar cabezas de ganado si no hay dosis individual
      }
      return {
        ...r,
        unidades: u,
        dosis_unitaria: d,
        n_animales: nAnim
      };
    });
  }

  obtenerComprasAlimento(filtro = "") {
    const selectCols = `
      id, fecha, alimento, kg,
      CASE 
        WHEN importe > 1000000 AND kg > 0 THEN ROUND(importe / 100000.0, 2)
        WHEN kg > 0 AND (importe / kg) BETWEEN 100 AND 1000 THEN ROUND(kg * ((importe / kg) / 1000.0), 2)
        ELSE importe
      END as importe,
      CASE 
        WHEN precio_kg > 1000 AND kg > 0 THEN ROUND(precio_kg / 100000.0, 4)
        WHEN precio_kg BETWEEN 100 AND 1000 THEN ROUND(precio_kg / 1000.0, 4)
        ELSE precio_kg
      END as precio_kg,
      albaran, proveedor, pagado
    `;
    if (!filtro || filtro.trim() === "") {
      return this.ejecutarQuery(`
        SELECT ${selectCols}
        FROM compras_alimento
        ORDER BY fecha DESC
        LIMIT 100
      `);
    }
    const f = `%${filtro.trim()}%`;
    return this.ejecutarQuery(`
      SELECT ${selectCols}
      FROM compras_alimento
      WHERE alimento LIKE ? OR proveedor LIKE ? OR albaran LIKE ?
      ORDER BY fecha DESC
      LIMIT 100
    `, [f, f, f]);
  }

  tieneTablaVentas() {
    if (this._tieneVentas !== undefined) return this._tieneVentas;
    try {
      const res = this.ejecutarQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ventas_canales'");
      this._tieneVentas = !!(res && res.length > 0);
    } catch (_) {
      this._tieneVentas = false;
    }
    return this._tieneVentas;
  }

  obtenerLiquidaciones(filtro = "") {
    try {
      if (!filtro || filtro.trim() === "") {
        return this.ejecutarQuery(`
          SELECT id, numero_factura, fecha_factura, fecha_pago, cliente_cooperativa,
                 total_cabezas, total_kilos_canal, base_imponible, porcentaje_iva, cuota_iva,
                 gastos_total, total_factura, archivo_origen
          FROM ventas_liquidaciones
          ORDER BY fecha_factura DESC, id DESC
        `) || [];
      }
      const f = `%${filtro.trim()}%`;
      return this.ejecutarQuery(`
        SELECT id, numero_factura, fecha_factura, fecha_pago, cliente_cooperativa,
               total_cabezas, total_kilos_canal, base_imponible, porcentaje_iva, cuota_iva,
               gastos_total, total_factura, archivo_origen
        FROM ventas_liquidaciones
        WHERE COALESCE(numero_factura, '') LIKE ? 
           OR COALESCE(cliente_cooperativa, '') LIKE ? 
           OR COALESCE(fecha_factura, '') LIKE ?
        ORDER BY fecha_factura DESC, id DESC
      `, [f, f, f]) || [];
    } catch (_) {
      return [];
    }
  }

  obtenerDetalleLiquidacion(facturaId) {
    try {
      const facts = this.ejecutarQuery(
        "SELECT * FROM ventas_liquidaciones WHERE id = ?",
        [facturaId]
      );
      if (!facts || facts.length === 0) return null;
      const factura = facts[0];

      factura.canales = this.ejecutarQuery(`
        SELECT c.*, a.crotal_4, a.raza, a.sexo as sexo_animal
        FROM ventas_canales c
        LEFT JOIN animales a ON c.crotal_asignado = a.crotal
        WHERE c.factura_id = ?
        ORDER BY c.linea_numero ASC
      `, [facturaId]) || [];

      factura.gastos = this.ejecutarQuery(
        "SELECT * FROM ventas_gastos WHERE factura_id = ? ORDER BY id ASC",
        [facturaId]
      ) || [];

      return factura;
    } catch (_) {
      return null;
    }
  }

  obtenerResumenKpisLiquidaciones() {
    try {
      const row = this.ejecutarQuery(`
        SELECT 
          COUNT(DISTINCT id) as total_facturas,
          COALESCE(SUM(total_factura), 0) as total_importe,
          COALESCE(SUM(total_cabezas), 0) as total_cabezas,
          COALESCE(SUM(total_kilos_canal), 0) as total_kilos
        FROM ventas_liquidaciones
      `);
      const canalStats = this.ejecutarQuery(`
        SELECT 
          ROUND(AVG(peso_canal_kg), 1) as peso_medio,
          ROUND(AVG(precio_unitario), 2) as precio_medio,
          COUNT(*) as total_canales_pesadas
        FROM ventas_canales
        WHERE peso_canal_kg > 1
      `);
      const base = (row && row.length > 0) ? row[0] : {};
      const stats = (canalStats && canalStats.length > 0) ? canalStats[0] : {};
      return {
        total_facturas: Number(base.total_facturas || 0),
        total_importe: Number(base.total_importe || 0),
        total_cabezas: Number(base.total_cabezas || 0),
        total_kilos: Number(base.total_kilos || 0),
        peso_medio: Number(stats.peso_medio || 0),
        precio_medio: Number(stats.precio_medio || 0),
        total_canales_pesadas: Number(stats.total_canales_pesadas || 0)
      };
    } catch (_) {
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
  }

  obtenerAniosDisponiblesFinancieros() {
    try {
      const anios = this.ejecutarQuery(`
        SELECT DISTINCT anio FROM (
          SELECT substr(fecha_factura, 1, 4) as anio FROM ventas_liquidaciones WHERE fecha_factura IS NOT NULL AND length(fecha_factura) >= 4
          UNION
          SELECT substr(fecha, 1, 4) as anio FROM movimientos WHERE tipo IN ('S', 'V', 'SALIDA', 'VENTA') AND fecha >= '2020-01-01'
          UNION
          SELECT substr(fecha, 1, 4) as anio FROM compras_alimento WHERE fecha >= '2020-01-01'
        ) WHERE anio IS NOT NULL AND length(anio) = 4
        ORDER BY anio DESC
      `);
      const lista = (anios || []).map(r => r.anio);
      return lista.length > 0 ? lista : [new Date().getFullYear().toString()];
    } catch (_) {
      return [new Date().getFullYear().toString()];
    }
  }

  obtenerResumenFinancieroGlobal(anio = null, categoria = null, usarEstimaciones = false) {
    try {
      let whereVentas = "1=1";
      let whereCompras = "1=1";
      let whereCanales = "1=1";
      let whereMov = "m.tipo IN ('S', 'V', 'SALIDA', 'VENTA')";
      const paramsVentas = [];
      const paramsCompras = [];
      const paramsCanales = [];
      const paramsMov = [];

      if (anio && anio !== "TODOS") {
        whereVentas += " AND substr(fecha_factura, 1, 4) = ?";
        paramsVentas.push(String(anio));
        whereCompras += " AND substr(fecha, 1, 4) = ?";
        paramsCompras.push(String(anio));
        whereCanales += " AND substr(COALESCE(c.fecha_salida_lote, f.fecha_factura), 1, 4) = ?";
        paramsCanales.push(String(anio));
        whereMov += " AND substr(m.fecha, 1, 4) = ?";
        paramsMov.push(String(anio));
      }

      if (categoria && categoria !== "TODOS") {
        if (categoria === "CEBO") {
          whereCanales += " AND (c.articulo LIKE '%TERNER%' OR c.articulo LIKE '%CEBO%' OR c.articulo LIKE '%AÑOJO%')";
          whereCompras += " AND (alimento LIKE '%CEBO%' OR alimento LIKE '%T-1%' OR alimento LIKE '%T-2%' OR alimento LIKE '%T-3%' OR alimento LIKE '%CRECIMIENTO%' OR alimento LIKE '%ARRANQUE%' OR alimento LIKE '%BOVITER%' OR alimento LIKE '%BIONA%' OR alimento LIKE '%CEBITER%')";
        } else if (categoria === "DESVIEJE") {
          whereCanales += " AND (c.articulo LIKE '%VACAS%' OR c.articulo LIKE '%TOROS%' OR c.articulo LIKE '%DESVIEJE%')";
          whereCompras += " AND (alimento LIKE '%PAJA%' OR alimento LIKE '%FORRAJE%')";
        }
      }

      // 1. Resumen de facturas de carne cargadas
      const resVentas = this.ejecutarQuery(`
        SELECT 
          COUNT(DISTINCT id) as total_facturas,
          COALESCE(SUM(total_factura), 0) as ingresos_totales,
          COALESCE(SUM(base_imponible), 0) as base_imponible_total,
          COALESCE(SUM(total_cabezas), 0) as total_cabezas,
          COALESCE(SUM(total_kilos_canal), 0) as total_kilos_canal,
          COALESCE(SUM(gastos_total), 0) as total_deducciones
        FROM ventas_liquidaciones
        WHERE ${whereVentas}
      `, paramsVentas);
      const v = (resVentas && resVentas.length > 0) ? resVentas[0] : {};

      // 2. Resumen de canales (sin descartar lotes sin peso individual en el WHERE principal)
      const resCanales = this.ejecutarQuery(`
        SELECT 
          COUNT(*) as canales_contadas,
          COALESCE(SUM(c.cabezas), 0) as cabezas_canales,
          COALESCE(SUM(CASE WHEN c.peso_canal_kg > 1 THEN c.peso_canal_kg ELSE 0 END), 0) as kg_canales,
          COALESCE(SUM(c.importe_linea), 0) as importe_canales,
          ROUND(COALESCE(SUM(CASE WHEN c.peso_canal_kg > 1 THEN c.importe_linea ELSE 0 END) / NULLIF(SUM(CASE WHEN c.peso_canal_kg > 1 THEN c.peso_canal_kg ELSE 0 END), 0), 0), 3) as precio_medio_canal,
          ROUND(COALESCE(AVG(CASE WHEN c.peso_canal_kg > 1 THEN c.peso_canal_kg ELSE NULL END), 0), 1) as peso_medio_canal
        FROM ventas_canales c
        LEFT JOIN ventas_liquidaciones f ON c.factura_id = f.id
        WHERE ${whereCanales}
      `, paramsCanales);
      const c = (resCanales && resCanales.length > 0) ? resCanales[0] : {};

      // 3. Resumen de compras de pienso (con saneamiento defensivo contra escalas anómalas)
      const resCompras = this.ejecutarQuery(`
        SELECT 
          COUNT(*) as total_compras,
          COALESCE(SUM(
            CASE 
              WHEN importe > 1000000 AND kg > 0 THEN importe / 100000.0
              WHEN kg > 0 AND (importe / kg) BETWEEN 100 AND 1000 THEN kg * ((importe / kg) / 1000.0)
              ELSE importe
            END
          ), 0) as gasto_pienso,
          COALESCE(SUM(kg), 0) as kg_pienso,
          ROUND(COALESCE(SUM(
            CASE 
              WHEN importe > 1000000 AND kg > 0 THEN importe / 100000.0
              WHEN kg > 0 AND (importe / kg) BETWEEN 100 AND 1000 THEN kg * ((importe / kg) / 1000.0)
              ELSE importe
            END
          ) / NULLIF(SUM(kg), 0), 0), 4) as coste_medio_kg
        FROM compras_alimento
        WHERE ${whereCompras}
      `, paramsCompras);
      const alim = (resCompras && resCompras.length > 0) ? resCompras[0] : {};

      let ingresosCarne = (categoria && categoria !== "TODOS") 
        ? Number(c.importe_canales || 0)
        : Number(v.base_imponible_total || c.importe_canales || 0);

      let totalCabezasCarne = (categoria && categoria !== "TODOS")
        ? Number(c.cabezas_canales || 0)
        : Number(v.total_cabezas || c.cabezas_canales || 0);

      let totalKilosCanal = Number(c.kg_canales || v.total_kilos_canal || 0);
      let cotizacionMediaCanal = Number(c.precio_medio_canal || 0);
      let pesoMedioCanal = Number(c.peso_medio_canal || 0);

      let gastoPienso = Number(alim.gasto_pienso || 0);
      let kilosPienso = Number(alim.kg_pienso || 0);
      let costeKgPienso = Number(alim.coste_medio_kg || 0);

      // 4. Salidas de ganado en movimientos sin factura de liquidación
      const crotalesConFactura = new Set(
        (this.ejecutarQuery(`
          SELECT DISTINCT c.crotal_asignado 
          FROM ventas_canales c
          LEFT JOIN ventas_liquidaciones f ON c.factura_id = f.id
          WHERE c.crotal_asignado IS NOT NULL AND ${whereCanales}
        `, paramsCanales) || []).map(r => r.crotal_asignado)
      );

      const salidasCenso = this.ejecutarQuery(`
        SELECT m.fecha, m.crotal, a.sexo,
               ROUND(julianday(m.fecha) - julianday(a.fecha_nacimiento)) as edad_dias
        FROM movimientos m
        LEFT JOIN animales a ON m.crotal = a.crotal
        WHERE ${whereMov}
        ORDER BY m.fecha
      `, paramsMov) || [];

      const salidasSinFactura = salidasCenso.filter(s => {
        if (crotalesConFactura.has(s.crotal)) return false;
        const esDesvieje = (s.edad_dias || 0) > 730;
        if (categoria === "CEBO" && esDesvieje) return false;
        if (categoria === "DESVIEJE" && !esDesvieje) return false;
        return true;
      });

      // 5. Reconstrucción con Lonja si usarEstimaciones === true
      let ingresosEstimadosLonja = 0;
      let kgEstimadosLonja = 0;
      let cabezasEstimadasLonja = 0;

      if (usarEstimaciones && salidasSinFactura.length > 0 && this.tieneTablaLonja()) {
        salidasSinFactura.forEach(s => {
          const esDesvieje = (s.edad_dias || 0) > 730;
          const catLonja = esDesvieje ? 'VACA_DESVIEJE' : (((s.sexo || '').toUpperCase().startsWith('M')) ? 'AÑOJO_EXTRA' : 'TERNERA_EXTRA');
          const kgEst = esDesvieje ? 360.0 : (((s.sexo || '').toUpperCase().startsWith('M')) ? 290.0 : 235.0);

          const cotiz = this.ejecutarQuery(`
            SELECT precio FROM cotizaciones_lonja 
            WHERE categoria = ? AND fecha <= ? 
            ORDER BY fecha DESC LIMIT 1
          `, [catLonja, s.fecha]);

          const precioKg = (cotiz && cotiz.length > 0 && cotiz[0].precio > 0) 
            ? Number(cotiz[0].precio) 
            : (esDesvieje ? 3.80 : 6.50);

          ingresosEstimadosLonja += (kgEst * precioKg);
          kgEstimadosLonja += kgEst;
          cabezasEstimadasLonja += 1;
        });

        ingresosCarne += ingresosEstimadosLonja;
        totalKilosCanal += kgEstimadosLonja;
        totalCabezasCarne += cabezasEstimadasLonja;

        if (totalKilosCanal > 0) {
          cotizacionMediaCanal = Number((ingresosCarne / totalKilosCanal).toFixed(2));
        }
        if (totalCabezasCarne > 0) {
          pesoMedioCanal = Number((totalKilosCanal / totalCabezasCarne).toFixed(1));
        }
      }

      // Estimación de coste de pienso cuando hay kg registrados con importe 0 (ej. histórico 2023-2024)
      if (usarEstimaciones && gastoPienso === 0 && kilosPienso > 0 && this.tieneTablaLonja()) {
        const cotizPienso = this.ejecutarQuery(`
          SELECT ROUND(AVG(precio) / 1000, 4) as p_kg FROM cotizaciones_lonja WHERE categoria = 'PIENSO_CEBO'
        `);
        const pKg = (cotizPienso && cotizPienso.length > 0 && cotizPienso[0].p_kg > 0) ? Number(cotizPienso[0].p_kg) : 0.315;
        gastoPienso = Number((kilosPienso * pKg).toFixed(2));
        costeKgPienso = pKg;
      }

      const costeTPienso = Number((costeKgPienso * 1000).toFixed(1));
      const margenBruto = ingresosCarne - gastoPienso;
      const ratioCarnePienso = gastoPienso > 0 ? Number((ingresosCarne / gastoPienso).toFixed(2)) : null;

      // 6. Desglose por categorías (Cebo vs Desvieje)
      const desgloseCat = this.ejecutarQuery(`
        SELECT 
          CASE 
            WHEN c.articulo LIKE '%VACAS%' OR c.articulo LIKE '%TOROS%' OR c.articulo LIKE '%DESVIEJE%' THEN 'Desvieje'
            WHEN c.articulo LIKE '%TERNER%' OR c.articulo LIKE '%AÑOJO%' OR c.articulo LIKE '%CEBO%' THEN 'Cebo'
            ELSE 'Otros'
          END as categoria_tipo,
          COUNT(*) as total_canales,
          COALESCE(SUM(CASE WHEN c.peso_canal_kg > 1 THEN c.peso_canal_kg ELSE 0 END), 0) as kg_total,
          COALESCE(SUM(c.importe_linea), 0) as importe_total,
          ROUND(COALESCE(SUM(CASE WHEN c.peso_canal_kg > 1 THEN c.importe_linea ELSE 0 END) / NULLIF(SUM(CASE WHEN c.peso_canal_kg > 1 THEN c.peso_canal_kg ELSE 0 END), 0), 0), 2) as precio_medio_kg,
          ROUND(COALESCE(AVG(CASE WHEN c.peso_canal_kg > 1 THEN c.peso_canal_kg ELSE NULL END), 0), 1) as peso_medio
        FROM ventas_canales c
        LEFT JOIN ventas_liquidaciones f ON c.factura_id = f.id
        WHERE ${whereCanales}
        GROUP BY categoria_tipo
        ORDER BY importe_total DESC
      `, paramsCanales);

      return {
        anio_filtro: anio || "TODOS",
        categoria_filtro: categoria || "TODOS",
        total_facturas: Number(v.total_facturas || 0),
        ingresos_carne: Number(ingresosCarne.toFixed(2)),
        base_imponible_carne: Number(v.base_imponible_total || 0),
        total_cabezas_carne: totalCabezasCarne,
        total_kilos_canal: Number(totalKilosCanal.toFixed(1)),
        cotizacion_media_canal: cotizacionMediaCanal,
        peso_medio_canal: pesoMedioCanal,
        total_deducciones_coop: Number(v.total_deducciones || 0),
        total_compras_pienso: Number(alim.total_compras || 0),
        gasto_pienso: Number(gastoPienso.toFixed(2)),
        kilos_pienso: kilosPienso,
        coste_medio_pienso_kg: costeKgPienso,
        coste_medio_pienso_t: costeTPienso,
        margen_bruto_alimentacion: Number(margenBruto.toFixed(2)),
        ratio_carne_pienso: ratioCarnePienso,
        desglose_categorias: desgloseCat || [],
        usar_estimaciones: Boolean(usarEstimaciones),
        salidas_sin_factura: salidasSinFactura.length,
        salidas_estimadas: cabezasEstimadasLonja,
        ingresos_estimados: Number(ingresosEstimadosLonja.toFixed(2))
      };
    } catch (e) {
      console.error("[DB] Error en obtenerResumenFinancieroGlobal:", e);
      return {
        ingresos_carne: 0,
        gasto_pienso: 0,
        margen_bruto_alimentacion: 0,
        ratio_carne_pienso: null,
        desglose_categorias: []
      };
    }
  }

  obtenerSerieMensualFinanciera(anio = null, categoria = null, usarEstimaciones = false) {
    try {
      let whereVentas = "f.fecha_factura IS NOT NULL";
      let whereCompras = "fecha IS NOT NULL";
      let whereMov = "m.tipo IN ('S', 'V', 'SALIDA', 'VENTA') AND m.fecha IS NOT NULL";
      const paramsVentas = [];
      const paramsCompras = [];
      const paramsMov = [];

      if (anio && anio !== "TODOS") {
        whereVentas += " AND substr(f.fecha_factura, 1, 4) = ?";
        paramsVentas.push(String(anio));
        whereCompras += " AND substr(fecha, 1, 4) = ?";
        paramsCompras.push(String(anio));
        whereMov += " AND substr(m.fecha, 1, 4) = ?";
        paramsMov.push(String(anio));
      }

      if (categoria && categoria !== "TODOS") {
        if (categoria === "CEBO") {
          whereCompras += " AND (alimento LIKE '%CEBO%' OR alimento LIKE '%T-1%' OR alimento LIKE '%T-2%' OR alimento LIKE '%T-3%' OR alimento LIKE '%CRECIMIENTO%' OR alimento LIKE '%ARRANQUE%' OR alimento LIKE '%BOVITER%' OR alimento LIKE '%BIONA%' OR alimento LIKE '%CEBITER%')";
        } else if (categoria === "DESVIEJE") {
          whereCompras += " AND (alimento LIKE '%PAJA%' OR alimento LIKE '%FORRAJE%')";
        }
      }

      let sqlVentas = "";
      if (categoria && categoria !== "TODOS") {
        let catCanales = "";
        if (categoria === "CEBO") {
          catCanales = " AND (c.articulo LIKE '%TERNER%' OR c.articulo LIKE '%CEBO%' OR c.articulo LIKE '%AÑOJO%')";
        } else if (categoria === "DESVIEJE") {
          catCanales = " AND (c.articulo LIKE '%VACAS%' OR c.articulo LIKE '%TOROS%' OR c.articulo LIKE '%DESVIEJE%')";
        }
        sqlVentas = `
          SELECT 
            substr(f.fecha_factura, 1, 7) as mes,
            COALESCE(SUM(c.importe_linea), 0) as ingresos,
            COALESCE(SUM(c.cabezas), 0) as cabezas,
            COALESCE(SUM(CASE WHEN c.peso_canal_kg > 1 THEN c.peso_canal_kg ELSE 0 END), 0) as kg_canal
          FROM ventas_canales c
          JOIN ventas_liquidaciones f ON c.factura_id = f.id
          WHERE ${whereVentas} ${catCanales}
          GROUP BY mes
        `;
      } else {
        sqlVentas = `
          SELECT 
            substr(f.fecha_factura, 1, 7) as mes,
            COALESCE(SUM(f.base_imponible), 0) as ingresos,
            COALESCE(SUM(f.total_cabezas), 0) as cabezas,
            COALESCE(SUM(f.total_kilos_canal), 0) as kg_canal
          FROM ventas_liquidaciones f
          WHERE ${whereVentas}
          GROUP BY mes
        `;
      }

      const rowsVentas = this.ejecutarQuery(sqlVentas, paramsVentas);

      const rowsCompras = this.ejecutarQuery(`
        SELECT 
          substr(fecha, 1, 7) as mes,
          COALESCE(SUM(
            CASE 
              WHEN importe > 1000000 AND kg > 0 THEN importe / 100000.0
              WHEN kg > 0 AND (importe / kg) BETWEEN 100 AND 1000 THEN kg * ((importe / kg) / 1000.0)
              ELSE importe
            END
          ), 0) as gasto,
          COALESCE(SUM(kg), 0) as kg_pienso
        FROM compras_alimento
        WHERE ${whereCompras}
        GROUP BY mes
      `, paramsCompras);

      // Salidas de ganado registradas en censo por mes
      const salidasMes = this.ejecutarQuery(`
        SELECT substr(m.fecha, 1, 7) as mes,
               m.fecha, m.crotal, a.sexo,
               ROUND(julianday(m.fecha) - julianday(a.fecha_nacimiento)) as edad_dias
        FROM movimientos m
        LEFT JOIN animales a ON m.crotal = a.crotal
        WHERE ${whereMov}
        ORDER BY m.fecha
      `, paramsMov) || [];

      // Agrupar salidas del censo por mes
      const salidasPorMes = new Map();
      salidasMes.forEach(s => {
        const esDesvieje = (s.edad_dias || 0) > 730;
        if (categoria === "CEBO" && esDesvieje) return;
        if (categoria === "DESVIEJE" && !esDesvieje) return;

        if (!salidasPorMes.has(s.mes)) {
          salidasPorMes.set(s.mes, []);
        }
        salidasPorMes.get(s.mes).push(s);
      });

      const mapaMeses = new Map();

      (rowsVentas || []).forEach(r => {
        if (!r.mes) return;
        mapaMeses.set(r.mes, {
          mes: r.mes,
          ingresos_carne: Number(r.ingresos || 0),
          cabezas: Number(r.cabezas || 0),
          kg_canal: Number(r.kg_canal || 0),
          gasto_pienso: 0,
          kg_pienso: 0,
          esReal: Number(r.ingresos || 0) > 0,
          estimado: false,
          facturas_pendientes: false
        });
      });

      (rowsCompras || []).forEach(r => {
        if (!r.mes) return;
        if (!mapaMeses.has(r.mes)) {
          mapaMeses.set(r.mes, {
            mes: r.mes,
            ingresos_carne: 0,
            cabezas: 0,
            kg_canal: 0,
            gasto_pienso: Number(r.gasto || 0),
            kg_pienso: Number(r.kg_pienso || 0),
            esReal: false,
            estimado: false,
            facturas_pendientes: false
          });
        } else {
          const item = mapaMeses.get(r.mes);
          item.gasto_pienso = Number(r.gasto || 0);
          item.kg_pienso = Number(r.kg_pienso || 0);
        }
      });

      // Incorporar meses con salidas de ganado en censo
      salidasPorMes.forEach((listaSalidas, mes) => {
        if (!mapaMeses.has(mes)) {
          mapaMeses.set(mes, {
            mes,
            ingresos_carne: 0,
            cabezas: listaSalidas.length,
            kg_canal: 0,
            gasto_pienso: 0,
            kg_pienso: 0,
            esReal: false,
            estimado: false,
            facturas_pendientes: true,
            salidas_censo: listaSalidas.length
          });
        } else {
          const item = mapaMeses.get(mes);
          item.salidas_censo = listaSalidas.length;
          if (item.ingresos_carne === 0 && listaSalidas.length > 0) {
            item.facturas_pendientes = true;
          }
        }
      });

      // Si usarEstimaciones === true, estimar ingresos con Lonja para meses sin facturas cargadas
      if (usarEstimaciones && this.tieneTablaLonja()) {
        mapaMeses.forEach(item => {
          if (item.ingresos_carne === 0 && item.salidas_censo > 0) {
            const salidasDelMes = salidasPorMes.get(item.mes) || [];
            let ingresosEstMes = 0;
            let kgEstMes = 0;

            salidasDelMes.forEach(s => {
              const esDesvieje = (s.edad_dias || 0) > 730;
              const catLonja = esDesvieje ? 'VACA_DESVIEJE' : (((s.sexo || '').toUpperCase().startsWith('M')) ? 'AÑOJO_EXTRA' : 'TERNERA_EXTRA');
              const kgEst = esDesvieje ? 360.0 : (((s.sexo || '').toUpperCase().startsWith('M')) ? 290.0 : 235.0);

              const cotiz = this.ejecutarQuery(`
                SELECT precio FROM cotizaciones_lonja 
                WHERE categoria = ? AND fecha <= ? 
                ORDER BY fecha DESC LIMIT 1
              `, [catLonja, s.fecha]);

              const precioKg = (cotiz && cotiz.length > 0 && cotiz[0].precio > 0) 
                ? Number(cotiz[0].precio) 
                : (esDesvieje ? 3.80 : 6.50);

              ingresosEstMes += (kgEst * precioKg);
              kgEstMes += kgEst;
            });

            if (ingresosEstMes > 0) {
              item.ingresos_carne = Number(ingresosEstMes.toFixed(2));
              item.kg_canal = Number(kgEstMes.toFixed(1));
              item.cabezas = salidasDelMes.length;
              item.estimado = true;
              item.esReal = false;
              item.facturas_pendientes = false;
            }
          }

          // Estimar gasto de pienso si hay kg con importe 0
          if (item.gasto_pienso === 0 && item.kg_pienso > 0) {
            const cotizPienso = this.ejecutarQuery(`
              SELECT ROUND(AVG(precio) / 1000, 4) as p_kg FROM cotizaciones_lonja WHERE categoria = 'PIENSO_CEBO'
            `);
            const pKg = (cotizPienso && cotizPienso.length > 0 && cotizPienso[0].p_kg > 0) ? Number(cotizPienso[0].p_kg) : 0.315;
            item.gasto_pienso = Number((item.kg_pienso * pKg).toFixed(2));
            item.gasto_estimado = true;
          }
        });
      }

      const rowsPreciosCanal = this.ejecutarQuery(`
        SELECT 
          substr(COALESCE(c.fecha_salida_lote, f.fecha_factura), 1, 7) as mes,
          ROUND(COALESCE(SUM(c.importe_linea) / NULLIF(SUM(c.peso_canal_kg), 0), 0), 2) as precio_medio_canal
        FROM ventas_canales c
        JOIN ventas_liquidaciones f ON c.factura_id = f.id
        WHERE c.peso_canal_kg > 1 AND f.fecha_factura IS NOT NULL
        GROUP BY mes
      `);

      const mapaPrecios = new Map();
      (rowsPreciosCanal || []).forEach(p => {
        if (p.mes) mapaPrecios.set(p.mes, Number(p.precio_medio_canal || 0));
      });

      const mesesOrdenados = Array.from(mapaMeses.values()).sort((a, b) => a.mes.localeCompare(b.mes));

      return mesesOrdenados.map(m => {
        const margen = m.ingresos_carne - m.gasto_pienso;
        const precioCanal = mapaPrecios.get(m.mes) || (m.kg_canal > 0 ? Number((m.ingresos_carne / m.kg_canal).toFixed(2)) : null);
        const precioPienso = m.kg_pienso > 0 ? Number((m.gasto_pienso / m.kg_pienso).toFixed(3)) : null;

        return {
          ...m,
          margen_mes: Number(margen.toFixed(2)),
          margen_neto: Number(margen.toFixed(2)),
          precio_canal_medio: precioCanal,
          precio_pienso_medio: precioPienso
        };
      });
    } catch (e) {
      console.error("[DB] Error en obtenerSerieMensualFinanciera:", e);
      return [];
    }
  }

  obtenerMargenTecnicoCebo(anio = null, categoria = null, usarEstimaciones = false) {
    try {
      let whereCanales = "c.peso_canal_kg > 1";
      const params = [];

      if (anio && anio !== "TODOS") {
        whereCanales += " AND substr(COALESCE(c.fecha_salida_lote, f.fecha_factura), 1, 4) = ?";
        params.push(String(anio));
      }

      if (categoria && categoria !== "TODOS") {
        if (categoria === "CEBO") {
          whereCanales += " AND (c.articulo LIKE '%TERNER%' OR c.articulo LIKE '%CEBO%' OR c.articulo LIKE '%AÑOJO%')";
        } else if (categoria === "DESVIEJE") {
          whereCanales += " AND (c.articulo LIKE '%VACAS%' OR c.articulo LIKE '%TOROS%' OR c.articulo LIKE '%DESVIEJE%')";
        }
      }

      const rows = this.ejecutarQuery(`
        SELECT 
          c.id as canal_id,
          c.crotal_asignado,
          c.articulo,
          c.peso_canal_kg,
          c.precio_unitario,
          c.importe_linea,
          COALESCE(c.fecha_salida_lote, f.fecha_factura) as fecha_sacrificio,
          f.numero_factura,
          f.cliente_cooperativa
        FROM ventas_canales c
        JOIN ventas_liquidaciones f ON c.factura_id = f.id
        WHERE ${whereCanales}
        ORDER BY fecha_sacrificio DESC
      `, params);

      if (!rows || rows.length === 0) {
        return {
          total_animales: 0,
          margen_tecnico_total: 0,
          margen_medio_cabeza: 0,
          coste_pienso_medio_cabeza: 0,
          estancia_media_dias: 0,
          prima_media_lonja_kg: 0,
          usar_estimaciones: usarEstimaciones,
          animales: []
        };
      }

      // Obtener precio medio real de piensos de cebo en la explotación si existen albaranes
      let precioPiensoRealExplotacion = null;
      try {
        const resAlim = this.ejecutarQuery(`
          SELECT ROUND(COALESCE(SUM(importe) / NULLIF(SUM(kg), 0), 0), 3) as precio_medio
          FROM compras_alimento
          WHERE alimento LIKE '%CEBO%' AND importe > 0 AND kg > 0
        `);
        if (resAlim && resAlim.length > 0 && resAlim[0].precio_medio > 0) {
          precioPiensoRealExplotacion = Number(resAlim[0].precio_medio);
        }
      } catch (_) {}

      let sumaMargen = 0;
      let sumaPienso = 0;
      let sumaDias = 0;
      let sumaPrimas = 0;
      let totalPrimasContadas = 0;

      const animalesDetalle = rows.map(r => {
        const crot = r.crotal_asignado;
        const fSacrificio = r.fecha_sacrificio || new Date().toISOString().slice(0, 10);
        const pCanal = Number(r.peso_canal_kg || 0);
        let precioUnit = Number(r.precio_unitario || 0);
        let importeLinea = Number(r.importe_linea || 0);
        let precioCarneEstimado = false;

        // 1. Obtener fecha de entrada a cebadero
        let diasCebo = 210; // Estándar de campo si no hay registro histórico
        if (crot) {
          const movEntrada = this.ejecutarQuery(`
            SELECT fecha FROM movimientos 
            WHERE crotal = ? AND (destino LIKE '%122' OR corral = 'CEBADERO' OR tipo = 'TRASPASO' OR tipo = 'T')
            ORDER BY fecha ASC LIMIT 1
          `, [crot]);
          if (movEntrada && movEntrada.length > 0 && movEntrada[0].fecha) {
            const d1 = new Date(movEntrada[0].fecha);
            const d2 = new Date(fSacrificio);
            const diffDias = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
            if (diffDias > 30 && diffDias < 600) {
              diasCebo = diffDias;
            }
          }
        }

        // 2. Cálculo zootécnico de devengo
        const esHembra = (r.articulo || "").toUpperCase().includes("TERNERA");
        const fcr = esHembra ? 4.8 : 5.0;
        const pesoDestete = esHembra ? 230.0 : 250.0;
        const rendimiento = esHembra ? 0.56 : 0.58;
        const pesoVivoEst = pCanal > 0 ? Number((pCanal / rendimiento).toFixed(1)) : 0;
        const gananciaPv = Math.max(0, Number((pesoVivoEst - pesoDestete).toFixed(1)));
        const kgPienso = Math.round(gananciaPv * fcr);

        // 3. Determinación de precio de pienso (€/kg)
        let precioPiensoKg = precioPiensoRealExplotacion || 0.315;
        let precioPiensoEstimado = !precioPiensoRealExplotacion;

        if (usarEstimaciones) {
          try {
            const resLonjaPienso = this.ejecutarQuery(`
              SELECT ROUND(precio / 1000, 3) as precio_kg FROM cotizaciones_lonja
              WHERE categoria = 'PIENSO_CEBO' AND fecha <= ?
              ORDER BY fecha DESC LIMIT 1
            `, [fSacrificio]);
            if (resLonjaPienso && resLonjaPienso.length > 0 && resLonjaPienso[0].precio_kg > 0) {
              precioPiensoKg = Number(resLonjaPienso[0].precio_kg);
              precioPiensoEstimado = true;
            }
          } catch (_) {}
        }

        const costePiensoImputado = Number((kgPienso * precioPiensoKg).toFixed(2));
        const gmdEst = diasCebo > 0 ? Number((gananciaPv / diasCebo).toFixed(2)) : 0;

        // 4. Cruce con Lonja de Salamanca
        const catLonja = esHembra ? "TERNERA_EXTRA" : (pCanal > 350 ? "AÑOJO_PESADO" : "AÑOJO_EXTRA");
        let precioLonja = null;
        let primaKg = null;
        let penalizacionSobrepeso = null;

        try {
          const resLonja = this.ejecutarQuery(`
            SELECT precio FROM cotizaciones_lonja
            WHERE categoria = ? AND fecha <= ?
            ORDER BY fecha DESC LIMIT 1
          `, [catLonja, fSacrificio]);

          if (resLonja && resLonja.length > 0) {
            precioLonja = Number(resLonja[0].precio);
          }
        } catch (_) {}

        // Reconstrucción de precio de carne si faltaba en la liquidación y las estimaciones están activas
        if ((precioUnit === 0 || isNaN(precioUnit) || importeLinea === 0) && precioLonja != null) {
          if (usarEstimaciones) {
            precioUnit = precioLonja;
            importeLinea = Number((pCanal * precioLonja).toFixed(2));
            precioCarneEstimado = true;
          }
        }

        if (precioLonja != null && precioUnit > 0) {
          primaKg = Number((precioUnit - precioLonja).toFixed(3));
          sumaPrimas += primaKg;
          totalPrimasContadas++;
        }

        const margenAnimal = Number((importeLinea - costePiensoImputado).toFixed(2));

        if (!esHembra && pCanal > 350.0) {
          penalizacionSobrepeso = {
            exceso_kg: Number((pCanal - 350.0).toFixed(1)),
            coste_penalizacion: Number(((pCanal - 350.0) * 0.45).toFixed(2))
          };
        }

        sumaMargen += margenAnimal;
        sumaPienso += costePiensoImputado;
        sumaDias += diasCebo;

        return {
          canal_id: r.canal_id,
          crotal: crot,
          crotal_4: crot ? (crot.replace(/\D/g, "").slice(-4) || crot.slice(-4)) : "—",
          articulo: r.articulo,
          numero_factura: r.numero_factura,
          fecha_sacrificio: fSacrificio,
          peso_canal_kg: pCanal,
          precio_unitario: precioUnit,
          importe_linea: importeLinea,
          dias_cebo: diasCebo,
          peso_vivo_estimado: pesoVivoEst,
          ganancia_peso_vivo: gananciaPv,
          gmd_estimada: gmdEst,
          kg_pienso_imputados: kgPienso,
          coste_pienso_imputado: costePiensoImputado,
          margen_tecnico: margenAnimal,
          precio_lonja_salamanca: precioLonja,
          prima_sobre_lonja_kg: primaKg,
          penalizacion_sobrepeso: penalizacionSobrepeso,
          es_estimado: Boolean(precioCarneEstimado || (usarEstimaciones && precioPiensoEstimado)),
          precio_carne_estimado: precioCarneEstimado,
          precio_pienso_estimado: precioPiensoEstimado,
          precio_pienso_kg: precioPiensoKg
        };
      });

      const n = animalesDetalle.length;
      return {
        total_animales: n,
        margen_tecnico_total: Number(sumaMargen.toFixed(2)),
        margen_medio_cabeza: n > 0 ? Number((sumaMargen / n).toFixed(2)) : 0,
        coste_pienso_medio_cabeza: n > 0 ? Number((sumaPienso / n).toFixed(2)) : 0,
        estancia_media_dias: n > 0 ? Math.round(sumaDias / n) : 0,
        prima_media_lonja_kg: totalPrimasContadas > 0 ? Number((sumaPrimas / totalPrimasContadas).toFixed(3)) : null,
        usar_estimaciones: usarEstimaciones,
        animales: animalesDetalle
      };
    } catch (e) {
      console.error("[DB] Error en obtenerMargenTecnicoCebo:", e);
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
  }

  obtenerRadarMateriasPrimas(anio = null, usarEstimaciones = false) {
    try {
      let whereLonja = "1=1";
      let whereAlim = "1=1";
      const paramsLonja = [];
      const paramsAlim = [];

      if (anio && anio !== "TODOS") {
        whereLonja += " AND substr(fecha, 1, 4) = ?";
        paramsLonja.push(String(anio));
        whereAlim += " AND substr(fecha, 1, 4) = ?";
        paramsAlim.push(String(anio));
      }

      // Cotizaciones mensuales Lonja de Salamanca (Cebada y Maíz en €/t)
      const rowsLonja = this.ejecutarQuery(`
        SELECT 
          substr(fecha, 1, 7) as mes,
          categoria,
          ROUND(AVG(precio), 1) as precio_medio_t
        FROM cotizaciones_lonja
        WHERE ${whereLonja} AND categoria IN ('CEBADA', 'MAIZ', 'PIENSO_CEBO')
        GROUP BY mes, categoria
        ORDER BY mes ASC
      `, paramsLonja);

      // Albaranes reales de pienso compuesto en la explotación (€/t)
      const rowsPienso = this.ejecutarQuery(`
        SELECT 
          substr(fecha, 1, 7) as mes,
          ROUND(COALESCE(SUM(importe) / NULLIF(SUM(kg), 0), 0) * 1000, 1) as precio_pienso_real_t,
          COALESCE(SUM(kg), 0) as kg_comprados
        FROM compras_alimento
        WHERE ${whereAlim} AND alimento LIKE '%CEBO%'
        GROUP BY mes
        ORDER BY mes ASC
      `, paramsAlim);

      const mapaMeses = new Map();

      (rowsLonja || []).forEach(r => {
        if (!r.mes) return;
        if (!mapaMeses.has(r.mes)) {
          mapaMeses.set(r.mes, {
            mes: r.mes,
            cebada_lonja_t: null,
            maiz_lonja_t: null,
            pienso_lonja_t: null,
            pienso_real_t: null,
            pienso_estimado: false,
            kg_comprados: 0
          });
        }
        const item = mapaMeses.get(r.mes);
        if (r.categoria === "CEBADA") item.cebada_lonja_t = Number(r.precio_medio_t);
        if (r.categoria === "MAIZ") item.maiz_lonja_t = Number(r.precio_medio_t);
        if (r.categoria === "PIENSO_CEBO") item.pienso_lonja_t = Number(r.precio_medio_t);
      });

      (rowsPienso || []).forEach(p => {
        if (!p.mes) return;
        if (!mapaMeses.has(p.mes)) {
          mapaMeses.set(p.mes, {
            mes: p.mes,
            cebada_lonja_t: null,
            maiz_lonja_t: null,
            pienso_lonja_t: null,
            pienso_real_t: null,
            pienso_estimado: false,
            kg_comprados: 0
          });
        }
        const item = mapaMeses.get(p.mes);
        item.pienso_real_t = Number(p.precio_pienso_real_t);
        item.kg_comprados = Number(p.kg_comprados);
      });

      // Si las estimaciones están activas, imputar precio de Lonja en meses sin compras
      if (usarEstimaciones) {
        mapaMeses.forEach(item => {
          if (item.pienso_real_t == null || item.pienso_real_t === 0) {
            if (item.pienso_lonja_t != null) {
              item.pienso_real_t = item.pienso_lonja_t;
              item.pienso_estimado = true;
            } else if (item.cebada_lonja_t != null) {
              item.pienso_real_t = Math.round(item.cebada_lonja_t * 1.45);
              item.pienso_estimado = true;
            }
          }
        });
      }

      return Array.from(mapaMeses.values()).sort((a, b) => a.mes.localeCompare(b.mes));
    } catch (e) {
      console.error("[DB] Error en obtenerRadarMateriasPrimas:", e);
      return [];
    }
  }

  tieneTablaLonja() {
    try {
      const res = this.ejecutarQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cotizaciones_lonja'");
      return res && res.length > 0;
    } catch {
      return false;
    }
  }

  obtenerRadarLonjaCarne(anio = null, usarEstimaciones = false) {
    if (!this.tieneTablaLonja()) return [];
    try {
      let whereLonja = "1=1";
      let whereVentas = "1=1";
      const paramsLonja = [];
      const paramsVentas = [];

      if (anio && anio !== "TODOS") {
        whereLonja += " AND substr(fecha, 1, 4) = ?";
        paramsLonja.push(String(anio));
        whereVentas += " AND substr(COALESCE(vc.fecha_salida_lote, vl.fecha_factura), 1, 4) = ?";
        paramsVentas.push(String(anio));
      }

      // Cotizaciones mensuales Lonja de Salamanca (Mesa Bovino de Carne en €/kg canal)
      const rowsLonja = this.ejecutarQuery(`
        SELECT 
          substr(fecha, 1, 7) as mes,
          categoria,
          ROUND(AVG(precio), 3) as precio_medio_kg
        FROM cotizaciones_lonja
        WHERE ${whereLonja} AND categoria IN ('AÑOJO_EXTRA', 'AÑOJO_PESADO', 'TERNERA_EXTRA', 'VACA_DESVIEJE', 'VACA_EXTRA')
        GROUP BY mes, categoria
        ORDER BY mes ASC
      `, paramsLonja);

      // Precios medios reales de venta en matadero de la explotación desglosados por categoría
      const tieneVentas = this.tieneTablaVentas();
      let rowsVentas = [];
      if (tieneVentas) {
        rowsVentas = this.ejecutarQuery(`
          SELECT 
            substr(COALESCE(vc.fecha_salida_lote, vl.fecha_factura), 1, 7) as mes,
            CASE 
              WHEN vc.articulo LIKE '%TERNERO%' THEN 'ANOJO'
              WHEN vc.articulo LIKE '%TERNERA%' THEN 'TERNERA'
              WHEN vc.articulo LIKE '%VACA%' OR vc.articulo LIKE '%TORO%' THEN 'VACA'
              ELSE 'OTRO'
            END as categoria_animal,
            ROUND(SUM(vc.importe_linea) / NULLIF(SUM(vc.peso_canal_kg), 0), 3) as precio_medio_cat,
            ROUND(AVG(vc.peso_canal_kg), 1) as peso_medio_cat,
            COUNT(vc.id) as canales_cat,
            ROUND(SUM(vc.peso_canal_kg), 1) as kg_cat,
            ROUND(SUM(vc.importe_linea), 2) as importe_cat
          FROM ventas_canales vc
          JOIN ventas_liquidaciones vl ON vc.factura_id = vl.id
          WHERE ${whereVentas} 
            AND vc.peso_canal_kg >= 50 
            AND (vc.importe_linea / vc.peso_canal_kg) BETWEEN 1.5 AND 20.0
          GROUP BY mes, categoria_animal
          ORDER BY mes ASC
        `, paramsVentas);
      }

      const mapaMeses = new Map();

      (rowsLonja || []).forEach(r => {
        if (!r.mes) return;
        if (!mapaMeses.has(r.mes)) {
          mapaMeses.set(r.mes, {
            mes: r.mes,
            anojo_extra_lonja: null,
            anojo_pesado_lonja: null,
            ternera_extra_lonja: null,
            vaca_desvieje_lonja: null,
            precio_medio_granja: null,
            peso_medio_granja: null,
            precio_estimado: false,
            canales_vendidas: 0,
            total_kg_canal: 0,
            total_importe: 0,
            canales_anojo: 0,
            kg_anojo: 0,
            canales_ternera: 0,
            kg_ternera: 0,
            canales_vaca: 0,
            kg_vaca: 0,
            lonja_referencia: null,
            diferencial_lonja: null,
            mix_texto: ""
          });
        }
        const item = mapaMeses.get(r.mes);
        if (r.categoria === "AÑOJO_EXTRA" || (r.categoria && r.categoria.endsWith("OJO_EXTRA"))) item.anojo_extra_lonja = Number(r.precio_medio_kg);
        if (r.categoria === "AÑOJO_PESADO" || (r.categoria && r.categoria.endsWith("OJO_PESADO"))) item.anojo_pesado_lonja = Number(r.precio_medio_kg);
        if (r.categoria === "TERNERA_EXTRA") item.ternera_extra_lonja = Number(r.precio_medio_kg);
        if (r.categoria === "VACA_DESVIEJE") item.vaca_desvieje_lonja = Number(r.precio_medio_kg);
      });

      (rowsVentas || []).forEach(v => {
        if (!v.mes) return;
        if (!mapaMeses.has(v.mes)) {
          mapaMeses.set(v.mes, {
            mes: v.mes,
            anojo_extra_lonja: null,
            anojo_pesado_lonja: null,
            ternera_extra_lonja: null,
            vaca_desvieje_lonja: null,
            precio_medio_granja: null,
            peso_medio_granja: null,
            precio_estimado: false,
            canales_vendidas: 0,
            total_kg_canal: 0,
            total_importe: 0,
            canales_anojo: 0,
            kg_anojo: 0,
            canales_ternera: 0,
            kg_ternera: 0,
            canales_vaca: 0,
            kg_vaca: 0,
            lonja_referencia: null,
            diferencial_lonja: null,
            mix_texto: ""
          });
        }
        const item = mapaMeses.get(v.mes);
        const cat = v.categoria_animal;
        const nCan = Number(v.canales_cat || 0);
        const nKg = Number(v.kg_cat || 0);
        const nImp = Number(v.importe_cat || 0);

        item.canales_vendidas += nCan;
        item.total_kg_canal += nKg;
        item.total_importe += nImp;

        if (cat === "ANOJO") {
          item.canales_anojo += nCan;
          item.kg_anojo += nKg;
        } else if (cat === "TERNERA") {
          item.canales_ternera += nCan;
          item.kg_ternera += nKg;
        } else if (cat === "VACA") {
          item.canales_vaca += nCan;
          item.kg_vaca += nKg;
        }
      });

      // Calcular precio medio global, benchmark ponderado de Lonja y texto de composición
      mapaMeses.forEach(item => {
        if (item.total_kg_canal > 0) {
          item.precio_medio_granja = Number((item.total_importe / item.total_kg_canal).toFixed(2));
          item.peso_medio_granja = Number((item.total_kg_canal / item.canales_vendidas).toFixed(1));

          // Benchmark ponderado oficial de Lonja según el mix de animales vendidos
          let lonjaSuma = 0;
          let kgSuma = 0;
          if (item.kg_anojo > 0 && item.anojo_extra_lonja) {
            lonjaSuma += item.kg_anojo * item.anojo_extra_lonja;
            kgSuma += item.kg_anojo;
          }
          if (item.kg_ternera > 0 && item.ternera_extra_lonja) {
            lonjaSuma += item.kg_ternera * item.ternera_extra_lonja;
            kgSuma += item.kg_ternera;
          }
          if (item.kg_vaca > 0 && item.vaca_desvieje_lonja) {
            lonjaSuma += item.kg_vaca * item.vaca_desvieje_lonja;
            kgSuma += item.kg_vaca;
          }

          if (kgSuma > 0) {
            item.lonja_referencia = Number((lonjaSuma / kgSuma).toFixed(2));
          } else {
            item.lonja_referencia = item.anojo_extra_lonja || null;
          }

          item.diferencial_lonja = (item.precio_medio_granja != null && item.lonja_referencia != null)
            ? Number((item.precio_medio_granja - item.lonja_referencia).toFixed(2))
            : null;

          // Etiqueta descriptiva del mix vendido
          const partes = [];
          if (item.canales_anojo > 0) partes.push(`${item.canales_anojo} añojo${item.canales_anojo > 1 ? 's' : ''}`);
          if (item.canales_ternera > 0) partes.push(`${item.canales_ternera} ternera${item.canales_ternera > 1 ? 's' : ''}`);
          if (item.canales_vaca > 0) partes.push(`${item.canales_vaca} vaca${item.canales_vaca > 1 ? 's' : ''}`);
          item.mix_texto = partes.join(", ");
        }
      });

      // Si las estimaciones están activas, imputar precio Lonja en meses sin liquidaciones de venta
      if (usarEstimaciones) {
        mapaMeses.forEach(item => {
          if (item.precio_medio_granja == null || item.precio_medio_granja === 0) {
            if (item.anojo_extra_lonja != null) {
              item.precio_medio_granja = item.anojo_extra_lonja;
              item.lonja_referencia = item.anojo_extra_lonja;
              item.diferencial_lonja = 0.00;
              item.precio_estimado = true;
              item.mix_texto = "Estimación Lonja";
            }
          }
        });
      }

      return Array.from(mapaMeses.values()).sort((a, b) => a.mes.localeCompare(b.mes));
    } catch (e) {
      console.error("[DB] Error en obtenerRadarLonjaCarne:", e);
      return [];
    }
  }

  obtenerSeriesTradingCarne(anio = null, usarEstimaciones = false) {
    if (!this.tieneTablaLonja()) return { anojo_extra: [], anojo_pesado: [], ternera_extra: [], vaca_desvieje: [], precio_granja: [] };
    try {
      let sqlLonja = "SELECT fecha as time, categoria, precio as value FROM cotizaciones_lonja WHERE mesa = 'CARNE'";
      const paramsLonja = [];
      if (anio && anio !== "TODOS") {
        sqlLonja += " AND substr(fecha, 1, 4) = ?";
        paramsLonja.push(String(anio));
      }
      sqlLonja += " ORDER BY fecha ASC";

      const rowsLonja = this.ejecutarQuery(sqlLonja, paramsLonja);

      const anojo_extra = [];
      const anojo_pesado = [];
      const ternera_extra = [];
      const vaca_desvieje = [];

      (rowsLonja || []).forEach(r => {
        if (!r.time || r.value == null) return;
        const pt = { time: String(r.time).slice(0, 10), value: Number(r.value) };
        if (r.categoria === 'AÑOJO_EXTRA' || (r.categoria && r.categoria.endsWith('OJO_EXTRA'))) anojo_extra.push(pt);
        else if (r.categoria === 'AÑOJO_PESADO' || (r.categoria && r.categoria.endsWith('OJO_PESADO'))) anojo_pesado.push(pt);
        else if (r.categoria === 'TERNERA_EXTRA') ternera_extra.push(pt);
        else if (r.categoria === 'VACA_DESVIEJE') vaca_desvieje.push(pt);
      });

      // Consultar precios reales de la granja filtrando exclusivamente animales con peso canal válido (>= 50kg)
      let sqlGranja = `
        SELECT 
          COALESCE(vc.fecha_salida_lote, vl.fecha_factura) as time,
          CASE 
            WHEN vc.articulo LIKE '%TERNER%' THEN 'CEBO'
            WHEN vc.articulo LIKE '%VACA%' OR vc.articulo LIKE '%TORO%' THEN 'VACA'
            ELSE 'OTRO'
          END as tipo,
          ROUND(SUM(vc.importe_linea) / SUM(vc.peso_canal_kg), 3) as value,
          ROUND(SUM(vc.peso_canal_kg), 1) as kg_total,
          COUNT(vc.id) as canales_total
        FROM ventas_canales vc
        LEFT JOIN ventas_liquidaciones vl ON vc.factura_id = vl.id
        WHERE vc.peso_canal_kg >= 50 
          AND (vc.importe_linea / vc.peso_canal_kg) BETWEEN 1.5 AND 20.0
          AND COALESCE(vc.fecha_salida_lote, vl.fecha_factura) IS NOT NULL
      `;
      const paramsGranja = [];
      if (anio && anio !== "TODOS") {
        sqlGranja += " AND substr(COALESCE(vc.fecha_salida_lote, vl.fecha_factura), 1, 4) = ?";
        paramsGranja.push(String(anio));
      }
      sqlGranja += " GROUP BY time, tipo ORDER BY time ASC";

      const rowsGranja = this.ejecutarQuery(sqlGranja, paramsGranja);

      const precio_granja_cebo = [];
      const precio_granja_vacas = [];
      const precio_granja_map = new Map();

      (rowsGranja || []).forEach(r => {
        const pt = {
          time: String(r.time).slice(0, 10),
          value: Number(r.value),
          kg_total: Number(r.kg_total),
          canales_total: Number(r.canales_total),
          estimado: false,
          esReal: true
        };
        if (r.tipo === 'CEBO') {
          precio_granja_cebo.push(pt);
        } else if (r.tipo === 'VACA') {
          precio_granja_vacas.push(pt);
        }

        if (!precio_granja_map.has(pt.time)) {
          precio_granja_map.set(pt.time, { time: pt.time, importe: 0, kg: 0, canales: 0 });
        }
        const item = precio_granja_map.get(pt.time);
        item.kg += Number(r.kg_total);
        item.importe += Number(r.value) * Number(r.kg_total);
        item.canales += Number(r.canales_total);
      });

      const precio_granja = Array.from(precio_granja_map.values()).map(g => ({
        time: g.time,
        value: Number((g.importe / g.kg).toFixed(3)),
        kg_total: g.kg,
        canales_total: g.canales,
        estimado: false,
        esReal: true
      })).sort((a, b) => a.time.localeCompare(b.time));

      if (usarEstimaciones && anojo_extra.length > 0) {
        const fechasCebo = new Set(precio_granja_cebo.map(p => p.time));
        anojo_extra.forEach(pt => {
          if (!fechasCebo.has(pt.time)) {
            precio_granja_cebo.push({
              time: pt.time,
              value: pt.value,
              kg_total: 0,
              canales_total: 0,
              estimado: true,
              esReal: false
            });
          }
        });
        precio_granja_cebo.sort((a, b) => a.time.localeCompare(b.time));
      }

      return {
        anojo_extra,
        anojo_pesado,
        ternera_extra,
        vaca_desvieje,
        precio_granja_cebo,
        precio_granja_vacas,
        precio_granja
      };
    } catch (e) {
      console.error("[DB] Error en obtenerSeriesTradingCarne:", e);
      return { anojo_extra: [], anojo_pesado: [], ternera_extra: [], vaca_desvieje: [], precio_granja_cebo: [], precio_granja_vacas: [], precio_granja: [] };
    }
  }

  obtenerSeriesTradingMateriasPrimas(anio = null, usarEstimaciones = false) {
    if (!this.tieneTablaLonja()) return { pienso_lonja: [], pienso_granja: [], cebada_lonja: [], maiz_lonja: [] };
    try {
      let sqlLonja = "SELECT fecha as time, categoria, precio as value FROM cotizaciones_lonja WHERE mesa = 'CEREALES'";
      const paramsLonja = [];
      if (anio && anio !== "TODOS") {
        sqlLonja += " AND substr(fecha, 1, 4) = ?";
        paramsLonja.push(String(anio));
      }
      sqlLonja += " ORDER BY fecha ASC";

      const rowsLonja = this.ejecutarQuery(sqlLonja, paramsLonja);

      const cebada_lonja = [];
      const maiz_lonja = [];
      const pienso_lonja = [];

      (rowsLonja || []).forEach(r => {
        if (!r.time || r.value == null) return;
        const pt = { time: String(r.time).slice(0, 10), value: Number(r.value) };
        if (r.categoria === 'CEBADA') cebada_lonja.push(pt);
        else if (r.categoria === 'MAIZ') maiz_lonja.push(pt);
        else if (r.categoria === 'PIENSO_CEBO') pienso_lonja.push(pt);
      });

      let sqlGranja = `
        SELECT 
          fecha as time,
          ROUND(AVG(
            CASE 
              WHEN precio_kg > 0 AND precio_kg <= 2.0 THEN precio_kg * 1000
              WHEN precio_kg > 100 AND precio_kg <= 1000 THEN precio_kg
              WHEN importe > 1000000 AND kg > 0 THEN (importe / 100000.0 / kg) * 1000
              WHEN importe > 0 AND kg > 0 AND (importe / kg) <= 2.0 THEN (importe / kg) * 1000
              ELSE 320.0
            END
          ), 1) as value,
          SUM(kg) as kg_total
        FROM compras_alimento
        WHERE (lower(alimento) LIKE '%pienso%' OR lower(alimento) LIKE '%cebo%' OR lower(alimento) LIKE '%concentrado%')
          AND (precio_kg > 0 OR (importe > 0 AND kg > 0))
          AND (precio_kg <= 2.0 OR (importe / NULLIF(kg, 0)) <= 2.0 OR precio_kg BETWEEN 100 AND 1000 OR importe > 1000000)
      `;
      const paramsGranja = [];
      if (anio && anio !== "TODOS") {
        sqlGranja += " AND substr(fecha, 1, 4) = ?";
        paramsGranja.push(String(anio));
      }
      sqlGranja += " GROUP BY time ORDER BY time ASC";

      const rowsGranja = this.ejecutarQuery(sqlGranja, paramsGranja);

      const pienso_granja = (rowsGranja || []).map(r => ({
        time: String(r.time).slice(0, 10),
        value: Number(r.value),
        kg_total: Number(r.kg_total),
        estimado: false,
        esReal: true
      }));

      if (usarEstimaciones && pienso_lonja.length > 0) {
        const fechasPienso = new Set(pienso_granja.map(p => p.time));
        pienso_lonja.forEach(pt => {
          if (!fechasPienso.has(pt.time)) {
            pienso_granja.push({
              time: pt.time,
              value: pt.value,
              kg_total: 0,
              estimado: true,
              esReal: false
            });
          }
        });
        pienso_granja.sort((a, b) => a.time.localeCompare(b.time));
      }

      return {
        cebada_lonja,
        maiz_lonja,
        pienso_lonja,
        pienso_granja
      };
    } catch (e) {
      console.error("[DB] Error en obtenerSeriesTradingMateriasPrimas:", e);
      return { pienso_lonja: [], pienso_granja: [], cebada_lonja: [], maiz_lonja: [] };
    }
  }

  obtenerSeriesTradingTesoreria(anio = null, categoria = null, usarEstimaciones = false) {
    try {
      const serie = this.obtenerSerieMensualFinanciera(anio, categoria, usarEstimaciones);
      const ingresos_carne = [];
      const gastos_pienso = [];
      const margen_neto = [];

      (serie || []).forEach(s => {
        if (!s.mes) return;
        const t = `${s.mes}-01`;
        const tieneVentas = Number(s.ingresos_carne || 0) > 0;
        const tieneCompras = Number(s.gasto_pienso || 0) > 0;
        const valMargen = s.margen_neto != null 
          ? Number(s.margen_neto) 
          : (s.margen_mes != null ? Number(s.margen_mes) : Number((s.ingresos_carne || 0) - (s.gasto_pienso || 0)));

        ingresos_carne.push({ 
          time: t, 
          value: Number(s.ingresos_carne || 0),
          esReal: Boolean(s.esReal),
          estimado: Boolean(s.estimado),
          facturas_pendientes: Boolean(s.facturas_pendientes),
          salidas_censo: s.salidas_censo || s.cabezas || 0,
          cabezas: s.cabezas,
          kg_canal: s.kg_canal
        });
        gastos_pienso.push({ 
          time: t, 
          value: Number(s.gasto_pienso || 0),
          esReal: tieneCompras && !s.gasto_estimado,
          estimado: Boolean(s.gasto_estimado),
          kg_pienso: s.kg_pienso
        });
        margen_neto.push({ 
          time: t, 
          value: valMargen,
          esReal: Boolean(s.esReal || tieneCompras),
          estimado: Boolean(s.estimado || s.gasto_estimado)
        });
      });

      return {
        ingresos_carne,
        gastos_pienso,
        margen_neto
      };
    } catch (e) {
      console.error("[DB] Error en obtenerSeriesTradingTesoreria:", e);
      return { ingresos_carne: [], gastos_pienso: [], margen_neto: [] };
    }
  }

  obtenerEstacionalidadLonjaCarne() {
    if (!this.tieneTablaLonja()) return [];
    try {
      const rows = this.ejecutarQuery(`
        SELECT 
          strftime('%m', fecha) as mes_num,
          categoria,
          ROUND(AVG(precio), 3) as precio_medio
        FROM cotizaciones_lonja
        WHERE mesa = 'CARNE' AND categoria IN ('AÑOJO_EXTRA', 'AÑOJO_PESADO', 'TERNERA_EXTRA', 'VACA_DESVIEJE')
        GROUP BY mes_num, categoria
        ORDER BY mes_num ASC
      `);

      const NOMBRES_MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
      const mapa = new Map();
      for (let i = 1; i <= 12; i++) {
        const mStr = String(i).padStart(2, "0");
        mapa.set(mStr, {
          mes_num: mStr,
          nombre_mes: NOMBRES_MESES[i - 1],
          anojo_extra: null,
          anojo_pesado: null,
          ternera_extra: null,
          vaca_desvieje: null
        });
      }

      (rows || []).forEach(r => {
        if (!r.mes_num || !mapa.has(r.mes_num)) return;
        const item = mapa.get(r.mes_num);
        if (r.categoria === "AÑOJO_EXTRA") item.anojo_extra = Number(r.precio_medio);
        if (r.categoria === "AÑOJO_PESADO") item.anojo_pesado = Number(r.precio_medio);
        if (r.categoria === "TERNERA_EXTRA") item.ternera_extra = Number(r.precio_medio);
        if (r.categoria === "VACA_DESVIEJE") item.vaca_desvieje = Number(r.precio_medio);
      });

      return Array.from(mapa.values());
    } catch (e) {
      console.error("[DB] Error en obtenerEstacionalidadLonjaCarne:", e);
      return [];
    }
  }

  calcularSimulacionTimingVenta(params = {}) {
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

  obtenerMovimientos(params = {}) {

    const { filtro = "", tipo = "TODOS", anio = "TODOS", destino = "TODOS", limite = 100, offset = 0 } = params;
    const condiciones = [];
    const valores = [];

    if (filtro && filtro.trim() !== "") {
      const f = `%${filtro.trim()}%`;
      condiciones.push("(m.crotal LIKE ? OR a.crotal_4 LIKE ? OR m.corral LIKE ? OR m.origen LIKE ? OR m.destino LIKE ?)");
      valores.push(f, f, f, f, f);
    }

    const condInterno = "((m.origen LIKE '%121' OR m.origen LIKE '%671' OR m.origen LIKE '%591') AND (m.destino LIKE '%121' OR m.destino LIKE '%671' OR m.destino LIKE '%591'))";
    const condMatadero = "(m.destino LIKE '%081' OR m.destino LIKE '%014' OR m.destino LIKE '%061' OR m.destino LIKE '%078' OR m.destino LIKE 'ES37376%' OR m.destino LIKE 'ES47086%' OR m.destino LIKE 'ES28129%')";

    if (tipo === "VENTA") {
      // Regla de dominio: Ventas comerciales a terceros + salidas de cebadero (122) y vida (121/671/591) a matadero
      condiciones.push(`(
        (m.tipo IN ('VENTA', 'V') AND NOT (${condInterno} AND m.origen <> m.destino) AND m.destino NOT LIKE '%122')
        OR (m.tipo IN ('SACRIFICIO', 'S') AND (${condMatadero} OR m.origen LIKE '%122' OR m.origen LIKE '%121' OR m.origen LIKE '%671' OR m.origen LIKE '%591'))
        OR (m.origen LIKE '%122' AND m.destino NOT LIKE '%121' AND m.destino NOT LIKE '%671' AND m.destino NOT LIKE '%591' AND m.destino IS NOT NULL AND m.destino <> '')
      )`);
    } else if (tipo === "TRASPASO_CEBADERO" || tipo === "TRASPASO") {
      // Entradas a cebadero 122 procedentes de vida o registradas como traspaso
      condiciones.push(`(m.destino LIKE '%122' AND (m.origen LIKE '%121' OR m.origen LIKE '%671' OR m.origen LIKE '%591' OR m.tipo IN ('TRASPASO', 'T')))`);
    } else if (tipo === "MOVIMIENTO_INTERNO" || tipo === "INTERNO") {
      // Movimientos entre 121, 671 y 591, o cambios de ubicación dentro de la misma finca
      condiciones.push(`((${condInterno} AND m.tipo NOT IN ('NACIMIENTO', 'N') AND (m.origen <> m.destino OR m.tipo LIKE 'UBICACI%' OR m.tipo = 'U')) OR m.tipo = 'U')`);
    } else if (tipo === "NACIMIENTO") {
      condiciones.push("m.tipo IN ('NACIMIENTO', 'N')");
    } else if (tipo === "MUERTE") {
      condiciones.push("m.tipo IN ('MUERTE', 'M')");
    } else if (tipo === "COMPRA") {
      condiciones.push(`(m.tipo IN ('COMPRA', 'C') AND NOT ${condInterno} AND NOT (m.destino LIKE '%122' AND (m.origen LIKE '%121' OR m.origen LIKE '%671' OR m.origen LIKE '%591')))`);
    } else if (tipo === "SACRIFICIO") {
      condiciones.push(`(m.tipo IN ('SACRIFICIO', 'S') AND NOT (${condMatadero} OR m.origen LIKE '%122'))`);
    } else if (tipo && tipo !== "TODOS") {
      condiciones.push("m.tipo = ?");
      valores.push(tipo);
    }

    if (anio && anio !== "TODOS") {
      condiciones.push("m.fecha LIKE ?");
      valores.push(`${anio}%`);
    }

    if (destino === "122") {
      condiciones.push("(m.destino LIKE '%122' OR m.corral LIKE '%CEBAD%')");
    } else if (destino === "121") {
      condiciones.push("(m.destino LIKE '%121' OR (m.origen LIKE '%121' AND (m.destino IS NULL OR m.destino = '' OR m.destino LIKE '%121')))");
    } else if (destino === "EXTERNO") {
      condiciones.push("(m.origen LIKE '%122' AND m.destino NOT LIKE '%121' AND m.destino NOT LIKE '%671' AND m.destino NOT LIKE '%591' AND m.destino IS NOT NULL AND m.destino <> '')");
    } else if (destino === "HISTORICO") {
      condiciones.push("(m.origen LIKE '%671' OR m.origen LIKE '%591' OR m.destino LIKE '%671' OR m.destino LIKE '%591')");
    } else if (destino === "ACTIVAS") {
      condiciones.push("(m.origen LIKE '%121' OR m.origen LIKE '%122' OR m.destino LIKE '%121' OR m.destino LIKE '%122')");
    }
    // Si destino es "TODOS", no añade restricción artificial y muestra todos los movimientos

    const whereClause = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";

    // 1. Obtener conteo exacto de movimientos que cumplen el criterio
    const countSql = `
      SELECT COUNT(1) as total
      FROM movimientos m
      LEFT JOIN animales a ON m.crotal = a.crotal
      ${whereClause}
    `;
    const countRows = this.ejecutarQuery(countSql, valores);
    const totalCount = (countRows && countRows.length > 0 && countRows[0].total != null) 
      ? Number(countRows[0].total) 
      : 0;

    // 2. Obtener lote de filas paginadas
    const tieneVentas = this.tieneTablaVentas();
    const joinVentas = tieneVentas
      ? `LEFT JOIN (
           SELECT crotal_asignado,
                  MAX(peso_canal_kg) as peso_canal_kg,
                  MAX(precio_unitario) as canal_precio,
                  MAX(importe_linea) as canal_importe,
                  MAX(factura_id) as canal_factura_id
           FROM ventas_canales
           WHERE crotal_asignado IS NOT NULL
           GROUP BY crotal_asignado
         ) vc ON (
           m.crotal = vc.crotal_asignado 
           AND (
             UPPER(COALESCE(m.tipo, '')) IN ('VENTA', 'SACRIFICIO', 'V', 'S')
             OR m.destino LIKE '%081'
             OR (m.origen LIKE '%122' AND m.destino NOT LIKE '%121')
           )
         )
         LEFT JOIN ventas_liquidaciones vl ON vc.canal_factura_id = vl.id`
      : "";
    const selectVentasCols = tieneVentas
      ? `, vc.peso_canal_kg, vc.canal_precio, vc.canal_importe, vl.numero_factura as canal_factura, vc.canal_factura_id`
      : "";

    const sql = `
      SELECT 
        m.id, 
        m.crotal, 
        m.fecha, 
        m.tipo, 
        m.origen, 
        m.destino, 
        m.corral,
        a.crotal_4,
        a.sexo,
        a.estado,
        a.corral as corral_actual
        ${selectVentasCols}
      FROM movimientos m
      LEFT JOIN animales a ON m.crotal = a.crotal
      ${joinVentas}
      ${whereClause}
      ORDER BY m.fecha DESC, m.id DESC
      LIMIT ? OFFSET ?
    `;

    const valoresPaginados = [...valores, limite, offset];
    const rows = this.ejecutarQuery(sql, valoresPaginados) || [];

    // Etiquetado semántico unificado de dominio (Single-Badge)
    for (const row of rows) {
      const orig = String(row.origen || "").trim();
      const dest = String(row.destino || "").trim();
      const tipoOrig = String(row.tipo || "").trim().toUpperCase();

      const esInterna = (code) => code.endsWith("121") || code.endsWith("671") || code.endsWith("591");
      const esMat = (code) =>
        code.endsWith("081") ||
        code.endsWith("014") ||
        code.endsWith("061") ||
        code.endsWith("078") ||
        code.toUpperCase().includes("MATADERO") ||
        code.startsWith("ES37376") ||
        code.startsWith("ES47086") ||
        code.startsWith("ES28129");

      if (tipoOrig === "NACIMIENTO" || tipoOrig === "N") {
        row.tipo_display = "NACIMIENTO";
        row.label_display = "Nacimiento";
        row.badge_class = "nacimiento";
      } else if (esInterna(orig) && esInterna(dest) && orig !== dest) {
        row.tipo_display = "MOVIMIENTO_INTERNO";
        row.label_display = "Movimiento Interno";
        row.badge_class = "interno";
      } else if (tipoOrig.startsWith("UBICACI") || tipoOrig === "U") {
        row.tipo_display = "MOVIMIENTO_INTERNO";
        row.label_display = "Movimiento Interno";
        row.badge_class = "interno";
      } else if (dest.endsWith("122") && (esInterna(orig) || tipoOrig === "TRASPASO" || tipoOrig === "T")) {
        row.tipo_display = "TRASPASO_CEBADERO";
        row.label_display = "Traspaso Cebadero";
        row.badge_class = "traspaso";
      } else if ((orig.endsWith("122") || esInterna(orig)) && esMat(dest)) {
        row.tipo_display = "VENTA";
        row.label_display = "Venta";
        row.badge_class = "venta";
      } else if (orig.endsWith("122") && !esInterna(dest) && dest !== "") {
        row.tipo_display = "VENTA";
        row.label_display = "Venta";
        row.badge_class = "venta";
      } else if (tipoOrig === "VENTA" || tipoOrig === "V") {
        row.tipo_display = "VENTA";
        row.label_display = "Venta";
        row.badge_class = "venta";
      } else if (tipoOrig === "COMPRA" || tipoOrig === "C") {
        row.tipo_display = "COMPRA";
        row.label_display = "Compra";
        row.badge_class = "compra";
      } else if (tipoOrig === "MUERTE" || tipoOrig === "M") {
        row.tipo_display = "MUERTE";
        row.label_display = "Baja en campo";
        row.badge_class = "muerte";
      } else if (tipoOrig === "SACRIFICIO" || tipoOrig === "S") {
        row.tipo_display = "SACRIFICIO";
        row.label_display = "Sacrificio";
        row.badge_class = "sacrificio";
      } else if (tipoOrig === "TRASPASO" || tipoOrig === "T") {
        row.tipo_display = "TRASPASO";
        row.label_display = "Traspaso";
        row.badge_class = "traspaso";
      } else {
        row.tipo_display = tipoOrig || "MOVIMIENTO";
        row.label_display = row.tipo || "Movimiento";
        row.badge_class = "otro";
      }
    }


    rows.total = totalCount;
    return rows;
  }

  obtenerAniosMovimientos() {
    const rows = this.ejecutarQuery(`
      SELECT DISTINCT SUBSTR(fecha, 1, 4) as anio 
      FROM movimientos 
      WHERE fecha IS NOT NULL AND fecha <> '' 
      ORDER BY anio DESC
    `);
    return rows.map((r) => r.anio).filter(Boolean);
  }

  ejecutarMutacion(sql, params = []) {
    if (!this.db) throw new Error("Base de datos no inicializada");
    this.db.run(sql, params);
    this._persistirEstadoLocal();
    return true;
  }

  async _persistirEstadoLocal() {
    try {
      if (this.db && typeof this.db.export === "function") {
        const exported = this.db.export();
        await guardarBaseDatosLocal(exported.buffer);
      }
    } catch (e) {
      console.warn("[DB] Error persistiendo base de datos modificada en IndexedDB:", e);
    }
  }

  async registrarPartoOptimista({ madre_crotal, fecha_parto, cria_crotal, cria_sexo, cria_raza, incidencias }) {
    if (!this.db) throw new Error("Base de datos no inicializada");
    const mCrotal = String(madre_crotal || "").trim();
    if (!mCrotal) throw new Error("El crotal de la madre es obligatorio");

    const fParto = String(fecha_parto || "").trim() || new Date().toISOString().split("T")[0];
    const cSexo = String(cria_sexo || "H").trim().toUpperCase();
    const cCrotal = cria_crotal ? String(cria_crotal).trim() : null;
    const inc = incidencias ? String(incidencias).trim() : null;

    // 1. Insertar el parto en la tabla de partos
    this.db.run(
      "INSERT INTO partos (madre_crotal, fecha_parto, cria_crotal, cria_sexo, incidencias) VALUES (?, ?, ?, ?, ?)",
      [mCrotal, fParto, cCrotal, cSexo, inc]
    );

    // 2. Actualizar último parto y conteo en la madre
    this.db.run(
      "UPDATE animales SET fecha_ult_parto = ?, total_partos = coalesce(total_partos, 0) + 1 WHERE crotal = ?",
      [fParto, mCrotal]
    );

    // 3. Si se definió crotal para la cría, registrar la cría en el censo
    if (cCrotal) {
      const resMadre = this.ejecutarQuery("SELECT corral, raza FROM animales WHERE crotal = ?", [mCrotal]);
      const corral = resMadre[0] ? resMadre[0].corral : "DUEÑA";
      const raza = cria_raza || (resMadre[0] ? resMadre[0].raza : "Cruzado");
      const digitos = cCrotal.replace(/\D/g, "");
      const c4 = digitos.length >= 4 ? digitos.slice(-4) : (digitos || cCrotal.slice(-4));

      this.db.run(
        "INSERT OR IGNORE INTO animales (crotal, crotal_4, sexo, raza, fecha_nacimiento, madre_crotal, estado, vida, corral, fecha_alta) VALUES (?, ?, ?, ?, ?, ?, 'A', 1, ?, ?)",
        [cCrotal, c4, cSexo, raza, fParto, mCrotal, corral, fParto]
      );
    }

    // 4. Persistir a IndexedDB en segundo plano
    await this._persistirEstadoLocal();

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("campo:db-updated", {
        detail: { tipo: "parto", madre_crotal: mCrotal, fecha_parto: fParto }
      }));
    }
    return true;
  }
}

if (typeof window !== "undefined") {
  window.campoDB = new CampoDB();
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CampoDB };
}

