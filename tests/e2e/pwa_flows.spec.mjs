import { test, expect } from '@playwright/test';

/**
 * Suite E2E para la PWA Ganaderos Campo.
 * Valida flujos reales de usuario: arranque y manifiesto PWA, pantalla de login,
 * teclado táctil numérico de 4 dígitos, ficha genealógica, supresión sanitaria,
 * navegación entre módulos y resiliencia 100% offline.
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

  test('01. Arranque de la PWA, Manifiesto y Metadatos', async ({ page }) => {
    await expect(page).toHaveTitle(/Ganaderos/i);

    // Verificar manifiesto PWA
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', './manifest.json');

    // Comprobar que la cabecera muestra el título y el estado del censo
    const headerTitle = page.locator('.brand-text h1');
    await expect(headerTitle).toContainText('Ganaderos');

    // Verificar que se han cargado animales en la lista
    const resultsCount = page.locator('#results-count');
    await expect(resultsCount).not.toHaveText('Cargando...', { timeout: 12000 });
  });

  test('02. Teclado Numérico Táctil y Búsqueda por 4 Dígitos', async ({ page }) => {
    // Abrir el teclado numérico de campo
    const toggleKeypadBtn = page.locator('#btn-toggle-keypad');
    await toggleKeypadBtn.click();

    const keypad = page.locator('#touch-keypad');
    await expect(keypad).toHaveClass(/visible/);

    // Marcar dígitos en el teclado táctil: "1", "0"
    await page.locator('.touch-keypad .t-key[data-digit="1"]').click();
    await page.locator('.touch-keypad .t-key[data-digit="0"]').click();

    const searchInput = page.locator('#txt-busqueda');
    await expect(searchInput).toHaveValue('10');

    // Probar borrado un dígito con backspace del teclado táctil
    const backBtn = page.locator('#btn-keypad-back');
    await backBtn.click();
    await expect(searchInput).toHaveValue('1');

    // Limpiar con botón C
    const clearBtn = page.locator('#btn-keypad-clear');
    await clearBtn.click();
    await expect(searchInput).toHaveValue('');
  });

  test('03. Ficha Técnica, Genealogía y Alertas Sanitarias', async ({ page }) => {
    // Esperar a que exista al menos una tarjeta de animal
    const firstCard = page.locator('.animal-card').first();
    await expect(firstCard).toBeVisible({ timeout: 12000 });

    // Obtener crotal de la tarjeta y hacer clic
    const crotalAttr = await firstCard.getAttribute('data-crotal');
    await firstCard.click();

    // Comprobar que se muestra la ficha técnica
    const detailCard = page.locator('.detail-card');
    await expect(detailCard).toBeVisible();

    // Verificar que aparece el crotal en el encabezado de detalle
    await expect(detailCard).toContainText(crotalAttr || '');

    // Verificar contenido de ficha técnica (árbol, partos o datos de explotación)
    const detailText = await detailCard.innerText();
    expect(detailText.length).toBeGreaterThan(30);
  });

  test('04. Navegación entre Módulos: Recetas, Alimentos y Movimientos', async ({ page }) => {
    // Cambiar a pestaña Recetas (seleccionando el elemento visible para desktop o mobile)
    const recetasTab = page.locator('[data-tab="recetas"]:visible');
    await recetasTab.click();
    await page.waitForTimeout(400);

    // Cambiar a pestaña Alimentos
    const alimentosTab = page.locator('[data-tab="alimentos"]:visible');
    await alimentosTab.click();
    await page.waitForTimeout(400);

    // Cambiar a pestaña Movimientos
    const movimientosTab = page.locator('[data-tab="movimientos"]:visible');
    await movimientosTab.click();
    await page.waitForTimeout(400);

    // Regresar a pestaña Animales
    const animalesTab = page.locator('[data-tab="animales"]:visible');
    await animalesTab.click();
    await expect(page.locator('#txt-busqueda')).toBeVisible();
  });

  test('05. Resiliencia Offline y Degradación Grácil del Asistente', async ({ page, context }) => {
    // Esperar a que la PWA esté completamente cargada con datos en memoria/IndexedDB
    await expect(page.locator('.animal-card').first()).toBeVisible({ timeout: 12000 });

    // Simular corte total de red
    await context.setOffline(true);

    // Realizar una búsqueda local mientras estamos offline
    const searchInput = page.locator('#txt-busqueda');
    await searchInput.fill('ES');

    // La interfaz debe seguir respondiendo y filtrando sin colapsar
    const resultsCount = page.locator('#results-count');
    await expect(resultsCount).toBeVisible();

    // Abrir asistente en modo offline y verificar degradación grácil
    const btnOpenAi = page.locator('#btn-open-ai');
    if (await btnOpenAi.isVisible()) {
      await btnOpenAi.click();
      const statusText = page.locator('#voice-status-text');
      await expect(statusText).toContainText(/sin conexión|cobertura|conexión/i);

      // Enviar una consulta por texto mientras estamos offline
      const promptInput = page.locator('#txt-ai-prompt');
      await promptInput.fill('vaca 1045');
      await page.locator('#btn-send-ai').click();

      // Debe mostrar el banner de degradación grácil sin lanzar errores
      const gracefulBox = page.locator('.ai-offline-graceful-box');
      await expect(gracefulBox).toBeVisible({ timeout: 5000 });
      await expect(gracefulBox).toContainText(/sin cobertura|offline/i);

      // Cerrar modal
      await page.locator('#btn-close-ai').click();
    }

    // Restablecer conexión
    await context.setOffline(false);
  });

  test('08. Registro de Parto en Campo y Outbox Local', async ({ page }) => {
    // 1. Abrir modal desde el botón de la cabecera del buscador
    const btnPartoHeader = page.locator('#btn-nuevo-parto-header');
    await expect(btnPartoHeader).toBeVisible();
    await btnPartoHeader.click();

    // 2. Verificar que el modal de parto está visible en pantalla
    const modalParto = page.locator('#modal-registro-parto');
    await expect(modalParto).toBeVisible();
    await expect(modalParto).toContainText('Registrar Parto');

    // 3. Buscar una vaca madre (ej: "7252")
    const inputMadre = page.locator('#input-buscar-madre');
    await inputMadre.fill('7252');

    // Debe desplegar sugerencias
    const sugerenciaMadre = page.locator('.opcion-madre').first();
    await expect(sugerenciaMadre).toBeVisible({ timeout: 8000 });
    await sugerenciaMadre.click();

    // Comprobar que la madre quedó seleccionada
    const madreLabel = page.locator('#label-madre-4');
    await expect(madreLabel).toHaveText('7252');

    // 4. Seleccionar sexo Macho (M)
    const btnSexoM = page.locator('#btn-sexo-m');
    await btnSexoM.click();

    // Rellenar crotal cría opcional y notas
    await page.locator('#input-cria-crotal').fill('C-7252-E2E');
    await page.locator('#input-incidencias').fill('Parto de prueba E2E automatizada');

    // 5. Guardar parto
    const btnGuardar = page.locator('#btn-guardar-parto');
    await btnGuardar.click();

    // 6. El modal debe cerrarse y mostrar toast de éxito
    await expect(modalParto).toBeHidden({ timeout: 8000 });
    const toast = page.locator('#pwa-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/parto registrado/i);

    // 7. El badge de sincronización debe ser visible
    const badgeSync = page.locator('#btn-sync-badge');
    await expect(badgeSync).toBeVisible();

    // 8. Abrir ficha de la madre y verificar que el parto y la cría aparecen en el historial
    await page.locator('#txt-busqueda').fill('7252');
    const cowCard = page.locator('.animal-card[data-crotal*="7252"]').first();
    await cowCard.click();

    const detailCard = page.locator('.detail-card');
    await expect(detailCard).toBeVisible();
    await expect(detailCard).toContainText('Historial de Partos y Crías');

    // 9. Comprobar que desde la ficha de la vaca, el botón Registrar Parto abre el modal con la vaca preseleccionada
    const btnPartoFicha = page.locator('[data-action="registrar-parto"]');
    await expect(btnPartoFicha).toBeVisible();
    await btnPartoFicha.click();
    await expect(modalParto).toBeVisible();
    await expect(page.locator('#label-madre-4')).toHaveText('7252');
    // Cerrar con cancelar
    await page.locator('#btn-cancelar-parto').click();
    await expect(modalParto).toBeHidden();
  });

});

test.describe('Autenticación y Control de Acceso', () => {
  test('06. Acceso con contraseña de explotación (operador por defecto)', async ({ page }) => {
    // Abrir la app sin token pre-configurado
    await page.goto('./');

    // Debe mostrar la pantalla de acceso con el formulario de contraseña
    const authInput = page.locator('#input-auth-pass');
    await expect(authInput).toBeVisible({ timeout: 15000 });

    // Probar contraseña errónea
    await authInput.fill('clave-incorrecta');
    await page.locator('#btn-submit-auth').click();
    await expect(page.locator('#app-container')).toContainText(/incorrecta|error/i, { timeout: 8000 });

    // Contraseña correcta con el operador preseleccionado (Álvaro)
    await authInput.fill('mvp-testing');
    await page.locator('#btn-submit-auth').click();

    // Debe autenticar, desbloquear el censo y mostrar a Álvaro en la cabecera
    await expect(page.locator('#txt-busqueda')).toBeVisible({ timeout: 25000 });
    const headerUser = page.locator('#header-user-name');
    await expect(headerUser).toBeVisible({ timeout: 5000 });
    await expect(headerUser).toHaveText(/Álvaro/i);
  });

  test('07. Selección de operador sin PIN ni roles y atribución de sesión', async ({ page }) => {
    // Abrir app limpia
    await page.goto('./');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.goto('./');

    // Tarjetas de operador visibles, sin badges de rol ni teclado PIN
    const opCardJose = page.locator('.operator-card[data-user-id="usr_jose"]');
    await expect(opCardJose).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.operator-card').first()).not.toContainText(/rol:/i);
    await expect(page.locator('.pin-keypad-btn')).toHaveCount(0);

    // Elegir a Jose e introducir la contraseña compartida de la explotación
    await opCardJose.click();
    const authInput = page.locator('#input-auth-pass');
    await authInput.fill('mvp-testing');
    await page.locator('#btn-submit-auth').click();

    // Entra al censo identificado como Jose (atribución para futuro merge de BDs)
    await expect(page.locator('#txt-busqueda')).toBeVisible({ timeout: 25000 });
    const headerUser = page.locator('#header-user-name');
    await expect(headerUser).toBeVisible({ timeout: 5000 });
    await expect(headerUser).toHaveText(/Jose/i);
  });
});

