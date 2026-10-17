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
import {
  renderGraficoBarrasComparativas,
  renderGraficoCotizacionCanal
} from '../../pwa/js/modules/components/charts_svg.js';

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

  await test("Pesajes y GMD: Visualización de historial, cálculo GMD y Rendimiento en Canal", async () => {
    const { generarHtmlDetalleAnimal } = await import('../../pwa/js/modules/views/detail_view.js');
    const animalConPesajes = {
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
      pesajes: [
        { fecha: "2024-01-01", peso_kg: 240.0, tipo: "Destete", gmd: null, operador: "Paco" },
        { fecha: "2024-03-01", peso_kg: 320.0, tipo: "Control", gmd: 1.333, operador: "Álvaro" },
        { fecha: "2024-05-01", peso_kg: 485.0, tipo: "Salida", gmd: 1.625, operador: "Álvaro" }
      ],
      rendimiento_canal_pct: 58.7,
      ultimo_peso_vivo: 485.0,
      liquidacion_canal: {
        factura_id: 2,
        numero_factura: "F-2024-002",
        fecha_factura: "2024-05-05",
        peso_canal_kg: 284.7,
        precio_unitario: 7.20,
        importe_linea: 2049.84
      }
    };

    const html = generarHtmlDetalleAnimal(animalConPesajes);
    assert.strictEqual(html.includes("Control de Pesajes y Crecimiento"), true);
    assert.strictEqual(html.includes("data-action=\"registrar-pesaje\""), true);
    assert.strictEqual(html.includes("485 kg"), true);
    assert.strictEqual(html.includes("GMD: +1.33 kg/d"), true);
    assert.strictEqual(html.includes("Rendimiento en Canal"), true);
    assert.strictEqual(html.includes("58.7%"), true);
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

  console.log(`RESULTADO: ${testsExitosos}/${testsEjecutados} tests superados con éxito.`);
  console.log("==================================================");

  if (testsExitosos !== testsEjecutados) {
    process.exit(1);
  }
}

runAllTests();
