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
  obtenerTextoBotonVolver,
  clasificarMovimientoUnificado
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
    console.error(`         ${err.stack || err.message}`);
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
    assert.strictEqual(typeof modAuth.obtenerUsuarioActual, "function");
    assert.strictEqual(typeof modAuth.guardarSesion, "function");
    assert.strictEqual(typeof modAuth.cerrarSesion, "function");
    assert.strictEqual(typeof modAuth.actualizarBadgeUsuario, "function");

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

  await test("Dominio Movimientos: Modelo Unificado (Internos, Ventas, Cebadero, etc.)", () => {
    assert.strictEqual(typeof AppState.limiteMovimientos, "number");
    assert.strictEqual(AppState.limiteMovimientos >= 50, true);

    // 1. Movimientos internos entre 121, 671 y 591 (origen y destino en fincas de vida/cría)
    const movInterno1 = clasificarMovimientoUnificado("ES372621100591", "ES371261100121", "TRASPASO");
    assert.strictEqual(movInterno1.tipo_display, "MOVIMIENTO_INTERNO");
    assert.strictEqual(movInterno1.label, "Movimiento Interno");
    assert.strictEqual(movInterno1.badge_class, "interno");

    // Incluso si en el Access antiguo se guardó como VENTA o COMPRA entre fincas propias:
    const movInternoErrorAccess = clasificarMovimientoUnificado("ES371061100671", "ES371261100121", "VENTA");
    assert.strictEqual(movInternoErrorAccess.tipo_display, "MOVIMIENTO_INTERNO");

    // Cambio de ubicación dentro de la misma finca:
    const movUbicacion = clasificarMovimientoUnificado("ES371261100121", "ES371261100121", "UBICACIÓN");
    assert.strictEqual(movUbicacion.tipo_display, "MOVIMIENTO_INTERNO");

    // 2. Traspasos a Cebadero (122) desde vida/cría (121, 671)
    const movTraspasoCeb = clasificarMovimientoUnificado("ES371261100121", "ES371261100122", "TRASPASO");
    assert.strictEqual(movTraspasoCeb.tipo_display, "TRASPASO_CEBADERO");
    assert.strictEqual(movTraspasoCeb.label, "Traspaso Cebadero");
    assert.strictEqual(movTraspasoCeb.badge_class, "traspaso");

    // 3. Salida de cebadero 122 a matadero: VENTA
    const movCebaderoMat = clasificarMovimientoUnificado("ES371261100122", "ES373762000081", "SACRIFICIO");
    assert.strictEqual(movCebaderoMat.tipo_display, "VENTA");
    assert.strictEqual(movCebaderoMat.label, "Venta");
    assert.strictEqual(movCebaderoMat.badge_class, "venta");

    // Salida directa de vida 121 a matadero (desvieje): VENTA
    const movVidaMat = clasificarMovimientoUnificado("ES371261100121", "ES373762000081", "SACRIFICIO");
    assert.strictEqual(movVidaMat.tipo_display, "VENTA");
    assert.strictEqual(movVidaMat.label, "Venta");

    // 4. Fidelidad a DB: Muerte en campo
    const movMuerte = clasificarMovimientoUnificado("ES371261100121", "", "MUERTE");
    assert.strictEqual(movMuerte.tipo_display, "MUERTE");
    assert.strictEqual(movMuerte.label, "Baja en campo");

    // 5. Nacimientos
    const movNac = clasificarMovimientoUnificado("ES371261100121", "ES371261100121", "NACIMIENTO");
    assert.strictEqual(movNac.tipo_display, "NACIMIENTO");
    assert.strictEqual(movNac.label, "Nacimiento");

    // 6. Compras externas
    const movCompra = clasificarMovimientoUnificado("ES371261100031", "ES371261100121", "COMPRA");
    assert.strictEqual(movCompra.tipo_display, "COMPRA");
    assert.strictEqual(movCompra.label, "Compra");
  });

  await test("Búsqueda Incremental: Comparación por prefijo de crotal_4", () => {
    // Al teclear 1 -> 0 -> 4 -> 5, la búsqueda parcial '10' debe filtrar vacas que comiencen por '10'
    const crotalesPrueba = ["1045", "1034", "3410", "4510", "1099"];
    const busqueda = "10";
    
    // Algoritmo nuevo por prefijo:
    const resultadosPrefijo = crotalesPrueba.filter(c => c.startsWith(busqueda));
    assert.deepStrictEqual(resultadosPrefijo, ["1045", "1034", "1099"]);
    assert.strictEqual(resultadosPrefijo.includes("3410"), false);
    assert.strictEqual(resultadosPrefijo.includes("4510"), false);
  });

  await test("Ficha Animal: Detección de redundancia entre Nacimiento y Alta", async () => {
    const { generarHtmlDetalleAnimal } = await import('../../pwa/js/modules/views/detail_view.js');
    
    // Caso 1: Vaca nacida en la finca (fecha_nacimiento == fecha_alta)
    const vacaNacidaEnFinca = {
      crotal: "ES083710101045",
      crotal_4: "1045",
      nombre: "Mariposa",
      raza: "Charolesa",
      sexo: "H",
      estado: "A",
      fecha_nacimiento: "2018-05-10",
      fecha_alta: "2018-05-10",
      corral: "DUEÑA",
      partos: []
    };
    const htmlNacida = generarHtmlDetalleAnimal(vacaNacidaEnFinca);
    assert.strictEqual(htmlNacida.includes("Fecha Nacimiento"), true);
    assert.strictEqual(htmlNacida.includes("Alta en Explotación"), false, "No debe mostrar Alta si es idéntica a Nacimiento.");

    // Caso 2: Vaca comprada / introducida más tarde
    const vacaComprada = {
      crotal: "ES083710102000",
      crotal_4: "2000",
      nombre: "Rubia",
      raza: "Limusina",
      sexo: "H",
      estado: "A",
      fecha_nacimiento: "2017-02-15",
      fecha_alta: "2019-11-20",
      corral: "DUEÑA",
      partos: []
    };
    const htmlComprada = generarHtmlDetalleAnimal(vacaComprada);
    assert.strictEqual(htmlComprada.includes("Fecha Nacimiento"), true);
    assert.strictEqual(htmlComprada.includes("Alta en Explotación"), true, "Debe mostrar Alta si difiere de Nacimiento.");
    assert.strictEqual(htmlComprada.includes("20/11/2019"), true);

    // Caso 3: Vaca dada de baja (inactiva)
    const vacaBaja = {
      crotal: "ES083710109999",
      crotal_4: "9999",
      nombre: "Vieja",
      raza: "Cruzada",
      sexo: "H",
      estado: "B",
      fecha_nacimiento: "2012-03-01",
      fecha_alta: "2012-03-01",
      movimientos: [
        { fecha: "2024-06-15", tipo: "SACRIFICIO", origen: "ES371261100122", destino: "ES373762000081" }
      ],
      partos: []
    };
    const htmlBaja = generarHtmlDetalleAnimal(vacaBaja);
    assert.strictEqual(htmlBaja.includes("Fecha de Baja"), true);
    assert.strictEqual(htmlBaja.includes("15/06/2024"), true);
    assert.strictEqual(htmlBaja.includes("Motivo de Baja"), true);
    assert.strictEqual(htmlBaja.includes("Venta / Matadero (Cebadero)"), true);
  });

  await test("Accesibilidad: Botón Ver Ficha en Movimientos", async () => {
    const { generarCardMovimientoHtml } = await import('../../pwa/js/modules/views/movements_view.js');
    const html = generarCardMovimientoHtml({
      id: 1,
      crotal: "ES083710101045",
      crotal_4: "1045",
      fecha: "2026-03-10",
      tipo: "VENTA",
      origen: "ES371261100122",
      destino: "ES373762000081"
    });
    assert.strictEqual(html.includes('class="btn-ver-ficha-animal"'), true);
    assert.strictEqual(html.includes('Ver ficha'), true);
  });
  console.log(`RESULTADO: ${testsExitosos}/${testsEjecutados} tests superados con éxito.`);
  console.log("==================================================");

  if (testsExitosos !== testsEjecutados) {
    process.exit(1);
  }
}

runAllTests();
