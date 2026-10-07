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

  async _sincronizarEnSegundoPlano(authToken = null) {
    if (!navigator.onLine) return;
    const token = authToken || localStorage.getItem("campo_pwa_token") || "";
    if (!token) return;

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
      }
    } catch {
      // Silencioso: las operaciones offline tienen prioridad
    }
  }

  async sincronizarAhora(authToken = null) {
    if (!navigator.onLine) {
      throw new Error("SIN_CONEXION");
    }
    const token = authToken || localStorage.getItem("campo_pwa_token") || "";
    if (!token) {
      throw new Error("AUTH_REQUIRED");
    }

    const headers = {
      "Authorization": `Bearer ${token}`,
      "X-Auth-Token": token
    };
    const resp = await fetch("./api/database", { headers });
    if (!resp.ok) {
      if (resp.status === 401) throw new Error("AUTH_REQUIRED");
      throw new Error(`Error en el servidor (${resp.status})`);
    }

    const newBuf = await resp.arrayBuffer();
    await guardarBaseDatosLocal(newBuf);
    const hotOk = this._reemplazarBaseDatosEnCaliente(newBuf);
    return { ok: true, hotReloaded: hotOk, meta: this.meta };
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
      // Coincidencia por dígitos iniciales (búsqueda incremental mientras teclea: 1->0->4->5)
      const condActivo = soloActivos ? "AND estado = 'A'" : "";
      sql = `
        SELECT crotal, crotal_4, nombre, sexo, raza, estado, corral, fecha_ult_parto, total_partos, fecha_nacimiento
        FROM animales
        WHERE crotal_4 LIKE ? ${condActivo}
        ORDER BY (estado = 'A') DESC, crotal_4 ASC
        LIMIT ${lim}
      `;
      params = [`${soloDigitos}%`];
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

    return animal;
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
    if (!filtro || filtro.trim() === "") {
      return this.ejecutarQuery(`
        SELECT id, fecha, receta, medicamento, unidades, dosis_unitaria, n_animales, veterinario, tiempo_carne, proveedor
        FROM recetas
        ORDER BY fecha DESC
        LIMIT 80
      `);
    }
    const f = `%${filtro.trim()}%`;
    return this.ejecutarQuery(`
      SELECT id, fecha, receta, medicamento, unidades, dosis_unitaria, n_animales, veterinario, tiempo_carne, proveedor
      FROM recetas
      WHERE receta LIKE ? OR medicamento LIKE ? OR veterinario LIKE ?
      ORDER BY fecha DESC
      LIMIT 80
    `, [f, f, f]);
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
        (m.tipo = 'VENTA' AND NOT (${condInterno} AND m.origen <> m.destino) AND m.destino NOT LIKE '%122')
        OR (m.tipo = 'SACRIFICIO' AND (${condMatadero} OR m.origen LIKE '%122'))
        OR (m.origen LIKE '%122' AND m.destino NOT LIKE '%121' AND m.destino NOT LIKE '%671' AND m.destino NOT LIKE '%591' AND m.destino IS NOT NULL AND m.destino <> '')
      )`);
    } else if (tipo === "TRASPASO_CEBADERO" || tipo === "TRASPASO") {
      // Entradas a cebadero 122 procedentes de vida o registradas como traspaso
      condiciones.push(`(m.destino LIKE '%122' AND (m.origen LIKE '%121' OR m.origen LIKE '%671' OR m.origen LIKE '%591' OR m.tipo = 'TRASPASO'))`);
    } else if (tipo === "MOVIMIENTO_INTERNO" || tipo === "INTERNO") {
      // Movimientos entre 121, 671 y 591, o cambios de ubicación dentro de la misma finca
      condiciones.push(`(${condInterno} AND m.tipo <> 'NACIMIENTO' AND (m.origen <> m.destino OR m.tipo LIKE 'UBICACI%'))`);
    } else if (tipo === "NACIMIENTO") {
      condiciones.push("m.tipo = 'NACIMIENTO'");
    } else if (tipo === "MUERTE") {
      condiciones.push("m.tipo = 'MUERTE'");
    } else if (tipo === "COMPRA") {
      condiciones.push(`(m.tipo = 'COMPRA' AND NOT ${condInterno} AND NOT (m.destino LIKE '%122' AND (m.origen LIKE '%121' OR m.origen LIKE '%671' OR m.origen LIKE '%591')))`);
    } else if (tipo === "SACRIFICIO") {
      condiciones.push(`(m.tipo = 'SACRIFICIO' AND NOT (${condMatadero} OR m.origen LIKE '%122'))`);
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
    } else if (tipo === "MOVIMIENTO_INTERNO" || tipo === "INTERNO") {
      condiciones.push("(m.origen LIKE '%121' OR m.origen LIKE '%671' OR m.origen LIKE '%591' OR m.destino LIKE '%121' OR m.destino LIKE '%671' OR m.destino LIKE '%591')");
    } else {
      // TODOS: Por defecto mostrar las explotaciones activas (121 y 122), omitiendo registros puramente internos de 671 y 591
      condiciones.push("(m.origen LIKE '%121' OR m.origen LIKE '%122' OR m.destino LIKE '%121' OR m.destino LIKE '%122')");
    }

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
      FROM movimientos m
      LEFT JOIN animales a ON m.crotal = a.crotal
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

      if (tipoOrig === "NACIMIENTO") {
        row.tipo_display = "NACIMIENTO";
        row.label_display = "Nacimiento";
        row.badge_class = "nacimiento";
      } else if (esInterna(orig) && esInterna(dest) && orig !== dest) {
        row.tipo_display = "MOVIMIENTO_INTERNO";
        row.label_display = "Movimiento Interno";
        row.badge_class = "interno";
      } else if (tipoOrig.startsWith("UBICACI")) {
        row.tipo_display = "MOVIMIENTO_INTERNO";
        row.label_display = "Movimiento Interno";
        row.badge_class = "interno";
      } else if (dest.endsWith("122") && (esInterna(orig) || tipoOrig === "TRASPASO")) {
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
      } else if (tipoOrig === "VENTA") {
        row.tipo_display = "VENTA";
        row.label_display = "Venta";
        row.badge_class = "venta";
      } else if (tipoOrig === "COMPRA") {
        row.tipo_display = "COMPRA";
        row.label_display = "Compra";
        row.badge_class = "compra";
      } else if (tipoOrig === "MUERTE") {
        row.tipo_display = "MUERTE";
        row.label_display = "Baja en campo";
        row.badge_class = "muerte";
      } else if (tipoOrig === "SACRIFICIO") {
        row.tipo_display = "SACRIFICIO";
        row.label_display = "Sacrificio";
        row.badge_class = "sacrificio";
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

