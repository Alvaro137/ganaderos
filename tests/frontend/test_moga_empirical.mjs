// tests/frontend/test_moga_empirical.mjs
/**
 * Empirical Adversarial Test Harness for M2: MoGa Census Reconciliation UI
 * Stress-testing edge cases:
 * 1. All zeros (empty census, 100% match)
 * 2. Massive numbers, missing keys, null fields in discrepancy items
 * 3. Filter switching with non-matching categories
 * 4. HTML injection / escaping in motives, crotals, notes, corrals
 * 5. Robustness to null / undefined / atypical data structures
 * 6. conciliarArchivoMoga HTTP client behavior, headers, and error parsing
 * 7. DOM lifecycle & modal event handling simulation
 */

import assert from "node:assert";
import { renderizarResumenMogaHTML, generarDiscrepanciasMogaHTML, conciliarArchivoMoga, abrirModalConciliacionMoga } from "../../pwa/js/modules/views/census_view.js";
import { escapeHtml, extraer4Digitos } from "../../pwa/js/modules/config.js";

let passed = 0;
let total = 0;

async function runEmpiricalTest(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    console.error(err.stack);
  }
}

console.log("==================================================");
console.log("ADVERSARIAL EMPIRICAL TESTS: MOGA PWA TOUCH UI");
console.log("==================================================");

