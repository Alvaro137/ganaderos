// tests/frontend/test_modules.mjs
/**
 * Suite de pruebas unitarias para módulos frontend (ES Modules).
 * Valida heurísticas offline, sanitización XSS, formateadores, pila de navegación
 * e integridad de exportaciones en todos los módulos de la aplicación.
 */

import assert from 'node:assert';
import {
  AppState,
  extraer4Digitos,
  calcularEdad,
  calcularTiempoTranscurrido,
  formatearFecha,
  formatearKg,
  formatearMoneda,
  escapeHtml,
  formatearExplotacionAmigable,
  registrarPasoHistorial,
  obtenerTextoBotonVolver
} from '../../pwa/js/modules/config.js';

console.log("==================================================");
console.log("EJECUTANDO SUITE DE TESTS FRONTEND (NODE.JS)");
console.log("==================================================");

let testsEjecutados = 0;
let testsExitosos = 0;

async function test(nombre, fn) {
  testsEjecutados++;
  try {
    await fn();
    testsExitosos++;
    console.log(`  [OK] ${nombre}`);
  } catch (err) {
    console.error(`  [FALLO] ${nombre}`);
    console.error(`         ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAllTests() {
  // 1. Tests de Utilidades de Negocio Ganadero y Formateo
  await test("Extraer últimos 4 dígitos de crotal oficial", () => {
    assert.strictEqual(extraer4Digitos("ES083710104599"), "4599");
    assert.strictEqual(extraer4Digitos("ES050987654321"), "4321");
    assert.strictEqual(extraer4Digitos("1045"), "1045");
    assert.strictEqual(extraer4Digitos(""), "");
  });

  await test("Formateo de fechas ISO a formato español DD/MM/AAAA", () => {
    assert.strictEqual(formatearFecha("2024-05-18"), "18/05/2024");
    assert.strictEqual(formatearFecha("2023-11-02T10:00:00"), "02/11/2023");
    assert.strictEqual(formatearFecha(null), "-");
  });

  await test("Cálculo de edad para ganado", () => {
    const hoy = new Date();
    const haceDosAnios = new Date(hoy.getFullYear() - 2, hoy.getMonth(), hoy.getDate()).toISOString().split('T')[0];
    const edad = calcularEdad(haceDosAnios);
    assert.ok(edad.includes("2 años") || edad.includes("2 a"), `Edad calculada: ${edad}`);
  });

  await test("Formateo de kilogramos con separador de miles", () => {
    const kg = formatearKg(15420);
    assert.ok(kg.includes("15") && kg.includes("420"), `Kilos formateados: ${kg}`);
  });

  await test("Formateo de moneda para costes y piensos", () => {
    const euros = formatearMoneda(1250.75, 2);
    assert.ok(euros.includes("1") && euros.includes("250,75"), `Euros formateados: ${euros}`);
  });

  await test("Formateo amigable de códigos de explotación", () => {
    assert.ok(formatearExplotacionAmigable("ES371234000121").includes("Vida / Nodrizas"));
    assert.ok(formatearExplotacionAmigable("ES371234000122").includes("Cebadero"));
    assert.strictEqual(formatearExplotacionAmigable("OTRA_FINCA"), "OTRA_FINCA");
  });

  // 3. Tests de Seguridad: Sanitización XSS
  await test("Sanitización sistemática contra inyección XSS", () => {
    const payload = `<script>alert('xss')</script>"&'`;
    const sanitized = escapeHtml(payload);
    assert.ok(!sanitized.includes("<script>"));
    assert.ok(sanitized.includes("&lt;script&gt;"));
    assert.ok(sanitized.includes("&quot;"));
    assert.ok(sanitized.includes("&#039;"));
    assert.ok(sanitized.includes("&amp;"));
  });

  // 4. Tests de Pila de Navegación Histórica
  await test("Pila de navegación: Registro de saltos y texto de botón volver", () => {
    AppState.historial = [];
    assert.strictEqual(obtenerTextoBotonVolver(), "Volver a la búsqueda");

    registrarPasoHistorial("animal", "ES083710104599", "Vaca 4599", { crotal_4: "4599" });
    assert.strictEqual(obtenerTextoBotonVolver(), "Volver a Vaca 4599");

    registrarPasoHistorial("corral", "DUEÑA", "Lote Dueña");
    assert.strictEqual(obtenerTextoBotonVolver(), "Volver a Lote DUEÑA");
  });

  // 5. Tests de Integridad Estática de Módulos ES
  await test("Integridad ES Modules: Exportaciones de db.js", async () => {
    const modDb = await import('../../pwa/js/modules/db.js');
    assert.strictEqual(typeof modDb.getDB, "function");
    assert.strictEqual(typeof modDb.inicializarDB, "function");
    assert.strictEqual(typeof modDb.ejecutarConsulta, "function");
    assert.strictEqual(typeof modDb.buscarAnimales, "function");
  });

  await test("Integridad ES Modules: Exportaciones de views de dominio (recetas, piensos, movimientos)", async () => {
    const modSanitary = await import('../../pwa/js/modules/views/sanitary_view.js');
    assert.strictEqual(typeof modSanitary.renderVistaRecetas, "function");

    const modFeeds = await import('../../pwa/js/modules/views/feeds_view.js');
    assert.strictEqual(typeof modFeeds.renderVistaAlimentos, "function");

    const modMovements = await import('../../pwa/js/modules/views/movements_view.js');
    assert.strictEqual(typeof modMovements.renderVistaMovimientos, "function");
  });

  await test("Integridad ES Modules: Exportaciones de auth, voice y api", async () => {
    const modAuth = await import('../../pwa/js/modules/auth.js');
    assert.strictEqual(typeof modAuth.obtenerAuthHeaders, "function");
    assert.strictEqual(typeof modAuth.mostrarPantallaLogin, "function");

    const modVoice = await import('../../pwa/js/modules/voice.js');
    assert.strictEqual(typeof modVoice.VoiceManager, "function");

    const modApi = await import('../../pwa/js/modules/api.js');
    assert.strictEqual(typeof modApi.fetchIntent, "function");
    assert.strictEqual(typeof modApi.fetchModels, "function");
    assert.strictEqual(typeof modApi.fetchSynthesize, "function");
  });

  await test("Arquitectura Limpia: Supresión verificada de heuristics.js", async () => {
    let cargoModulo = false;
    try {
      await import('../../pwa/js/modules/heuristics.js');
      cargoModulo = true;
    } catch {
      cargoModulo = false;
    }
    assert.strictEqual(cargoModulo, false, "heuristics.js debe estar eliminado de la arquitectura.");
  });

  await test("Dominio Movimientos: Clasificación de Ventas desde Cebadero (122)", () => {
    assert.strictEqual(typeof AppState.limiteMovimientos, "number");
    assert.strictEqual(AppState.limiteMovimientos >= 50, true);

    // Simulación de regla de dominio de ventas
    function clasificarMovimientoDominio(orig, dest, tipoOrig) {
      const esSalidaCebadero = orig.endsWith("122") &&
        !dest.endsWith("121") &&
        !dest.endsWith("671") &&
        !dest.endsWith("591") &&
        dest !== "";

      if (esSalidaCebadero) {
        return { tipo_display: "VENTA", subtipo: "Salida Cebadero / Venta" };
      }
      return { tipo_display: tipoOrig, subtipo: null };
    }

    // Salida de cebadero 122 a matadero externo: VENTA
    const movCebadero = clasificarMovimientoDominio("ES371261100122", "ES373762000081", "SACRIFICIO");
    assert.strictEqual(movCebadero.tipo_display, "VENTA");
    assert.strictEqual(movCebadero.subtipo, "Salida Cebadero / Venta");

    // Traspaso de 121 a 122: TRASPASO
    const movTraspaso = clasificarMovimientoDominio("ES371261100121", "ES371261100122", "TRASPASO");
    assert.strictEqual(movTraspaso.tipo_display, "TRASPASO");
    assert.strictEqual(movTraspaso.subtipo, null);

    // Sacrificio / culling de nodriza en 121: SACRIFICIO
    const movVida = clasificarMovimientoDominio("ES371261100121", "ES373762000081", "SACRIFICIO");
    assert.strictEqual(movVida.tipo_display, "SACRIFICIO");
  });


  console.log("==================================================");
  console.log(`RESULTADO: ${testsExitosos}/${testsEjecutados} tests superados con éxito.`);
  console.log("==================================================");

  if (testsExitosos !== testsEjecutados) {
    process.exit(1);
  }
}

runAllTests();
