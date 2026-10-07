import { test, expect } from '@playwright/test';

/**
 * Suite E2E Exhaustiva para la PWA Ganaderos Campo.
 * Valida flujos de usuario reales de grado de producción:
 * 01. Arranque PWA, Manifiesto, Metadatos y Precarga de Base de Datos.
 * 02. Teclado Numérico Táctil de Campo, Búsqueda por 4 Dígitos y Manejo de Vacíos.
 * 03. Ficha Técnica, Genealogía Descendente y Navegación de Lote / Pasto.
 * 04. Módulo Sanitario: Recetas Veterinarias, Medicamentos y Tiempos de Retirada en Carne.
 * 05. Módulo de Alimentación: Piensos, Toneladas, Albaranes y Costes.
 * 06. Módulo de Movimientos y Trazabilidad REGA con Navegación Cruzada a Ficha.
 * 07. Resiliencia 100% Offline y Degradación Grácil del Asistente en Campo.
 * 08. Ciclo Completo de Parto en Campo y Sincronización Outbox con Servidor Hub.
 * 09. Autenticación, Control de Acceso y Persistencia de Sesión Tras Recarga.
 */

test.describe('Flujos de Campo PWA Ganaderos', () => {

  test.beforeEach(async ({ page }) => {
    // Pre-configurar token válido en localStorage para sesión autenticada
    await page.addInitScript(() => {
      window.localStorage.setItem('campo_pwa_token', 'e2e-valid-auth-token');
    });

    await page.goto('./');
    await expect(page.locator('#txt-busqueda')).toBeVisible({ timeout: 25000 });
  });

  test('01. Arranque de la PWA, Manifiesto, Metadatos y Precarga de Base de Datos', async ({ page }) => {
    await expect(page).toHaveTitle(/Ganaderos/i);

    // 1. Verificar manifiesto PWA para instalación offline
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', './manifest.json');

    // 2. Verificar cabecera principal y branding
    const headerTitle = page.locator('.brand-text h1');
    await expect(headerTitle).toContainText('Ganaderos');

    // 3. Verificar metadato de fecha del censo cargado desde la BD SQLite demo
    const metaFecha = page.locator('#meta-fecha');
    await expect(metaFecha).toBeVisible();
    await expect(metaFecha).toContainText(/censo:/i);

    // 4. Verificar que se han cargado animales en la lista (mínimo 100 en la BD de demostración)
    const resultsCount = page.locator('#results-count');
    await expect(resultsCount).not.toHaveText('Cargando...', { timeout: 15000 });
    await expect(resultsCount).toContainText(/de \d+|encontrados|mostrando/i);

    // 5. Verificar que la primera tarjeta de animal contiene crotal oficial y estado activo
    const firstCard = page.locator('.animal-card').first();
    await expect(firstCard).toBeVisible();
    const digits4 = firstCard.locator('.crotal-4-digits');
    await expect(digits4).toHaveText(/^\d{4}$/);
    const statusPill = firstCard.locator('.status-pill');
    await expect(statusPill).toContainText(/activo/i);
  });

  test('02. Teclado Numérico Táctil de Campo, Búsqueda por 4 Dígitos y Manejo de Vacíos', async ({ page }) => {
    // 1. Abrir el teclado numérico de campo
    const toggleKeypadBtn = page.locator('#btn-toggle-keypad');
    await toggleKeypadBtn.click();

    const keypad = page.locator('#touch-keypad');
    await expect(keypad).toHaveClass(/visible/);

    // 2. Marcar dígitos en el teclado táctil: "1", "0"
    await page.locator('.touch-keypad .t-key[data-digit="1"]').click();
    await page.locator('.touch-keypad .t-key[data-digit="0"]').click();

    const searchInput = page.locator('#txt-busqueda');
    await expect(searchInput).toHaveValue('10');

    // 3. Probar borrado un dígito con backspace del teclado táctil
    const backBtn = page.locator('#btn-keypad-back');
    await backBtn.click();
    await expect(searchInput).toHaveValue('1');

    // 4. Limpiar con botón C
    const clearBtn = page.locator('#btn-keypad-clear');
    await clearBtn.click();
    await expect(searchInput).toHaveValue('');

    // 5. Buscar crotal inexistente "9999" y verificar estado vacío sin colapso
    await searchInput.fill('9999');
    const emptyNotice = page.locator('#app-container');
    await expect(emptyNotice).toContainText(/no se encontraron animales/i);
    await expect(page.locator('.animal-card')).toHaveCount(0);

    // 6. Limpiar búsqueda con el botón de limpieza integrado
    const btnClearSearch = page.locator('#btn-clear-search');
    await expect(btnClearSearch).toBeVisible();
    await btnClearSearch.click();
    await expect(searchInput).toHaveValue('');
    await expect(page.locator('.animal-card').first()).toBeVisible();
  });

  test('03. Ficha Técnica, Genealogía Descendente y Navegación de Lote / Pasto', async ({ page }) => {
    // 1. Buscar una vaca concreta con partos registrados (8517 -> ES083710851728)
    const searchInput = page.locator('#txt-busqueda');
    await searchInput.fill('8517');

    const cowCard = page.locator('.animal-card[data-crotal*="8517"]').first();
    await expect(cowCard).toBeVisible({ timeout: 10000 });
    await cowCard.click();

    // 2. Comprobar que se muestra la ficha técnica completa
    const detailCard = page.locator('.detail-card');
    await expect(detailCard).toBeVisible();

    // Validar cabecera de la ficha: 4 dígitos grandes, crotal oficial completo y pill de estado
    await expect(detailCard.locator('.detail-crotal-big')).toHaveText('8517');
    await expect(detailCard.locator('.detail-crotal-full')).toContainText('ES083710851728');
    await expect(detailCard.locator('.status-pill')).toContainText(/activo/i);

    // 3. Verificar historial de partos y descendencia (crías)
    await expect(detailCard).toContainText(/historial de partos/i);
    const chipCria = detailCard.locator('.chip-cria').first();
    await expect(chipCria).toBeVisible();
    await expect(chipCria).toContainText(/ver ficha cría/i);

    // 4. Navegar al censo del lote / pasto actual haciendo clic en el chip de lote
    const chipCorral = detailCard.locator('.chip-corral');
    await expect(chipCorral).toBeVisible();
    const nombreLote = await chipCorral.locator('span').first().innerText();
    expect(nombreLote.length).toBeGreaterThan(0);
    await chipCorral.click();

    // Comprobar que nos muestra la vista de animales del lote
    const corralTitle = page.locator('.corral-title');
    await expect(corralTitle).toBeVisible();
    await expect(corralTitle).toHaveText(nombreLote);
    await expect(page.locator('.corral-badge-count')).toContainText(/vacas activas/i);

    // 5. Probar botón Volver (pila de navegación) para regresar a la ficha de la vaca
    const btnVolver = page.locator('[data-action="back"]');
    await expect(btnVolver).toBeVisible();
    await btnVolver.click();

    // Comprobar que hemos regresado a la ficha de la vaca 8517
    await expect(page.locator('.detail-crotal-big')).toHaveText('8517');

    // 6. Volver una vez más para regresar al buscador de censo
    await page.locator('[data-action="back"]').click();
    await expect(searchInput).toBeVisible();
  });

  test('04. Módulo Sanitario: Recetas Veterinarias, Medicamentos y Tiempos de Retirada en Carne', async ({ page }) => {
    // 1. Acceder a la pestaña Recetas
    const recetasTab = page.locator('[data-tab="recetas"]:visible');
    await recetasTab.click();

    // 2. Verificar que el contador muestra el censo completo de prescripciones
    const recetasCount = page.locator('#recetas-count');
    await expect(recetasCount).toBeVisible();
    await expect(recetasCount).toContainText(/recetas/i);

    // 3. Verificar que se renderizan tarjetas de recetas
    const primeraReceta = page.locator('.receta-card').first();
    await expect(primeraReceta).toBeVisible({ timeout: 10000 });

    // 4. Buscar un medicamento con periodo de supresión oficial (DRAXXIN -> 49 días)
    const inputRecetas = page.locator('#txt-busqueda-recetas');
    await inputRecetas.fill('DRAXXIN');

    const draxxinCard = page.locator('.receta-card').first();
    await expect(draxxinCard).toBeVisible();
    await expect(draxxinCard.locator('.receta-medicamento')).toContainText('DRAXXIN');

    // Verificar el badge reglamentario de días de espera en carne
    const badgeEspera = draxxinCard.locator('.badge-supresion-discreto');
    await expect(badgeEspera).toBeVisible();
    await expect(badgeEspera).toContainText(/espera carne:\s*49\s*d/i);

    // 5. Limpiar filtro y certificar restauración de listado
    const btnClearRecetas = page.locator('#btn-clear-recetas');
    await btnClearRecetas.click();
    await expect(recetasCount).toContainText(/recetas/i);
  });

  test('05. Módulo de Alimentación: Piensos, Toneladas, Albaranes y Costes', async ({ page }) => {
    // 1. Acceder a la pestaña Alimentos
    const alimentosTab = page.locator('[data-tab="alimentos"]:visible');
    await alimentosTab.click();

    // 2. Comprobar que carga el historial de compras y materias primas
    const countAlimentos = page.locator('#alimentos-count');
    await expect(countAlimentos).toBeVisible();
    await expect(countAlimentos).not.toHaveText('Cargando...', { timeout: 10000 });

    const primerAlimento = page.locator('.compra-card').first();
    await expect(primerAlimento).toBeVisible();

    // 3. Filtrar por pienso concentrado de cebo / iniciación (T-1)
    const inputAlimentos = page.locator('#txt-busqueda-alimentos');
    await inputAlimentos.fill('T-1');

    const cardFiltrada = page.locator('.compra-card').first();
    await expect(cardFiltrada).toBeVisible();
    await expect(cardFiltrada.locator('.compra-alimento-nombre')).toContainText('T-1');

    // Verificar desglose de kilos y albarán
    await expect(cardFiltrada.locator('.compra-specs-grid')).toContainText(/kg/i);
    await expect(cardFiltrada.locator('.compra-footer')).toContainText(/proveedor/i);

    // 4. Limpiar búsqueda
    const btnClear = page.locator('#btn-clear-alimentos');
    await btnClear.click();
    await expect(inputAlimentos).toHaveValue('');
  });

  test('06. Módulo de Movimientos y Trazabilidad REGA con Navegación Cruzada a Ficha', async ({ page }) => {
    // 1. Acceder a pestaña Movimientos
    const movimientosTab = page.locator('[data-tab="movimientos"]:visible');
    await movimientosTab.click();

    // 2. Verificar que carga el contador de movimientos del censo
    const movsCount = page.locator('#movimientos-count');
    await expect(movsCount).toBeVisible();
    await expect(movsCount).not.toHaveText('Cargando...', { timeout: 10000 });

    // 3. Probar filtro rápido por chips: "Traspasos a Cebadero"
    const chipCebadero = page.locator('.chip-filtro-mov[data-tipo="TRASPASO_CEBADERO"]');
    await chipCebadero.click();
    await expect(chipCebadero).toHaveClass(/active/);

    const movCard = page.locator('.movimiento-card').first();
    await expect(movCard).toBeVisible({ timeout: 8000 });
    await expect(movCard.locator('.badge-tipo-mov')).toContainText(/cebadero|traspaso/i);

    // 4. Salto directo a la ficha del animal haciendo clic en el botón 'Ver ficha' de un animal activo
    const movCardActivo = page.locator('.movimiento-card:has(.btn-ver-ficha-animal)').first();
    await expect(movCardActivo).toBeVisible();

    const crotalSpan = movCardActivo.locator('.mov-crotal-completo');
    const crotalText = (await crotalSpan.innerText()).trim();
    expect(crotalText.length).toBe(14);

    const btnVerFicha = movCardActivo.locator('.btn-ver-ficha-animal');
    await btnVerFicha.click();

    // Comprobar que navegamos directamente a la ficha del animal
    const detailCard = page.locator('.detail-card');
    await expect(detailCard).toBeVisible({ timeout: 10000 });
    await expect(detailCard.locator('.detail-crotal-full')).toContainText(crotalText);
  });

  test('07. Resiliencia 100% Offline y Degradación Grácil del Asistente en Campo', async ({ page, context }) => {
    // 1. Esperar a que la base de datos relacional esté precargada en el navegador
    await expect(page.locator('.animal-card').first()).toBeVisible({ timeout: 15000 });

    // 2. Simular desconexión total de red (dehesa sin cobertura)
    await context.setOffline(true);

    // 3. Realizar búsqueda en local: debe responder de forma instantánea gracias a SQLite WASM
    const searchInput = page.locator('#txt-busqueda');
    await searchInput.fill('10');
    await expect(page.locator('.animal-card').first()).toBeVisible();
    const resultsCount = page.locator('#results-count');
    await expect(resultsCount).toBeVisible();

    // 4. Abrir asistente en modo offline y verificar degradación grácil
    const btnOpenAi = page.locator('#btn-open-ai');
    if (await btnOpenAi.isVisible()) {
      await btnOpenAi.click();
      const statusText = page.locator('#voice-status-text');
      await expect(statusText).toContainText(/sin conexión|cobertura|conexión/i);

      // Enviar una consulta por texto mientras estamos offline
      const promptInput = page.locator('#txt-ai-prompt');
      await promptInput.fill('vaca 1045');
      await page.locator('#btn-send-ai').click();

      // Debe mostrar el banner de degradación grácil sin lanzar errores no controlados
      const gracefulBox = page.locator('.ai-offline-graceful-box');
      await expect(gracefulBox).toBeVisible({ timeout: 5000 });
      await expect(gracefulBox).toContainText(/sin cobertura|offline/i);

      // Cerrar modal
      await page.locator('#btn-close-ai').click();
    }

    // 5. Restablecer conexión
    await context.setOffline(false);
  });

  test('08. Ciclo Completo de Parto en Campo y Sincronización Outbox con Servidor Hub', async ({ page, context }) => {
    // 1. Simular registro de parto en campo sin cobertura
    await context.setOffline(true);

    // 2. Abrir modal desde el botón principal de la barra de acciones
    const btnPartoHeader = page.locator('#btn-nuevo-parto-header');
    await expect(btnPartoHeader).toBeVisible();
    await btnPartoHeader.click();

    // 3. Verificar apertura y diseño del modal de registro de parto
    const modalParto = page.locator('#modal-registro-parto');
    await expect(modalParto).toBeVisible();
    await expect(modalParto).toContainText('Registrar Parto');

    // 4. Buscar y seleccionar una vaca madre activa (7252)
    const inputMadre = page.locator('#input-buscar-madre');
    await inputMadre.fill('7252');

    const sugerenciaMadre = page.locator('.opcion-madre').first();
    await expect(sugerenciaMadre).toBeVisible({ timeout: 8000 });
    await sugerenciaMadre.click();

    // Certificar asignación de la madre en el formulario
    const madreLabel = page.locator('#label-madre-4');
    await expect(madreLabel).toHaveText('7252');

    // 5. Seleccionar sexo Macho (M) y rellenar identificación opcional
    await page.locator('#btn-sexo-m').click();
    await page.locator('#input-cria-crotal').fill('C-7252-E2E');
    await page.locator('#input-incidencias').fill('Parto normal en pasto con outbox e2e');

    // 6. Guardar parto: persistencia local inmediata en SQLite WASM e IndexedDB Outbox
    const btnGuardar = page.locator('#btn-guardar-parto');
    await btnGuardar.click();

    // 7. El modal debe cerrarse y mostrar toast informativo
    await expect(modalParto).toBeHidden({ timeout: 8000 });
    const toast = page.locator('#pwa-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/parto registrado/i);

    // 8. El badge de sincronización debe señalar mutaciones locales pendientes mientras no hay cobertura
    const badgeSync = page.locator('#btn-sync-badge');
    await expect(badgeSync).toBeVisible();
    await expect(badgeSync).toHaveClass(/pending/);
    await expect(badgeSync).toContainText(/pend\./i);

    // 9. Abrir el modal de Outbox haciendo clic en el badge de sincronización
    await badgeSync.click();
    const modalOutbox = page.locator('#modal-outbox');
    await expect(modalOutbox).toBeVisible();
    await expect(modalOutbox).toContainText(/Parto \/ Nacimiento/i);
    await expect(modalOutbox).toContainText(/Pendiente/i);

    // 10. Reanudar cobertura y ejecutar sincronización manual con el hub (POST /api/sync/push)
    await context.setOffline(false);
    const btnSyncNow = page.locator('#btn-sincronizar-outbox-ahora');
    await expect(btnSyncNow).toBeVisible();
    await btnSyncNow.click();

    // 11. Verificar confirmación de éxito y actualización del estado de sincronización
    const feedback = page.locator('#outbox-sync-feedback');
    await expect(feedback).toBeVisible({ timeout: 10000 });
    await expect(feedback).toContainText(/sincronizaci[oó]n|éxito/i);

    // Cerrar el modal de Outbox
    await page.locator('#btn-cerrar-modal-outbox').click();
    await expect(modalOutbox).toBeHidden();

    // 12. El badge debe transicionar a estado sincronizado
    await expect(badgeSync).toHaveClass(/synced/);
    await expect(badgeSync).toContainText(/al día/i);
  });

});

test.describe('Autenticación y Control de Acceso', () => {

  test('09. Autenticación, Control de Acceso y Persistencia de Sesión Tras Recarga', async ({ page }) => {
    // 1. Abrir la app limpia sin credenciales
    await page.goto('./');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.goto('./');

    // 2. Formulario de acceso visible
    const authInput = page.locator('#input-auth-pass');
    await expect(authInput).toBeVisible({ timeout: 15000 });

    // 3. Probar contraseña errónea y verificar feedback
    await authInput.fill('clave-invalida-rechazada');
    await page.locator('#btn-submit-auth').click();
    await expect(page.locator('#app-container')).toContainText(/incorrecta|error/i, { timeout: 8000 });

    // 4. Seleccionar operador Jose (usr_jose)
    const opCardJose = page.locator('.operator-card[data-user-id="usr_jose"]');
    await expect(opCardJose).toBeVisible();
    await opCardJose.click();

    // 5. Introducir la clave de la explotación y autenticar
    await authInput.fill('mvp-testing');
    await page.locator('#btn-submit-auth').click();

    // 6. Censo desbloqueado y cabecera mostrando a Jose
    await expect(page.locator('#txt-busqueda')).toBeVisible({ timeout: 25000 });
    const headerUser = page.locator('#header-user-name');
    await expect(headerUser).toBeVisible({ timeout: 5000 });
    await expect(headerUser).toHaveText(/Jose/i);

    // 7. Recargar la página: la sesión debe persistir sin volver a pedir contraseña
    await page.reload();
    await expect(page.locator('#txt-busqueda')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('#header-user-name')).toHaveText(/Jose/i);
  });

});