async function main() {
  // ==========================================
  // SUITE 1: ALL ZEROS & EMPTY/NULL CENSUS
  // ==========================================
  console.log("\n--- Suite 1: All Zeros, Empty Census, 100% Match ---");

  await runEmpiricalTest("Resumen con todos los valores en cero explícitos", () => {
    const resumen = { total_local: 0, total_moga: 0, coincidentes: 0, discrepancias_totales: 0 };
    const html = renderizarResumenMogaHTML(resumen);

    assert.ok(html.includes("status-ok"), "Debe tener clase status-ok cuando discrepancias es 0");
    assert.ok(html.includes("Censo 100% Conciliado"), "Debe indicar 100% conciliado");
    assert.ok(html.includes("✅"), "Debe mostrar check de éxito");
    assert.ok(!html.includes("⚠️"), "No debe mostrar warning");
    assert.ok(html.includes(">0<"), "Debe renderizar los ceros en las métricas");
    assert.ok(html.includes("Sin diferencias"), "Debe indicar 'Sin diferencias'");
  });

  await runEmpiricalTest("Resumen con objeto null o undefined (fallback)", () => {
    const htmlNull = renderizarResumenMogaHTML(null);
    assert.ok(htmlNull.includes("status-ok"), "Fallback de null debe tener status-ok");
    assert.ok(htmlNull.includes("Censo 100% Conciliado"), "Fallback de null debe indicar conciliado");

    const htmlUndef = renderizarResumenMogaHTML(undefined);
    assert.ok(htmlUndef.includes("status-ok"), "Fallback de undefined debe tener status-ok");
    assert.ok(htmlUndef.includes("Censo 100% Conciliado"), "Fallback de undefined debe indicar conciliado");
  });

  await runEmpiricalTest("Resumen con claves faltantes parciales", () => {
    const resumenParcial = { total_local: 50 }; // faltan total_moga, coincidentes, discrepancias_totales
    const html = renderizarResumenMogaHTML(resumenParcial);
    assert.ok(html.includes("50"), "Debe mostrar total_local");
    assert.ok(html.includes("status-ok"), "Al no haber discrepancias_totales (0 por defecto), debe ser status-ok");
  });

  await runEmpiricalTest("Discrepancias con resultado vacío (todas las listas vacías)", () => {
    const resultado = {
      no_en_moga: [],
      bajas_oficiales_activas_local: [],
      bajas_locales_activas_oficial: [],
      no_en_campo: []
    };
    const html = generarDiscrepanciasMogaHTML(resultado, "todos");
    assert.ok(html.includes("moga-empty-state"), "Debe mostrar empty-state");
    assert.ok(html.includes("No hay discrepancias en esta categoría"), "Mensaje de sin discrepancias");
    assert.ok(html.includes("🎉"), "Emoji de celebración");
  });

  await runEmpiricalTest("Discrepancias con resultado null o undefined", () => {
    const htmlNull = generarDiscrepanciasMogaHTML(null, "todos");
    assert.ok(htmlNull.includes("moga-empty-state"), "Debe manejar null sin lanzar excepción");

    const htmlUndef = generarDiscrepanciasMogaHTML(undefined, "todos");
    assert.ok(htmlUndef.includes("moga-empty-state"), "Debe manejar undefined sin lanzar excepción");

    const htmlVacio = generarDiscrepanciasMogaHTML({}, "todos");
    assert.ok(htmlVacio.includes("moga-empty-state"), "Debe manejar objeto vacío sin lanzar excepción");
  });

  // ==========================================
  // SUITE 2: MASSIVE NUMBERS & NUMBER PARSING
  // ==========================================
  console.log("\n--- Suite 2: Massive Numbers and Type Robustness ---");

  await runEmpiricalTest("Resumen con números masivos (10 millones)", () => {
    const resumen = {
      total_local: 10000000,
      total_moga: 9999999,
      coincidentes: 9500000,
      discrepancias_totales: 500000
    };
    const html = renderizarResumenMogaHTML(resumen);
    assert.ok(html.includes("10000000"), "Debe renderizar 10000000");
    assert.ok(html.includes("500000 Discrepancias Detectadas"), "Debe formatear plural de discrepancias");
    assert.ok(html.includes("status-warning"), "Debe ser status-warning");
  });

  await runEmpiricalTest("Resumen con números pasados como cadenas de texto", () => {
    const resumenStrings = {
      total_local: "150",
      total_moga: "148",
      coincidentes: "145",
      discrepancias_totales: "5"
    };
    const html = renderizarResumenMogaHTML(resumenStrings);
    assert.ok(html.includes("150"), "Debe convertir y renderizar 150");
    assert.ok(html.includes("5 Discrepancias Detectadas"), "Debe detectar discrepancias desde string '5'");
  });

  await runEmpiricalTest("Resumen con discrepancias_totales = 1 (singular)", () => {
    const resumen1 = {
      total_local: 10,
      total_moga: 10,
      coincidentes: 9,
      discrepancias_totales: 1
    };
    const html = renderizarResumenMogaHTML(resumen1);
    assert.ok(html.includes("1 Discrepancia Detectada"), "Debe usar singular '1 Discrepancia Detectada'");
    assert.ok(!html.includes("1 Discrepancias"), "No debe usar plural con 1");
  });

  await runEmpiricalTest("Resumen con valores no numéricos (strings arbitrarios -> NaN)", () => {
    const resumenInvalido = {
      total_local: "no_es_un_numero",
      discrepancias_totales: "invalido"
    };
    const html = renderizarResumenMogaHTML(resumenInvalido);
    assert.ok(html.includes("NaN"), "Number('invalido') es NaN y se renderiza sin romper");
    assert.ok(html.includes("status-warning"), "NaN !== 0 por lo que asume warning seguro");
  });

  // ==========================================
  // SUITE 3: MISSING KEYS & NULL FIELDS IN DISCREPANCIES
  // ==========================================
  console.log("\n--- Suite 3: Missing Keys and Null Fields in Discrepancy Items ---");

  await runEmpiricalTest("Item completamente vacío {}", () => {
    const resultado = {
      no_en_moga: [{}]
    };
    const html = generarDiscrepanciasMogaHTML(resultado, "no_en_moga");
    assert.ok(html.includes("moga-discrepancia-card"), "Debe renderizar la tarjeta");
    assert.ok(html.includes("-"), "Al no haber crotal ni crotal_4, debe mostrar fallback '-'");
  });

  await runEmpiricalTest("Item con campos explícitamente null", () => {
    const resultado = {
      no_en_moga: [{
        crotal: null,
        crotal_4: null,
        motivo: null,
        corral: null,
        estado_moga: null,
        explotacion: null
      }]
    };
    const html = generarDiscrepanciasMogaHTML(resultado, "no_en_moga");
    assert.ok(html.includes("moga-discrepancia-card"), "Debe renderizar la tarjeta sin excepción");
    assert.ok(html.includes("-"), "Fallback de crotal_4 debe ser '-'");
  });

  await runEmpiricalTest("Item con crotal completo pero sin crotal_4 (deducción automática)", () => {
    const resultado = {
      bajas_oficiales_activas_local: [{
        crotal: "ES012345678954",
        // sin crotal_4
        motivo: "Dado de baja en MoGa"
      }]
    };
    const html = generarDiscrepanciasMogaHTML(resultado, "bajas_oficiales_activas_local");
    assert.ok(html.includes("8954"), "Debe extraer los 4 dígitos '8954' automáticamente mediante extraer4Digitos");
    assert.ok(html.includes("ES012345678954"), "Debe contener el crotal completo");
  });

  await runEmpiricalTest("Item con crotal no numérico o corto", () => {
    const resultado = {
      no_en_campo: [{
        crotal: "VACA-1",
        motivo: "Sin crotal oficial estándar"
      }]
    };
    const html = generarDiscrepanciasMogaHTML(resultado, "no_en_campo");
    assert.ok(html.includes("1"), "extraer4Digitos de 'VACA-1' extrae '1'");
    assert.ok(html.includes("VACA-1"), "Muestra crotal original");
  });

  await runEmpiricalTest("Item con tipos no string en campos opcionales (números)", () => {
    const resultado = {
      bajas_locales_activas_oficial: [{
        crotal: "ES123456789012",
        crotal_4: "9012",
        motivo: "Baja local activa en MoGa",
        corral: 104, // número
        explotacion: 371261100122 // número
      }]
    };
    const html = generarDiscrepanciasMogaHTML(resultado, "bajas_locales_activas_oficial");
    assert.ok(html.includes("104"), "Debe convertir número 104 a string");
    assert.ok(html.includes("371261100122"), "Debe convertir número a string");
  });

  // ==========================================
  // SUITE 4: FILTER SWITCHING & NON-MATCHING
  // ==========================================
  console.log("\n--- Suite 4: Filter Switching & Non-Matching Categories ---");

  const resultadoMulticategoria = {
    no_en_moga: [
      { crotal: "ES011111111111", crotal_4: "1111", motivo: "Motivo 1" }
    ],
    bajas_oficiales_activas_local: [
      { crotal: "ES022222222222", crotal_4: "2222", motivo: "Motivo 2" }
    ],
    bajas_locales_activas_oficial: [],
    no_en_campo: []
  };

  await runEmpiricalTest("Filtro 'todos' incluye todas las categorías con elementos", () => {
    const html = generarDiscrepanciasMogaHTML(resultadoMulticategoria, "todos");
    assert.ok(html.includes("1111"), "Debe incluir 1111");
    assert.ok(html.includes("2222"), "Debe incluir 2222");
  });

  await runEmpiricalTest("Filtro 'no_en_moga' aísla solo su categoría", () => {
    const html = generarDiscrepanciasMogaHTML(resultadoMulticategoria, "no_en_moga");
    assert.ok(html.includes("1111"), "Debe incluir 1111");
    assert.ok(!html.includes("2222"), "No debe incluir 2222");
  });

  await runEmpiricalTest("Filtro sobre categoría vacía ('bajas_locales_activas_oficial') muestra empty-state", () => {
    const html = generarDiscrepanciasMogaHTML(resultadoMulticategoria, "bajas_locales_activas_oficial");
    assert.ok(html.includes("moga-empty-state"), "Debe mostrar empty-state");
    assert.ok(!html.includes("1111"), "No debe incluir 1111");
    assert.ok(!html.includes("2222"), "No debe incluir 2222");
  });

  await runEmpiricalTest("Filtro con valor desconocido o inválido ('categoria_fantasma')", () => {
    const html = generarDiscrepanciasMogaHTML(resultadoMulticategoria, "categoria_fantasma");
    assert.ok(html.includes("moga-empty-state"), "Filtro no coincidente debe devolver empty-state de forma segura");
  });

  await runEmpiricalTest("Filtro con null o undefined", () => {
    const htmlNull = generarDiscrepanciasMogaHTML(resultadoMulticategoria, null);
    assert.ok(htmlNull.includes("moga-empty-state"), "Filtro null devuelve empty-state sin lanzar excepción");

    const htmlUndef = generarDiscrepanciasMogaHTML(resultadoMulticategoria, undefined);
    // Nota: filtro = "todos" por defecto de parámetro JS si es undefined
    assert.ok(htmlUndef.includes("1111"), "Filtro undefined usa default 'todos'");
  });

  // ==========================================
  // SUITE 5: HTML INJECTION & XSS DEFENSE
  // ==========================================
  console.log("\n--- Suite 5: HTML Injection and XSS Escaping ---");

  await runEmpiricalTest("Sanitización en motivo con etiquetas script y eventos", () => {
    const resultadoXSS = {
      no_en_moga: [{
        crotal: "ES012345678999",
        crotal_4: "8999",
        motivo: "<script>alert('pwned')</script><img src=x onerror=alert(1)>",
        corral: "<b>CORRAL</b>",
        estado_moga: "'; alert('xss'); '",
        explotacion: "<iframe src='javascript:alert(2)'>"
      }]
    };
    const html = generarDiscrepanciasMogaHTML(resultadoXSS, "no_en_moga");

    // Verificar que NO existe inyección de tags ejecutables
    assert.ok(!html.includes("<script>"), "No debe contener <script> sin escapar");
    assert.ok(!html.includes("<img src=x"), "No debe contener <img sin escapar");
    assert.ok(!html.includes("<b>CORRAL</b>"), "No debe interpretar tags HTML en corral");
    assert.ok(!html.includes("<iframe"), "No debe contener <iframe");

    // Verificar que los caracteres están correctamente escapados
    assert.ok(html.includes("&lt;script&gt;alert(&#039;pwned&#039;)&lt;/script&gt;"), "Script tag debe estar completamente escapado");
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "Img tag debe estar escapado");
    assert.ok(html.includes("&lt;b&gt;CORRAL&lt;/b&gt;"), "Bold tag en corral debe estar escapado");
    assert.ok(html.includes("&lt;iframe src=&#039;javascript:alert(2)&#039;&gt;"), "Iframe tag debe estar escapado");
  });

  await runEmpiricalTest("Sanitización en crotal y crotal_4 con vectores XSS", () => {
    const resultadoCrotalXSS = {
      no_en_campo: [{
        crotal: "\"><svg/onload=alert('crotal')>",
        crotal_4: "<script>",
        motivo: "Prueba XSS en identificadores"
      }]
    };
    const html = generarDiscrepanciasMogaHTML(resultadoCrotalXSS, "no_en_campo");

    assert.ok(!html.includes("<svg/onload"), "No debe contener tag svg sin escapar");
    assert.ok(!html.includes("<script>"), "No debe contener script sin escapar");
    assert.ok(html.includes("&quot;&gt;&lt;svg/onload=alert(&#039;crotal&#039;)&gt;"), "Crotal con comillas y corchetes debe estar neutralizado");
    assert.ok(html.includes("&lt;script&gt;"), "crotal_4 debe estar escapado");
  });

  await runEmpiricalTest("Sanitización en valores del resumen", () => {
    const resumenXSS = {
      total_local: "<script>alert(1)</script>",
      total_moga: "\"><img src=x>",
      coincidentes: "<b>100</b>",
      discrepancias_totales: 0
    };
    const html = renderizarResumenMogaHTML(resumenXSS);

    // Number(...) convierte a NaN
    assert.ok(!html.includes("<script>"), "No debe inyectar script en resumen");
    assert.ok(!html.includes("<img"), "No debe inyectar img en resumen");
    assert.ok(!html.includes("<b>"), "No debe inyectar b en resumen");
    assert.ok(html.includes("NaN"), "Strings no numéricos son transformados a NaN");
  });

  // ==========================================
  // SUITE 6: CONCILIAR ARCHIVO MOGA (HTTP CLIENT)
  // ==========================================
  console.log("\n--- Suite 6: conciliarArchivoMoga HTTP Client & Network Errors ---");

  // Proveer mock de localStorage para entornos Node.js
  globalThis.localStorage = {
    getItem: (key) => (key === "campo_pwa_token" ? "jwt_token_sample" : null),
    setItem: () => {},
    removeItem: () => {}
  };

  await runEmpiricalTest("conciliarArchivoMoga lanza error si no se pasa archivo", async () => {
    await assert.rejects(
      async () => await conciliarArchivoMoga(null),
      /Debe seleccionar un archivo CSV/
    );
    await assert.rejects(
      async () => await conciliarArchivoMoga(undefined),
      /Debe seleccionar un archivo CSV/
    );
  });

  await runEmpiricalTest("conciliarArchivoMoga maneja fallos de red (fetch reject)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    try {
      const mockFile = new Blob(["test,csv"], { type: "text/csv" });
      await assert.rejects(
        async () => await conciliarArchivoMoga(mockFile),
        /Error de red: no se pudo contactar con el servidor/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runEmpiricalTest("conciliarArchivoMoga maneja error 400 (CSV vacío)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ detail: "El archivo CSV está vacío." })
    });

    try {
      const mockFile = new Blob([""], { type: "text/csv" });
      await assert.rejects(
        async () => await conciliarArchivoMoga(mockFile),
        /El archivo CSV está vacío/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runEmpiricalTest("conciliarArchivoMoga maneja error 413 (exceso de tamaño sin json)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 413,
      json: async () => { throw new Error("Not JSON"); }
    });

    try {
      const mockFile = new Blob(["too large"], { type: "text/csv" });
      await assert.rejects(
        async () => await conciliarArchivoMoga(mockFile),
        /El archivo CSV excede el tamaño máximo permitido \(10 MB\)/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runEmpiricalTest("conciliarArchivoMoga maneja error 503 (servicio no disponible)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ detail: "Servicio de censo no disponible en el servidor." })
    });

    try {
      const mockFile = new Blob(["data"], { type: "text/csv" });
      await assert.rejects(
        async () => await conciliarArchivoMoga(mockFile),
        /Servicio de censo no disponible en el servidor/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runEmpiricalTest("conciliarArchivoMoga llamada exitosa devuelve datos JSON y cabecera Auth", async () => {
    const mockResponseData = {
      ok: true,
      resumen: { total_local: 10, total_moga: 10, coincidentes: 10, discrepancias_totales: 0 },
      no_en_moga: [],
      bajas_oficiales_activas_local: [],
      bajas_locales_activas_oficial: [],
      no_en_campo: []
    };

    let fetchHeaders = null;
    let fetchBody = null;
    let fetchUrl = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      fetchUrl = url;
      fetchHeaders = opts.headers;
      fetchBody = opts.body;
      return {
        ok: true,
        status: 200,
        json: async () => mockResponseData
      };
    };

    try {
      const mockFile = new Blob(["crotal;fecha\nES1;2026-01-01"], { type: "text/csv" });
      const res = await conciliarArchivoMoga(mockFile);

      assert.strictEqual(fetchUrl, "./api/censo/conciliar-moga");
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.resumen.discrepancias_totales, 0);
      assert.strictEqual(fetchHeaders["Content-Type"], undefined, "Content-Type manual debe haber sido suprimido para boundary FormData");
      assert.strictEqual(fetchHeaders["Authorization"], "Bearer jwt_token_sample", "Debe propagar token Bearer de autenticación");
      assert.ok(fetchBody instanceof FormData, "Body debe ser instancia de FormData");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Limpiar mock localStorage
  delete globalThis.localStorage;

  // ==========================================
  // SUITE 7: DOM MOCK & MODAL LIFECYCLE
  // ==========================================
  console.log("\n--- Suite 7: DOM Mock & Modal Lifecycle ---");

  await runEmpiricalTest("abrirModalConciliacionMoga crea y gestiona elementos DOM", () => {
    // Mock mínimo de DOM en Node.js
    const elementsById = new Map();
    const mockHead = {
      appendChild: (el) => {}
    };
    const mockBody = {
      appendChild: (el) => {
        elementsById.set(el.id, el);
      }
    };

    class MockElement {
      constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.id = "";
        this.className = "";
        this.style = {};
        this._innerHTML = "";
        this.listeners = new Map();
        this.dataset = {};
        this.files = [];
      }
      set innerHTML(val) {
        this._innerHTML = val;
        // Parsear IDs sencillos presentes en el innerHTML para getElementById
        const idMatches = [...val.matchAll(/id="([^"]+)"/g)];
        for (const m of idMatches) {
          const childId = m[1];
          const childEl = new MockElement("div");
          childEl.id = childId;
          elementsById.set(childId, childEl);
        }
      }
      get innerHTML() {
        return this._innerHTML;
      }
      addEventListener(evt, handler) {
        if (!this.listeners.has(evt)) this.listeners.set(evt, []);
        this.listeners.get(evt).push(handler);
      }
      querySelectorAll(selector) {
        return [];
      }
    }

    globalThis.document = {
      getElementById: (id) => elementsById.get(id) || null,
      createElement: (tag) => new MockElement(tag),
      body: mockBody,
      head: mockHead
    };

    try {
      abrirModalConciliacionMoga();
      const modal = document.getElementById("modal-conciliacion-moga");
      assert.ok(modal, "El modal singleton debe haberse creado en el DOM");
      assert.strictEqual(modal.style.display, "flex", "El modal debe desplegarse con display: flex");

      // Comprobar elementos internos creados
      assert.ok(document.getElementById("btn-cerrar-modal-moga"), "btn-cerrar-modal-moga debe existir en el DOM");
      assert.ok(document.getElementById("input-csv-moga"), "input-csv-moga debe existir en el DOM");
      assert.ok(document.getElementById("btn-subir-moga"), "btn-subir-moga debe existir en el DOM");
      assert.ok(document.getElementById("btn-reiniciar-moga"), "btn-reiniciar-moga debe existir en el DOM");
    } finally {
      delete globalThis.document;
    }
  });

  // ==========================================
  // RESUMEN FINAL
  // ==========================================
  console.log("\n==================================================");
  console.log(`RESULTADO RETO EMPÍRICO: ${passed}/${total} superados con éxito.`);
  console.log("==================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
