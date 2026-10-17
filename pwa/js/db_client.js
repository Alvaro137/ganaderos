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
    if (!filtro || filtro.trim() === "") {
      return this.ejecutarQuery(`
        SELECT id, fecha, alimento, kg, importe, precio_kg, albaran, proveedor, pagado
        FROM compras_alimento
        ORDER BY fecha DESC
        LIMIT 100
      `);
    }
    const f = `%${filtro.trim()}%`;
    return this.ejecutarQuery(`
      SELECT id, fecha, alimento, kg, importe, precio_kg, albaran, proveedor, pagado
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

window.campoDB = new CampoDB();

