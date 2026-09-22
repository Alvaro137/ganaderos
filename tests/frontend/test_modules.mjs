// tests/frontend/test_modules.mjs
/**
 * Suite de pruebas unitarias para módulos frontend (ES Modules).
 * Valida heurísticas offline, sanitización XSS, formateadores, pila de navegación
 * e integridad de exportaciones en todos los módulos de la aplicación.
 */

import assert from 'node:assert';
import { resolverConsultaOffline } from '../../pwa/js/modules/heuristics.js';
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
  // 1. Tests de Heurísticas Offline de Campo
  await test("Heurística: Búsqueda por 4 dígitos directa", () => {
    const res = resolverConsultaOffline("dame la vaca 1045");
    assert.ok(res, "Debe clasificar consulta");
    assert.strictEqual(res.tipo_resultado, "animales");
    assert.strictEqual(res.params[0], "1045");
    assert.ok(res.sql.includes("WHERE crotal_4 = ?"));
  });

  await test("Heurística: Partos y descendencia de madre por 4 dígitos", () => {
    const res = resolverConsultaOffline("partos y crías de la 2030");
    assert.ok(res, "Debe clasificar consulta");
    assert.strictEqual(res.tipo_resultado, "partos");
    assert.strictEqual(res.params[0], "2030");
    assert.ok(res.sql.includes("partos"));
  });

  await test("Heurística: Censo por corral de pasto (Dueña)", () => {
    const res = resolverConsultaOffline("animales en corral Dueña");
    assert.ok(res, "Debe detectar corral Dueña");
    assert.strictEqual(res.tipo_resultado, "animales");
    assert.deepStrictEqual(res.params, ["%DUEÑA%"]);
    assert.ok(res.sql.includes("UPPER(corral) LIKE ?"));
  });

  await test("Heurística: Vacas adultas sin parir", () => {
    const res = resolverConsultaOffline("vacas sin parir este año");
    assert.ok(res, "Debe detectar intención de nodrizas vacías");
    assert.strictEqual(res.tipo_resultado, "animales");
    assert.ok(res.sql.includes("fecha_ult_parto IS NULL"));
  });

  await test("Heurística: Tratamientos con supresión sanitaria activa", () => {
    const res = resolverConsultaOffline("¿Qué medicamentos tienen retirada sanitaria o supresión?");
    assert.ok(res, "Debe detectar consulta sanitaria");
    assert.strictEqual(res.tipo_resultado, "recetas");
    assert.ok(res.sql.includes("tiempo_carne > 0"));
  });

  await test("Heurística: Traspasos hacia cebadero 122", () => {
    const res = resolverConsultaOffline("traspasos recientes al cebadero");
    assert.ok(res, "Debe detectar movimiento de traspaso");
    assert.strictEqual(res.tipo_resultado, "movimientos");
    assert.ok(res.sql.includes("121") && res.sql.includes("122"));
  });

  await test("Heurística: Crotal oficial completo de 14 dígitos", () => {
    const res = resolverConsultaOffline("vaca ES083710104599");
    assert.ok(res, "Debe detectar crotal oficial");
    assert.strictEqual(res.tipo_resultado, "animales");
    assert.strictEqual(res.params[0], "4599");
  });

  await test("Heurística: Compras de pienso y alimentación", () => {
    const res = resolverConsultaOffline("compras de pienso de este mes");
    assert.ok(res, "Debe detectar intención de alimentos");
    assert.strictEqual(res.tipo_resultado, "alimentos");
    assert.ok(res.sql.includes("compras_alimento"));
  });

  await test("Heurística: Medicamento veterinario más usado", () => {
    const res = resolverConsultaOffline("¿Cuál es el medicamento más usado?");
    assert.ok(res, "Debe detectar medicamento más frecuente");
    assert.strictEqual(res.tipo_resultado, "recetas");
    assert.ok(res.sql.includes("COUNT(*) AS total_recetas"));
  });

  await test("Heurística: Normalización de números con espacios Whisper (10 45)", () => {
    const res = resolverConsultaOffline("vaca 10 45");
    assert.ok(res, "Debe normalizar espacios y detectar animal");
    assert.strictEqual(res.tipo_resultado, "animales");
    assert.strictEqual(res.params[0], "1045");
  });

  // 2. Tests de Formateo y Utilidades de Negocio Ganadero
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

  await test("Integridad ES Modules: Exportaciones de views modulares", async () => {
    const modCattle = await import('../../pwa/js/modules/views/cattle_view.js');
    assert.strictEqual(typeof modCattle.renderVistaAnimales, "function");

    const modDetail = await import('../../pwa/js/modules/views/detail_view.js');
    assert.strictEqual(typeof modDetail.seleccionarAnimal, "function");
    assert.strictEqual(typeof modDetail.verDetalleCorral, "function");

    const modAssistant = await import('../../pwa/js/modules/views/assistant_view.js');
    assert.strictEqual(typeof modAssistant.setupAsistenteIA, "function");
  });

  console.log("==================================================");
  console.log(`RESULTADO: ${testsExitosos}/${testsEjecutados} tests superados con éxito.`);
  console.log("==================================================");

  if (testsExitosos !== testsEjecutados) {
    process.exit(1);
  }
}

runAllTests();
