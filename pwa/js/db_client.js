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

function openIndexedDB(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.warn("[IDB] Timeout abriendo IndexedDB (" + timeoutMs + "ms). Continuando con carga directa...");
      resolve(null);
    }, timeoutMs);

    try {
      const req = window.indexedDB.open(IDB_CONFIG.name, IDB_CONFIG.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_CONFIG.store)) {
          db.createObjectStore(IDB_CONFIG.store);
        }
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        if (!timedOut) resolve(req.result);
      };
      req.onerror = () => {
        clearTimeout(timer);
        console.warn("[IDB] Error abriendo IndexedDB:", req.error);
        if (!timedOut) resolve(null);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        console.warn("[IDB] Apertura de IndexedDB bloqueada.");
        if (!timedOut) resolve(null);
      };
    } catch (e) {
      clearTimeout(timer);
      console.warn("[IDB] Excepción abriendo IndexedDB:", e);
      resolve(null);
    }
  });
}

async function guardarBaseDatosLocal(buffer) {
  try {
    const db = await openIndexedDB(2000);
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
    const db = await openIndexedDB(1500);
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_CONFIG.store, "readonly");
        const req = tx.objectStore(IDB_CONFIG.store).get(IDB_CONFIG.key);
        req.onsuccess = () => {
          db.close();
          resolve(req.result || null);
        };
        req.onerror = () => {
          console.warn("[IDB] Error leyendo base de datos local:", req.error);
          db.close();
          resolve(null);
        };
      } catch (e) {
        db.close();
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
      }
    } catch {
      // Silencioso: las operaciones offline tienen prioridad
    }
  }

  async inicializar(onProgress, authToken = null) {
    if (this.ready) return;

    if (onProgress) onProgress("Cargando motor de datos...");
    const SQL = await initSqlJs({
      locateFile: (file) => `./js/${file}`
    });

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

  buscar(termino, soloActivos = true) {
    if (!termino || termino.trim() === "") {
      const cond = soloActivos ? "WHERE estado = 'A'" : "";
      return this.ejecutarQuery(`
        SELECT crotal, crotal_4, nombre, sexo, raza, estado, corral, fecha_ult_parto, total_partos, fecha_nacimiento
        FROM animales
        ${cond}
        ORDER BY crotal_4 ASC
        LIMIT 50
      `);
    }

    const t = termino.trim();
    const soloDigitos = t.replace(/\D/g, "");

    let sql;
    let params;

    if (soloDigitos.length >= 1 && soloDigitos.length <= 4) {
      // Coincidencia por últimos dígitos
      const condActivo = soloActivos ? "AND estado = 'A'" : "";
      sql = `
        SELECT crotal, crotal_4, nombre, sexo, raza, estado, corral, fecha_ult_parto, total_partos, fecha_nacimiento
        FROM animales
        WHERE crotal_4 LIKE ? ${condActivo}
        ORDER BY (estado = 'A') DESC, crotal_4 ASC
        LIMIT 30
      `;
      params = [`%${soloDigitos}`];
    } else {
      // Búsqueda por crotal completo o corral
      const condActivo = soloActivos ? "AND estado = 'A'" : "";
      sql = `
        SELECT crotal, crotal_4, nombre, sexo, raza, estado, corral, fecha_ult_parto, total_partos, fecha_nacimiento
        FROM animales
        WHERE (crotal LIKE ? OR corral LIKE ? OR nombre LIKE ?) ${condActivo}
        ORDER BY (estado = 'A') DESC, crotal_4 ASC
        LIMIT 30
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
    const { filtro = "", tipo = "TODOS", anio = "TODOS", destino = "TODOS", limite = 120 } = params;
    const condiciones = [];
    const valores = [];

    if (filtro && filtro.trim() !== "") {
      const f = `%${filtro.trim()}%`;
      condiciones.push("(m.crotal LIKE ? OR a.crotal_4 LIKE ? OR m.corral LIKE ? OR m.origen LIKE ? OR m.destino LIKE ?)");
      valores.push(f, f, f, f, f);
    }

    if (tipo && tipo !== "TODOS") {
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
      condiciones.push("(m.destino LIKE '%121' OR m.origen LIKE '%121')");
    } else if (destino === "671") {
      condiciones.push("(m.destino LIKE '%671' OR m.origen LIKE '%671')");
    } else if (destino === "591") {
      condiciones.push("(m.destino LIKE '%591' OR m.origen LIKE '%591')");
    }

    const whereClause = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";

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
      LIMIT ?
    `;
    valores.push(limite);

    return this.ejecutarQuery(sql, valores);
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
}

window.campoDB = new CampoDB();

