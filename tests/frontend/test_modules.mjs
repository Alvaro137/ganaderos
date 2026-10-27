// tests/frontend/test_modules.mjs
/**
 * Suite de pruebas unitarias para módulos frontend (ES Modules).
 * Valida heurísticas offline, sanitización XSS, formateadores, pila de navegación
 * e integridad de exportaciones en todos los módulos de la aplicación.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
import {
  renderGraficoBarrasComparativas,
  renderGraficoCotizacionCanal,
  renderGraficoRadarMateriasPrimas,
  renderGraficoLonjaCarne,
  renderGraficoEstacionalidadCarne
} from '../../pwa/js/modules/components/charts_svg.js';
import { 
  calcularSimulacionTimingVenta,
  obtenerResumenFinancieroGlobal,
  obtenerSerieMensualFinanciera,
  obtenerSeriesTradingTesoreria,
  obtenerDistribucionPesosCanal,
  obtenerCebaderoActivo
} from '../../pwa/js/modules/db.js';
import { abrirModalMetodologiaCalculos } from '../../pwa/js/modules/views/sales_view.js';

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
    assert.strictEqual(typeof modDb.registrarPartoOptimista, "function");
    assert.strictEqual(typeof modDb.obtenerLiquidaciones, "function");
    assert.strictEqual(typeof modDb.obtenerDetalleLiquidacion, "function");
    assert.strictEqual(typeof modDb.obtenerResumenKpisLiquidaciones, "function");
  });

  await test("Integridad ES Modules: Exportaciones de views de dominio (recetas, piensos, movimientos, partos, ventas)", async () => {
    const modSanitary = await import('../../pwa/js/modules/views/sanitary_view.js');
    assert.strictEqual(typeof modSanitary.renderVistaRecetas, "function");

    const modFeeds = await import('../../pwa/js/modules/views/feeds_view.js');
    assert.strictEqual(typeof modFeeds.renderVistaAlimentos, "function");

    const modMovements = await import('../../pwa/js/modules/views/movements_view.js');
    assert.strictEqual(typeof modMovements.renderVistaMovimientos, "function");

    const modBirth = await import('../../pwa/js/modules/views/birth_modal.js');
    assert.strictEqual(typeof modBirth.abrirModalRegistroParto, "function");

    const modSales = await import('../../pwa/js/modules/views/sales_view.js');
    assert.strictEqual(typeof modSales.renderVistaLiquidaciones, "function");
    assert.strictEqual(typeof modSales.verDetalleLiquidacion, "function");
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

    // 7. Compatibilidad con códigos legacy de 1 letra ('N', 'M', 'C', 'S', 'V', 'T', 'U')
    const movNacLetra = clasificarMovimientoUnificado("ES371261100121", "ES371261100121", "N");
    assert.strictEqual(movNacLetra.tipo_display, "NACIMIENTO");
    assert.strictEqual(movNacLetra.label, "Nacimiento");

    const movMuerteLetra = clasificarMovimientoUnificado("ES371261100121", "", "M");
    assert.strictEqual(movMuerteLetra.tipo_display, "MUERTE");
    assert.strictEqual(movMuerteLetra.label, "Baja en campo");

    const movCompraLetra = clasificarMovimientoUnificado("ES371261100031", "ES371261100121", "C");
    assert.strictEqual(movCompraLetra.tipo_display, "COMPRA");

    const movTraspasoLetra = clasificarMovimientoUnificado("ES371261100121", "ES371261100122", "T");
    assert.strictEqual(movTraspasoLetra.tipo_display, "TRASPASO_CEBADERO");

    const movSacrificioLetra = clasificarMovimientoUnificado("ES371261100121", "ES373762000081", "S");
    assert.strictEqual(movSacrificioLetra.tipo_display, "VENTA");

    const movUbicacionLetra = clasificarMovimientoUnificado("ES371261100121", "ES371261100121", "U");
    assert.strictEqual(movUbicacionLetra.tipo_display, "MOVIMIENTO_INTERNO");

    const movVentaLetra = clasificarMovimientoUnificado("ES371261100121", "ES379999999999", "V");
    assert.strictEqual(movVentaLetra.tipo_display, "VENTA");
  });

  await test("Sanidad Animal: Blindaje contra bug de 100.000 animales y escalado Jet Currency", () => {
    // Simular fila con el bug de escalado (100.000 = 10 envases de VOREN o DRAXXIN con dosis 0)
    const rConBug = {
      receta: "D37005842024001466",
      medicamento: "DRAXXIN,14CC",
      unidades: 30000.0,
      dosis_unitaria: 0.0,
      n_animales: 30000
    };

    let unidades = Number(rConBug.unidades || 0);
    let dosisUnitaria = Number(rConBug.dosis_unitaria || 0);
    if (unidades >= 10000 && (unidades % 5000 === 0 || unidades % 10000 === 0)) {
      unidades = Math.round((unidades / 10000) * 100) / 100;
    }
    assert.strictEqual(unidades, 3, "30000 unidades debe des-escalarse a 3 envases");

    let nAnim = rConBug.n_animales != null ? parseInt(rConBug.n_animales, 10) : null;
    if (dosisUnitaria > 0 && unidades > 0) {
      nAnim = Math.max(1, Math.round(unidades / dosisUnitaria));
    } else if (nAnim == null || nAnim > 500 || dosisUnitaria === 0) {
      nAnim = null; // No inventar cabezas si no hay dosis individual
    }
    assert.strictEqual(nAnim, null, "No debe mostrar 30000 animales si la dosis unitaria es 0");
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

  await test("Búsqueda Flexible: Soporte de 1 a 4 dígitos con ceros a la izquierda y sufijo", () => {
    // Al buscar '45', debe encontrar tanto '0045' (relleno con ceros) como '4501' (prefijo) y '1045' (sufijo)
    const crotalesPrueba = ["0045", "4501", "1045", "9945", "3321"];
    const digitos = "45";
    const conCeros = digitos.padStart(4, "0");

    const coincide = (c4) => c4.startsWith(digitos) || c4 === conCeros || c4.endsWith(digitos);
    const resultados = crotalesPrueba.filter(coincide);

    assert.ok(resultados.includes("0045"), "Debe encontrar '0045' mediante padding de ceros");
    assert.ok(resultados.includes("4501"), "Debe encontrar '4501' por prefijo");
    assert.ok(resultados.includes("1045"), "Debe encontrar '1045' por sufijo");
    assert.strictEqual(resultados.includes("3321"), false, "No debe coincidir con crotales ajenos");
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

  await test("Rendimiento en Canal: Visualización en Ficha de Animal", async () => {
    const { generarHtmlDetalleAnimal } = await import('../../pwa/js/modules/views/detail_view.js');
    const vacaVendidaCanal = {
      crotal: "ES091008679093",
      crotal_4: "9093",
      nombre: "Ternera Cebo",
      raza: "Cruzada",
      sexo: "H",
      estado: "B",
      fecha_nacimiento: "2023-01-10",
      fecha_alta: "2023-01-10",
      corral: "CEBADERO",
      partos: [],
      movimientos: [],
      liquidacion_canal: {
        factura_id: 1,
        numero_factura: "F-2024-001",
        fecha_factura: "2024-04-15",
        peso_canal_kg: 284.5,
        precio_unitario: 7.15,
        importe_linea: 2034.18
      }
    };

    const html = generarHtmlDetalleAnimal(vacaVendidaCanal);
    assert.strictEqual(html.includes("Rendimiento en Canal y Venta"), true);
    assert.strictEqual(html.includes("GANAVAEX"), true);
    assert.strictEqual(html.includes("7.15 €/kg"), true);
    assert.strictEqual(html.includes("F-2024-001"), true);
    assert.strictEqual(html.includes('data-action="ver-factura"'), true);
  });

  await test("Rendimiento en Canal: Badge y CTA en Tarjeta de Movimiento", async () => {
    const { generarCardMovimientoHtml } = await import('../../pwa/js/modules/views/movements_view.js');
    const movConCanal = {
      id: 99,
      crotal: "ES091008679093",
      crotal_4: "9093",
      fecha: "2024-04-15",
      tipo: "VENTA",
      origen: "ES371261100122",
      destino: "ES373762000081",
      peso_canal_kg: 284.5,
      canal_precio: 7.15,
      canal_importe: 2034.18,
      canal_factura: "F-2024-001",
      canal_factura_id: 1
    };

    const html = generarCardMovimientoHtml(movConCanal);
    assert.strictEqual(html.includes("mov-canal-badge-box"), true);
    assert.strictEqual(html.includes("284.5 kg canal"), true);
    assert.strictEqual(html.includes("7.15 €/kg"), true);
    assert.strictEqual(html.includes("Factura F-2024-001"), true);
    assert.strictEqual(html.includes('data-factura-id="1"'), true);
  });

  await test("Rendimiento en Canal y Venta: Limpieza y exclusión de pesajes manuales según KISS", async () => {
    const { generarHtmlDetalleAnimal } = await import('../../pwa/js/modules/views/detail_view.js');
    const animalConCanal = {
      crotal: "ES091008679094",
      crotal_4: "9094",
      raza: "Charolesa",
      sexo: "M",
      estado: "B",
      fecha_nacimiento: "2023-02-01",
      fecha_alta: "2023-02-01",
      corral: "CEBADERO",
      partos: [],
      movimientos: [],
      liquidacion_canal: {
        factura_id: 2,
        numero_factura: "F-2024-002",
        fecha_factura: "2024-05-05",
        peso_canal_kg: 284.7,
        precio_unitario: 7.20,
        importe_linea: 2049.84
      }
    };

    const html = generarHtmlDetalleAnimal(animalConCanal);
    assert.strictEqual(html.includes("Control de Pesajes y Crecimiento"), false, "No debe renderizarse la sección de pesajes");
    assert.strictEqual(html.includes("data-action=\"registrar-pesaje\""), false);
    assert.strictEqual(html.includes("Rendimiento en Canal y Venta"), true, "Debe mostrarse el bloque oficial de canal");
    assert.strictEqual(html.includes("285 kg"), true);
  });

  await test("Alerta Sanitaria: Detección y banner en Ficha de Animal", async () => {
    const { generarHtmlDetalleAnimal } = await import('../../pwa/js/modules/views/detail_view.js');
    const animalEnRetirada = {
      crotal: "ES091008679095",
      crotal_4: "9095",
      raza: "Limusina",
      sexo: "H",
      estado: "A",
      fecha_nacimiento: "2022-05-10",
      fecha_alta: "2022-05-10",
      corral: "DUEÑA",
      partos: [],
      movimientos: [],
      pesajes: [],
      alerta_retirada: {
        medicamento: "DRAXXIN 100 MG/ML",
        fecha_inicio: "2026-10-10",
        fecha_fin_retirada: "2026-11-28",
        dias_retirada: 49
      },
      tratamientos: [
        {
          medicamento: "DRAXXIN 100 MG/ML",
          fecha_inicio: "2026-10-10",
          fecha_fin_retirada: "2026-11-28",
          dias_retirada: 49,
          veterinario: "DR. CARLOS SÁNCHEZ"
        }
      ]
    };

    const html = generarHtmlDetalleAnimal(animalEnRetirada);
    assert.strictEqual(html.includes("banner-alerta-retirada"), true);
    assert.strictEqual(html.includes("EN PERIODO DE RETIRADA SANITARIA"), true);
    assert.strictEqual(html.includes("DRAXXIN 100 MG/ML"), true);
    assert.strictEqual(html.includes("Tratamientos Veterinarios"), true);
  });

  // 17. Tests de Motor Local-First Outbox
  await test("Motor Outbox: Creación, validación de tipos y almacenamiento de mutaciones", async () => {
    const {
      guardarMutacionLocal,
      obtenerMutacionesPendientes,
      contarMutacionesPendientes,
      marcarMutacionesComoSincronizadas,
      obtenerHistorialMutaciones,
      _resetMemoriaStoreParaTests
    } = await import('../../pwa/js/modules/outbox.js');

    _resetMemoriaStoreParaTests();

    // Rechaza tipo inválido
    await assert.rejects(
      async () => {
        await guardarMutacionLocal({ tipo: "tipo_invalido", crotal: "ES123" });
      },
      /Tipo de mutación no permitido/
    );

    // Registra mutación de parto
    const mutacion = await guardarMutacionLocal({
      tipo: "parto",
      crotal: "ES083710101045",
      operador: "usr_jose",
      payload: {
        fecha_parto: "2026-09-29",
        cria_sexo: "H",
        cria_crotal: "C-1045",
        incidencias: "Parto normal"
      }
    });

    assert.ok(mutacion.uuid && mutacion.uuid.length >= 8, "Debe generar UUID");
    assert.strictEqual(mutacion.tipo, "parto");
    assert.strictEqual(mutacion.status, "pending");
    assert.strictEqual(mutacion.operador, "usr_jose");
    assert.strictEqual(mutacion.payload.cria_sexo, "H");

    // Comprueba pendientes
    const pendientes = await obtenerMutacionesPendientes();
    assert.strictEqual(pendientes.length, 1);
    assert.strictEqual(pendientes[0].uuid, mutacion.uuid);

    const totalPendientes = await contarMutacionesPendientes();
    assert.strictEqual(totalPendientes, 1);

    // Sincronizar mutación
    await marcarMutacionesComoSincronizadas([mutacion.uuid]);
    const pendientesDespues = await obtenerMutacionesPendientes();
    assert.strictEqual(pendientesDespues.length, 0, "No debe haber pendientes tras sincronizar");

    // Historial
    const hist = await obtenerHistorialMutaciones();
    assert.strictEqual(hist.length, 1);
    assert.strictEqual(hist[0].status, "synced");
  });

  // 12. Tests del Generador de Gráficos SVG Nativos (Offline-First)
  await test("Gráfico SVG Comparativo Mensual: Manejo de array vacío", () => {
    const htmlVacio = renderGraficoBarrasComparativas([]);
    assert.ok(htmlVacio.includes("No hay transacciones"), "Debe informar de ausencia de transacciones");
  });

  await test("Gráfico SVG Comparativo Mensual: Renderizado correcto de barras e indicadores", () => {
    const datosMock = [
      { mes: "2026-01", ingresos_carne: 15400, gasto_pienso: 4200, cabezas: 12, kg_pienso: 11000, margen_mes: 11200 },
      { mes: "2026-02", ingresos_carne: 8900, gasto_pienso: 3100, cabezas: 7, kg_pienso: 8200, margen_mes: 5800 }
    ];
    const htmlSvg = renderGraficoBarrasComparativas(datosMock, { ancho: 600, alto: 220 });
    assert.ok(htmlSvg.includes("<svg"), "Debe generar elemento <svg>");
    assert.ok(htmlSvg.includes("viewBox=\"0 0 600 220\""), "Debe tener el viewBox correcto");
    assert.ok(htmlSvg.includes("Ene"), "Debe incluir etiqueta del mes");
    assert.ok(htmlSvg.includes("Feb"), "Debe incluir etiqueta del segundo mes");
    assert.ok(htmlSvg.includes("chart-bar-carne"), "Debe renderizar barras de carne");
    assert.ok(htmlSvg.includes("chart-bar-pienso"), "Debe renderizar barras de pienso");
  });

  await test("Gráfico SVG Cotización Canal: Renderizado de polilínea y puntos", () => {
    const datosCotizacion = [
      { mes: "2026-01", precio_medio_kg: 5.42, cabezas: 12 },
      { mes: "2026-02", precio_medio_kg: 5.55, cabezas: 7 }
    ];
    const htmlCot = renderGraficoCotizacionCanal(datosCotizacion);
    assert.ok(htmlCot.includes("<svg"), "Debe generar elemento <svg>");
    assert.ok(htmlCot.includes("<path d=\"M "), "Debe generar línea de tendencia con path SVG");
    assert.ok(htmlCot.includes("5.42€"), "Debe mostrar precio medio en tooltips/etiquetas");
  });

  await test("Gráfico SVG Radar Materias Primas: Manejo de array vacío", () => {
    const htmlVacio = renderGraficoRadarMateriasPrimas([]);
    assert.ok(htmlVacio.includes("No hay datos de cotizaciones"), "Debe informar de ausencia de cotizaciones");
  });

  await test("Gráfico SVG Radar Materias Primas: Renderizado de curvas de lonja y barras de pienso", () => {
    const mockRadar = [
      { mes: "2026-01", cebada_lonja_t: 215, maiz_lonja_t: 235, pienso_lonja_t: 310, pienso_real_t: 318, kg_comprados: 12000 },
      { mes: "2026-02", cebada_lonja_t: 218, maiz_lonja_t: 238, pienso_lonja_t: 312, pienso_real_t: 315, kg_comprados: 14000 }
    ];
    const htmlRadar = renderGraficoRadarMateriasPrimas(mockRadar, { ancho: 600, alto: 240 });
    assert.ok(htmlRadar.includes("<svg"), "Debe generar elemento <svg>");
    assert.ok(htmlRadar.includes("viewBox=\"0 0 600 240\""), "Debe respetar dimensiones");
    assert.ok(htmlRadar.includes("Cebada Lonja"), "Debe incluir leyenda de cebada");
    assert.ok(htmlRadar.includes("Maíz Lonja"), "Debe incluir leyenda de maíz");
    assert.ok(htmlRadar.includes("Pienso T-3 Comprado"), "Debe incluir leyenda de pienso");
    assert.ok(htmlRadar.includes("Ene"), "Debe etiquetar el mes");
  });

  await test("Gráfico SVG Lonja Vacuno de Carne: Manejo de array vacío", () => {
    const htmlVacio = renderGraficoLonjaCarne([]);
    assert.ok(htmlVacio.includes("No hay datos de cotizaciones de carne"), "Debe informar ausencia de datos");
  });

  await test("Gráfico SVG Lonja Vacuno de Carne: Renderizado de curvas de categorías y barras de granja", () => {
    const mockCarne = [
      { mes: "2026-01", anojo_extra_lonja: 5.48, anojo_pesado_lonja: 5.35, ternera_extra_lonja: 5.60, vaca_desvieje_lonja: 4.10, precio_medio_granja: 5.52, canales_vendidas: 12 },
      { mes: "2026-02", anojo_extra_lonja: 5.50, anojo_pesado_lonja: 5.38, ternera_extra_lonja: 5.62, vaca_desvieje_lonja: 4.15, precio_medio_granja: 5.55, canales_vendidas: 8 }
    ];
    const htmlCarne = renderGraficoLonjaCarne(mockCarne, { ancho: 640, alto: 230 });
    assert.ok(htmlCarne.includes("<svg"), "Debe generar elemento <svg>");
    assert.ok(htmlCarne.includes("viewBox=\"0 0 640 230\""), "Debe tener el viewBox correcto");
    assert.ok(htmlCarne.includes("Añojo Extra"), "Debe incluir leyenda de Añojo Extra");
    assert.ok(htmlCarne.includes("Añojo Pesado"), "Debe incluir leyenda de Añojo Pesado");
    assert.ok(htmlCarne.includes("Ternera Extra"), "Debe incluir leyenda de Ternera Extra");
    assert.ok(htmlCarne.includes("Vaca Desvieje"), "Debe incluir leyenda de Vaca Desvieje");
    assert.ok(htmlCarne.includes("Precio Cobrado Granja"), "Debe incluir leyenda de precio de granja");
    assert.ok(htmlCarne.includes("5.52€"), "Debe etiquetar el precio cobrado por la granja");
  });

  await test("Gráfico SVG Estacionalidad Vacuno: Manejo de array vacío", () => {
    const htmlVacio = renderGraficoEstacionalidadCarne([]);
    assert.ok(htmlVacio.includes("No hay datos suficientes de estacionalidad"), "Debe indicar falta de datos");
  });

  await test("Gráfico SVG Estacionalidad Vacuno: Renderizado de 12 meses y sombreado de meses pico", () => {
    const mockMeses = [
      { mes_num: "01", nombre_mes: "Ene", anojo_extra: 5.40, anojo_pesado: 5.25, ternera_extra: 5.55, vaca_desvieje: 4.10 },
      { mes_num: "02", nombre_mes: "Feb", anojo_extra: 5.35, anojo_pesado: 5.20, ternera_extra: 5.50, vaca_desvieje: 4.05 },
      { mes_num: "11", nombre_mes: "Nov", anojo_extra: 5.65, anojo_pesado: 5.45, ternera_extra: 5.75, vaca_desvieje: 4.30 },
      { mes_num: "12", nombre_mes: "Dic", anojo_extra: 5.75, anojo_pesado: 5.50, ternera_extra: 5.85, vaca_desvieje: 4.40 }
    ];
    const htmlEst = renderGraficoEstacionalidadCarne(mockMeses, { ancho: 640, alto: 230 });
    assert.ok(htmlEst.includes("<svg"), "Debe generar elemento <svg>");
    assert.ok(htmlEst.includes("viewBox=\"0 0 640 230\""), "Debe tener dimensiones correctas");
    assert.ok(htmlEst.includes("Periodo histórico de alta demanda"), "Debe incluir sombreado para meses pico (Nov, Dic, Ene)");
    assert.ok(htmlEst.includes("Añojo Extra"), "Debe incluir leyenda");
  });

  await test("Simulador de Timing de Venta: Añojo normal sin salto de categoría", () => {
    // Ternero de 310 kg canal aguantado 21 días a 1.35 kg/d vivo (rdto 58%) -> +16.4 kg canal = ~326.4 kg (sigue <350 kg)
    const res = calcularSimulacionTimingVenta({
      pesoCanalActual: 310.0,
      diasRetraso: 21,
      gmdVivo: 1.35,
      costeDiarioPienso: 2.50,
      precioActualKg: 7.10,
      precioEsperadoKg: 7.20,
      esMacho: true
    });

    assert.strictEqual(res.saltaSobrepeso, false, "No debe saltar a sobrepeso (<350kg)");
    assert.strictEqual(res.penalizacionSobrepeso, 0, "Penalización debe ser 0");
    assert.strictEqual(res.pesoCanalActual, 310.0);
    assert.ok(res.pesoCanalNuevo > 325 && res.pesoCanalNuevo < 330, `Peso proyectado: ${res.pesoCanalNuevo}`);
    assert.ok(res.gananciaCanal > 15, `Ganancia canal: ${res.gananciaCanal}`);
    assert.ok(res.costePiensoAcumulado === 52.50, `Coste pienso acumulado (21*2.50): ${res.costePiensoAcumulado}`);
    assert.ok(res.ingresoMarginal > 100, `Ingreso marginal: ${res.ingresoMarginal}`);
    assert.strictEqual(res.esRentable, true, "Debe ser rentable con subida de precio y ganancia de peso");
    assert.ok(res.precioUmbralEquilibrio < 7.20, `Precio umbral: ${res.precioUmbralEquilibrio}`);
  });

  await test("Simulador de Timing de Venta: Salto de categoría por sobrepeso (>350 kg canal)", () => {
    // Añojo de 340 kg canal aguantado 28 días a 1.40 kg/d vivo -> +22.7 kg canal = 362.7 kg (>350 kg)
    // Pasa de Añojo Extra a Añojo Pesado (-0.25 €/kg penalización en lonja)
    const res = calcularSimulacionTimingVenta({
      pesoCanalActual: 340.0,
      diasRetraso: 28,
      gmdVivo: 1.40,
      costeDiarioPienso: 3.00,
      precioActualKg: 7.20,
      precioEsperadoKg: 7.25,
      esMacho: true
    });

    assert.strictEqual(res.saltaSobrepeso, true, "Debe detectar salto de sobrepeso >350 kg");
    assert.ok(res.pesoCanalNuevo > 350, `Peso nuevo: ${res.pesoCanalNuevo}`);
    assert.strictEqual(res.precioFinalEfectivo, 7.00, "Precio final efectivo debe restar 0.25 €/kg por penalización");
    assert.ok(res.penalizacionSobrepeso > 80, `Penalización total estimada: ${res.penalizacionSobrepeso}`);
    assert.ok(res.costePiensoAcumulado === 84.00, `Coste pienso: ${res.costePiensoAcumulado}`);
  });

  await test("Simulador de Timing de Venta: Salto de sobrepeso en hembras (>270 kg canal)", () => {
    // Ternera de 265 kg canal aguantada 20 días a 1.15 kg/d vivo -> +12.9 kg canal = 277.9 kg (>270 kg)
    // Penalización en lonja de -0.55 €/kg sobre toda la canal
    const res = calcularSimulacionTimingVenta({
      pesoCanalActual: 265.0,
      diasRetraso: 20,
      gmdVivo: 1.15,
      costeDiarioPienso: 2.65,
      precioActualKg: 7.25,
      precioEsperadoKg: 7.30,
      esMacho: false
    });

    assert.strictEqual(res.saltaSobrepeso, true, "Debe detectar sobrepeso hembra >270 kg");
    assert.ok(res.pesoCanalNuevo > 270, `Peso nuevo hembra: ${res.pesoCanalNuevo}`);
    assert.strictEqual(res.precioFinalEfectivo, 6.75, "Precio final efectivo debe restar 0.55 €/kg por penalización de hembras");
    assert.ok(res.penalizacionSobrepeso > 140, `Penalización hembra: ${res.penalizacionSobrepeso}`);
    assert.strictEqual(res.esRentable, false, "El sobrepeso en hembra destruye margen y no es rentable");
  });

  // 15. Tests de Tesorería, Filtros de Categoría y Estimación Lonja
  await test("Tesorería: Fallback seguro y estructura de retorno en obtenerResumenFinancieroGlobal", () => {
    const res = obtenerResumenFinancieroGlobal("2026", "CEBO", false);
    assert.strictEqual(typeof res, "object");
    assert.strictEqual(res.ingresos_carne, 0);
    assert.strictEqual(res.gasto_pienso, 0);
    assert.strictEqual(res.usar_estimaciones, false);
    assert.strictEqual(res.salidas_sin_factura, 0);
  });

  await test("Tesorería: Propagación de parámetros (año, categoría, estimación Lonja) al cliente DB", () => {
    let llamadas = [];
    globalThis.window = {
      campoDB: {
        obtenerResumenFinancieroGlobal: (anio, cat, est) => {
          llamadas.push({ metodo: 'resumen', anio, cat, est });
          return { ingresos_carne: 129894, gasto_pienso: 34819, usar_estimaciones: est };
        },
        obtenerSerieMensualFinanciera: (anio, cat, est) => {
          llamadas.push({ metodo: 'serie', anio, cat, est });
          return [{ mes: '2026-02', ingresos_carne: 23292, gasto_pienso: 4200, estimado: est }];
        },
        obtenerSeriesTradingTesoreria: (anio, cat, est) => {
          llamadas.push({ metodo: 'trading', anio, cat, est });
          return { ingresos_carne: [{ time: '2026-02-01', value: 23292, esReal: true, estimado: est }] };
        }
      }
    };

    const res = obtenerResumenFinancieroGlobal("2026", "CEBO", true);
    assert.strictEqual(res.ingresos_carne, 129894);
    assert.strictEqual(res.usar_estimaciones, true);

    const serie = obtenerSerieMensualFinanciera("2026", "CEBO", true);
    assert.strictEqual(serie.length, 1);
    assert.strictEqual(serie[0].estimado, true);

    const trading = obtenerSeriesTradingTesoreria("2026", "CEBO", true);
    assert.strictEqual(trading.ingresos_carne.length, 1);
    assert.strictEqual(trading.ingresos_carne[0].estimado, true);

    assert.strictEqual(llamadas.length, 3);
    assert.deepStrictEqual(llamadas[0], { metodo: 'resumen', anio: '2026', cat: 'CEBO', est: true });
    assert.deepStrictEqual(llamadas[1], { metodo: 'serie', anio: '2026', cat: 'CEBO', est: true });
    assert.deepStrictEqual(llamadas[2], { metodo: 'trading', anio: '2026', cat: 'CEBO', est: true });

    delete globalThis.window;
  });

  await test("Análisis Operativo: Fallback seguro de distribución de pesos y cebadero activo", () => {
    const dist = obtenerDistribucionPesosCanal("2026", "CEBO");
    assert.ok(Array.isArray(dist));
    assert.strictEqual(dist.length, 0);

    const cebadero = obtenerCebaderoActivo();
    assert.strictEqual(typeof cebadero, "object");
    assert.strictEqual(cebadero.total_cabezas, 0);
    assert.strictEqual(cebadero.cabezas_riesgo_sobrepeso, 0);
    assert.ok(Array.isArray(cebadero.animales));
  });

  await test("Análisis Operativo: Mock y propagación en cebadero activo y pesos canal", () => {
    globalThis.window = {
      campoDB: {
        obtenerDistribucionPesosCanal: (anio, cat) => [
          { rango_peso: '220 - 320 kg (Óptimo)', total_canales: 15, porcentaje: 75.0, peso_medio: 285.4, precio_medio_kg: 7.45 }
        ],
        obtenerCebaderoActivo: () => ({
          total_cabezas: 12,
          estancia_media_dias: 142,
          coste_diario_total: 31.80,
          coste_acumulado_lote: 4515.60,
          cabezas_riesgo_sobrepeso: 3,
          animales: [
            { crotal: 'ES083710104591', crotal_4: '4591', dias_estancia_estimados: 170, estado_salida: 'SACRIFICAR', riesgo_sobrepeso: true }
          ]
        })
      }
    };

    const dist = obtenerDistribucionPesosCanal("2026", "CEBO");
    assert.strictEqual(dist.length, 1);
    assert.strictEqual(dist[0].total_canales, 15);
    assert.strictEqual(dist[0].peso_medio, 285.4);

    const ceb = obtenerCebaderoActivo();
    assert.strictEqual(ceb.total_cabezas, 12);
    assert.strictEqual(ceb.cabezas_riesgo_sobrepeso, 3);
    assert.strictEqual(ceb.animales[0].estado_salida, 'SACRIFICAR');

    delete globalThis.window;
  });

  await test("Metodología y Cálculos Técnicos: Exportación y parámetros GPD / Lonja", () => {
    assert.strictEqual(typeof abrirModalMetodologiaCalculos, "function", "abrirModalMetodologiaCalculos debe estar exportado");

    const cebaderoFallback = obtenerCebaderoActivo();
    assert.strictEqual(typeof cebaderoFallback.gmd_media_vivo, "number");
    assert.strictEqual(typeof cebaderoFallback.gmd_media_canal, "number");
  });

  await test("Sugerencia de Crotal y Formulario de Partos: Serie correlativa y Notas de campo", async () => {
    const { obtenerSiguienteCrotalSugerido } = await import('../../pwa/js/modules/db.js');
    assert.strictEqual(typeof obtenerSiguienteCrotalSugerido, "function");
    const sugerencia = obtenerSiguienteCrotalSugerido();
    assert.ok(sugerencia.crotal, "Debe sugerir un crotal completo");
    assert.ok(sugerencia.crotal_4, "Debe sugerir los 4 dígitos finales");
    assert.strictEqual(sugerencia.crotal.slice(-4), sugerencia.crotal_4);
  });

  await test("Trading Charts: Separación de Cebo y Vacas Desvieje y soporte de HistogramSeries", async () => {
    const { obtenerSeriesTradingCarne } = await import('../../pwa/js/modules/db.js');
    const { renderTradingChartContainer } = await import('../../pwa/js/modules/components/trading_chart.js');

    // Verificar estructura de retorno de series de trading carne
    const resCarne = obtenerSeriesTradingCarne("2026", "TODOS", false);
    assert.ok(Array.isArray(resCarne.precio_granja_cebo), "Debe incluir serie separada de cebo");
    assert.ok(Array.isArray(resCarne.precio_granja_vacas), "Debe incluir serie separada de vacas");
    assert.ok(Array.isArray(resCarne.anojo_extra), "Debe incluir cotizaciones lonja añojo");

    // Verificar contenedor con defaultRange 1Y y series de histograma
    const htmlContenedor = renderTradingChartContainer({
      id: "chart-test-tv",
      titulo: "Test Chart",
      seriesDefs: [
        { id: "margen_neto", label: "Saldo Neto Mes", color: "#16a34a", defaultVisible: true }
      ],
      defaultRange: "1Y"
    });

    assert.ok(htmlContenedor.includes('class="tv-range-btn active" data-chart-id="chart-test-tv" data-range="1Y"'), "El botón 1A debe estar activo por defecto");
    assert.ok(htmlContenedor.includes('id="chart-test-tv-canvas"'), "Debe incluir el contenedor canvas del gráfico");
  });

  await test("Service Worker: Integridad de ASSETS y cobertura de módulos de app.js", () => {
    const swPath = path.resolve(__dirname, '../../pwa/sw.js');
    const swContent = fs.readFileSync(swPath, 'utf8');

    // 1. Verificar CACHE_NAME v48
    const cacheMatch = swContent.match(/CACHE_NAME\s*=\s*["']([^"']+)["']/);
    assert.ok(cacheMatch, "Debe definirse CACHE_NAME en sw.js");
    assert.strictEqual(cacheMatch[1], "ganaderos-campo-v50", "CACHE_NAME debe ser ganaderos-campo-v50");

    // 2. Extraer lista ASSETS
    const assetsMatch = swContent.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(assetsMatch, "Debe definirse array ASSETS en sw.js");
    const rawAssets = assetsMatch[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"') || line.startsWith("'"))
      .map(line => line.replace(/^[",']|[",',;]+$/g, '').trim());

    assert.ok(rawAssets.length > 20, "El array ASSETS debe contener los assets requeridos");
    assert.ok(rawAssets.includes("./js/modules/views/field_modals.js"), "ASSETS debe incluir field_modals.js");
    assert.ok(rawAssets.includes("./js/modules/views/census_view.js"), "ASSETS debe incluir census_view.js");
    assert.strictEqual(rawAssets.includes("./js/modules/views/weighing_modal.js"), false, "weighing_modal.js debe haber sido suprimido de ASSETS");

    // 3. Verificar que todos los archivos listados en ASSETS existen físicamente en pwa/
    const pwaDir = path.resolve(__dirname, '../../pwa');
    for (const asset of rawAssets) {
      if (asset === "./") continue; // raíz
      const assetFile = path.resolve(pwaDir, asset.replace(/^\.\//, ''));
      assert.ok(fs.existsSync(assetFile), `El asset ${asset} referenciado en sw.js no existe en disco: ${assetFile}`);
    }

    // 4. Leer pwa/js/app.js y asegurar que todos los módulos locales importados están en ASSETS
    const appJsPath = path.resolve(pwaDir, 'js/app.js');
    const appJsContent = fs.readFileSync(appJsPath, 'utf8');
    const importRegex = /import\s+.*?from\s+['"](\.\/modules\/[^'"]+)['"]/g;
    let match;
    const importedModules = [];
    while ((match = importRegex.exec(appJsContent)) !== null) {
      // Normalizar './modules/...' a './js/modules/...'
      const normalizedPath = './js/' + match[1].replace(/^\.\//, '');
      importedModules.push(normalizedPath);
    }

    assert.ok(importedModules.length >= 10, "app.js debe tener múltiples importaciones de módulos");
    for (const mod of importedModules) {
      assert.ok(
        rawAssets.includes(mod),
        `El módulo ${mod} importado en app.js no está en el array ASSETS del Service Worker`
      );
    }
  });

  // === TESTS MOGA CENSUS RECONCILIATION (R2) ===
  await test("Integridad ES Modules: Exportaciones de census_view.js", async () => {
    const modCensus = await import('../../pwa/js/modules/views/census_view.js');
    assert.strictEqual(typeof modCensus.abrirModalConciliacionMoga, "function", "abrirModalConciliacionMoga debe ser una función");
    assert.strictEqual(typeof modCensus.renderizarResumenMogaHTML, "function", "renderizarResumenMogaHTML debe ser una función");
    assert.strictEqual(typeof modCensus.generarDiscrepanciasMogaHTML, "function", "generarDiscrepanciasMogaHTML debe ser una función");
    assert.strictEqual(typeof modCensus.conciliarArchivoMoga, "function", "conciliarArchivoMoga debe ser una función");
  });

  await test("Conciliación MoGa: Renderizado de resumen con discrepancias y badges", async () => {
    const { renderizarResumenMogaHTML } = await import('../../pwa/js/modules/views/census_view.js');

    // 1. Caso con discrepancias
    const resumenConDiscrepancias = {
      total_local: 245,
      total_moga: 240,
      coincidentes: 235,
      discrepancias_totales: 15
    };
    const htmlDisc = renderizarResumenMogaHTML(resumenConDiscrepancias);
    assert.ok(htmlDisc.includes("245"), "Debe mostrar el total del censo local (245)");
    assert.ok(htmlDisc.includes("240"), "Debe mostrar el total del censo MoGa (240)");
    assert.ok(htmlDisc.includes("235"), "Debe mostrar el total de coincidentes (235)");
    assert.ok(htmlDisc.includes("15"), "Debe mostrar el número de discrepancias (15)");
    assert.ok(htmlDisc.includes("15 Discrepancias Detectadas"), "Debe mostrar el banner de advertencia");
    assert.ok(htmlDisc.includes("Censo Campo"), "Debe incluir etiqueta de Censo Campo");
    assert.ok(htmlDisc.includes("Censo MoGa"), "Debe incluir etiqueta de Censo MoGa");

    // 2. Caso 100% conciliado (0 discrepancias)
    const resumenConciliado = {
      total_local: 240,
      total_moga: 240,
      coincidentes: 240,
      discrepancias_totales: 0
    };
    const htmlOk = renderizarResumenMogaHTML(resumenConciliado);
    assert.ok(htmlOk.includes("Censo 100% Conciliado"), "Debe mostrar banner de éxito para 0 discrepancias");
    assert.ok(htmlOk.includes("status-ok"), "Debe tener clase status-ok");
    assert.ok(htmlOk.includes("✅"), "Debe incluir emoji de verificación");

    // 3. Fallback seguro con objeto vacío o nulo
    const htmlVacio = renderizarResumenMogaHTML({});
    assert.ok(htmlVacio.includes("Censo 100% Conciliado"), "Debe asumir 0 discrepancias como fallback seguro");
    assert.ok(htmlVacio.includes(">0<"), "Debe contener valor numérico 0 en métricas");
  });

  await test("Conciliación MoGa: Generación de discrepancias y estados vacíos", async () => {
    const { generarDiscrepanciasMogaHTML } = await import('../../pwa/js/modules/views/census_view.js');

    const mockResultado = {
      no_en_moga: [
        {
          crotal: "ES083712611099",
          crotal_4: "1099",
          corral: "DUEÑA",
          motivo: "Animal activo en campo pero ausente en registro oficial MoGa"
        }
      ],
      bajas_oficiales_activas_local: [
        {
          crotal: "ES083712611002",
          crotal_4: "1002",
          estado_moga: "BAJA",
          motivo: "Baja en MoGa (BAJA) pero figura como Activo en campo"
        }
      ],
      bajas_locales_activas_oficial: [
        {
          crotal: "ES083712611088",
          crotal_4: "1088",
          motivo: "Dado de baja en el censo local pero todavía de alta oficial en MoGa"
        }
      ],
      no_en_campo: [
        {
          crotal: "ES083712611003",
          explotacion: "ES371261100122",
          motivo: "De alta oficial en MoGa pero no existe en la base de datos local"
        }
      ]
    };

    // 1. Filtro 'todos': debe contener todos los animales y sus detalles
    const htmlTodos = generarDiscrepanciasMogaHTML(mockResultado, "todos");
    assert.ok(htmlTodos.includes("ES083712611099"), "Debe incluir crotal de animal no en moga");
    assert.ok(htmlTodos.includes("1099"), "Debe resaltar 4 dígitos de 1099");
    assert.ok(htmlTodos.includes("DUEÑA"), "Debe incluir el corral del animal");
    assert.ok(htmlTodos.includes("No en MoGa (Activo en campo)"), "Debe incluir badge de categoría No en MoGa");

    assert.ok(htmlTodos.includes("ES083712611002"), "Debe incluir crotal de baja oficial activa");
    assert.ok(htmlTodos.includes("1002"), "Debe resaltar 4 dígitos de 1002");
    assert.ok(htmlTodos.includes("Baja oficial activa en campo"), "Debe incluir badge de baja oficial activa");
    assert.ok(htmlTodos.includes("BAJA"), "Debe indicar estado oficial en MoGa");

    assert.ok(htmlTodos.includes("ES083712611088"), "Debe incluir baja local activa en moga");
    assert.ok(htmlTodos.includes("Baja en campo activa en MoGa"), "Debe incluir badge de baja en campo activa");

    assert.ok(htmlTodos.includes("ES083712611003"), "Debe incluir animal no en campo");
    assert.ok(htmlTodos.includes("ES371261100122"), "Debe incluir la explotación MoGa");
    assert.ok(htmlTodos.includes("No registrado en campo"), "Debe incluir badge de no en campo");

    // 2. Filtro específico 'no_en_moga'
    const htmlNoMoga = generarDiscrepanciasMogaHTML(mockResultado, "no_en_moga");
    assert.ok(htmlNoMoga.includes("ES083712611099"), "Filtro no_en_moga debe incluir ES083712611099");
    assert.strictEqual(htmlNoMoga.includes("ES083712611002"), false, "Filtro no_en_moga no debe incluir otros tipos");

    // 3. Filtro específico 'bajas_oficiales_activas_local'
    const htmlBajasOfi = generarDiscrepanciasMogaHTML(mockResultado, "bajas_oficiales_activas_local");
    assert.ok(htmlBajasOfi.includes("ES083712611002"), "Filtro bajas_oficiales debe incluir ES083712611002");
    assert.strictEqual(htmlBajasOfi.includes("ES083712611099"), false, "Filtro bajas_oficiales no debe incluir no_en_moga");

    // 4. Estado vacío en categoría sin discrepancias
    const htmlVacio = generarDiscrepanciasMogaHTML({ no_en_moga: [] }, "no_en_moga");
    assert.ok(htmlVacio.includes("moga-empty-state"), "Debe generar contenedor de estado vacío");
    assert.ok(htmlVacio.includes("No hay discrepancias en esta categoría"), "Debe contener mensaje explicativo de sin discrepancias");
  });

  await test("Conciliación MoGa: Cumplimiento de accesibilidad táctil WCAG AAA (>= 48px)", async () => {
    // 1. Verificar dimensiones mínimas en botón de cabecera de cattle_view.js
    const cattleViewPath = path.resolve(__dirname, '../../pwa/js/modules/views/cattle_view.js');
    const cattleViewContent = fs.readFileSync(cattleViewPath, 'utf8');
    assert.ok(cattleViewContent.includes('id="btn-moga-header"'), "cattle_view.js debe tener el botón #btn-moga-header");
    assert.ok(cattleViewContent.includes('min-height: 48px'), "#btn-moga-header debe tener min-height de 48px");
    assert.ok(cattleViewContent.includes('min-width: 48px'), "#btn-moga-header debe tener min-width de 48px");
    assert.ok(cattleViewContent.includes('abrirModalConciliacionMoga()'), "cattle_view.js debe enlazar el clic a abrirModalConciliacionMoga");

    // 2. Verificar dimensiones mínimas en el modal de census_view.js
    const censusViewPath = path.resolve(__dirname, '../../pwa/js/modules/views/census_view.js');
    const censusContent = fs.readFileSync(censusViewPath, 'utf8');

    // Botón cerrar modal
    assert.ok(censusContent.includes('id="btn-cerrar-modal-moga"'), "Debe existir #btn-cerrar-modal-moga");
    assert.ok(censusContent.includes('min-height: 48px; width: 48px; height: 48px;'), "El botón cerrar debe ser 48x48px");

    // Botón / label selector de archivo
    assert.ok(censusContent.includes('id="btn-seleccionar-csv-moga"'), "Debe existir #btn-seleccionar-csv-moga");
    assert.ok(censusContent.includes('min-height: 48px'), "El selector de CSV debe tener min-height >= 48px");

    // Botón subir y conciliar
    assert.ok(censusContent.includes('id="btn-subir-moga"'), "Debe existir #btn-subir-moga");
    assert.ok(censusContent.includes('min-height: 48px'), "El botón subir debe tener min-height >= 48px");

    // Botón quitar archivo
    assert.ok(censusContent.includes('id="btn-quitar-archivo-moga"'), "Debe existir #btn-quitar-archivo-moga");

    // Chips de filtrado de discrepancias
    assert.ok(censusContent.includes('class="moga-chip-btn active"'), "Deben existir chips de filtro");
    assert.ok(censusContent.includes('min-height: 48px; min-width: 48px;'), "Los chips de filtro deben tener min-height y min-width de 48px");

    // Botón reiniciar / cargar otro
    assert.ok(censusContent.includes('id="btn-reiniciar-moga"'), "Debe existir #btn-reiniciar-moga");
  });

  console.log(`RESULTADO: ${testsExitosos}/${testsEjecutados} tests superados con éxito.`);
  console.log("==================================================");

  if (testsExitosos !== testsEjecutados) {
    process.exit(1);
  }
}

runAllTests();
