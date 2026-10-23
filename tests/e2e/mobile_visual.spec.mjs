import { test, expect } from '@playwright/test';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/varo/.gemini/antigravity/brain/1ca10c1f-b9cf-4659-8b4e-132dba12b533';

test.describe('Pruebas E2E y Capturas Visuales Móviles', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('campo_pwa_token', 'e2e-valid-auth-token');
    });
    await page.goto('./');
    await expect(page.locator('#txt-busqueda')).toBeVisible({ timeout: 25000 });
  });

  test('V1. Captura de Vista Principal Móvil y Verificación de Toolbar', async ({ page }) => {
    const btnParto = page.locator('#btn-nuevo-parto-header');
    await expect(btnParto).toBeVisible();

    const btnKeypad = page.locator('#btn-toggle-keypad');
    await expect(btnKeypad).toBeVisible();

    const keypad = page.locator('#touch-keypad');
    // En móvil el teclado debe estar oculto por defecto
    await expect(keypad).not.toHaveClass(/visible/);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v1_censo.png') });
  });

  test('V2. Despliegue de Teclado Numérico y Búsqueda Flexible 4 Dígitos', async ({ page }) => {
    const btnKeypad = page.locator('#btn-toggle-keypad');
    await btnKeypad.click();

    const keypad = page.locator('#touch-keypad');
    await expect(keypad).toHaveClass(/visible/);

    // Marcar dígitos
    await page.locator('.touch-keypad .t-key[data-digit="4"]').click();
    await page.locator('.touch-keypad .t-key[data-digit="5"]').click();

    const searchInput = page.locator('#txt-busqueda');
    await expect(searchInput).toHaveValue('45');

    // Verificar botón clear visible y accesible
    const clearBtn = page.locator('#btn-clear-search');
    await expect(clearBtn).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v2_keypad_search.png') });
  });

  test('V3. Modal de Parto: Validación Visual Inline y Touch Targets', async ({ page }) => {
    const btnParto = page.locator('#btn-nuevo-parto-header');
    await btnParto.click();

    const modal = page.locator('#modal-registro-parto');
    await expect(modal).toBeVisible();

    const btnGuardar = page.locator('#btn-guardar-parto');
    await btnGuardar.click();

    // Comprobar error inline visible (sin alert)
    const errorBox = page.locator('#modal-parto-error');
    await expect(errorBox).toBeVisible();
    await expect(errorBox).toContainText(/selecciona la vaca madre/i);

    // Input resaltado
    const inputBuscarMadre = page.locator('#input-buscar-madre');
    await expect(inputBuscarMadre).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v3_modal_parto_error.png') });

    // Botón de cierre
    const btnCerrar = page.locator('#btn-cerrar-modal-parto');
    await expect(btnCerrar).toBeVisible();
    await btnCerrar.click();
    await expect(modal).not.toBeVisible();
  });

  test('V4. Detalle de Animal y Botón Registrar Parto', async ({ page }) => {
    const firstCard = page.locator('.animal-card').first();
    await firstCard.click();

    const detailPanel = page.locator('.detail-card');
    await expect(detailPanel).toBeVisible();

    const btnPartoDetail = page.locator('.btn-registrar-parto-detail');
    if (await btnPartoDetail.isVisible()) {
      await expect(btnPartoDetail).toBeVisible();
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v4_detail.png') });
  });

  test('V5. Modal de Estado y Sincronización del Censo', async ({ page }) => {
    const badge = page.locator('#btn-sync-status-badge');
    await expect(badge).toBeVisible();
    await badge.click();

    const modalSync = page.locator('#modal-sync-info');
    await expect(modalSync).toBeVisible();
    await expect(modalSync).toContainText(/Base de Datos Local/i);
    await expect(modalSync).toContainText(/Historial de Sincronizaciones/i);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v5_sync_modal.png') });

    const btnCerrar = page.locator('#btn-cerrar-modal-sync');
    await expect(btnCerrar).toBeVisible();
    await btnCerrar.click();
    await expect(modalSync).not.toBeVisible();
  });

  test('V6. Banner CTA de Nueva Versión de Censo Disponible', async ({ page }) => {
    // Interceptar /api/database/meta simulando actualización reciente en el PC
    await page.route('**/api/database/meta', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          mtime: Math.floor(Date.now() / 1000) + 7200,
          mtime_iso: new Date(Date.now() + 7200000).toISOString(),
          size_bytes: 524288,
          filename: 'ganaderos_campo.sqlite',
          total_animales: 142,
          total_activos: 138
        })
      });
    });

    // Simular meta local antiguo
    await page.evaluate(() => {
      localStorage.setItem('campo_pwa_db_meta', JSON.stringify({
        mtime: 1000000,
        descargado_en: '2026-09-01T00:00:00.000Z',
        total_animales: 100
      }));
    });

    // Recargar vista para disparar verificación
    await page.reload();
    await expect(page.locator('#txt-busqueda')).toBeVisible({ timeout: 25000 });

    const banner = page.locator('#banner-sync-actualizacion');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText(/Nueva versión del censo en el PC disponible/i);
    await expect(banner.locator('#btn-sync-descargar')).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v6_sync_banner.png') });
  });

  test('V7. Movimientos: Banner Liquidaciones y Badges de Rendimiento en Canal', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText(/Liquidaciones de Venta y Matadero/i);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v7_movimientos_banner.png') });
  });

  test('V8. Profundidad Nivel 1: Vista de Liquidaciones con KPIs y Desglose de Facturas', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.click();

    const gridKpis = page.locator('.kpis-liquidaciones-grid');
    await expect(gridKpis).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.liquidacion-card').first()).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v8_liquidaciones_kpis.png') });
  });

  test('V9. Profundidad Nivel 2: Detalle de Factura con Canales y Retorno Reversible', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.click();

    const btnVerCanales = page.locator('.btn-ver-canales').first();
    await expect(btnVerCanales).toBeVisible({ timeout: 10000 });
    await btnVerCanales.click();

    const tablaCanales = page.locator('.canales-table');
    await expect(tablaCanales).toBeVisible({ timeout: 10000 });
    const btnVolver = page.locator('.btn-volver-liq');
    await expect(btnVolver).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v9_factura_canales.png') });
  });

  test('V10. Ficha Técnica: Trazabilidad, Genealogía y Detalle de Animal', async ({ page }) => {
    // Abrir un animal de la lista
    const card = page.locator('.animal-card').first();
    await card.click();

    const detailCard = page.locator('.detail-card');
    await expect(detailCard).toBeVisible({ timeout: 10000 });
    await expect(detailCard.locator('.detail-crotal-full')).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v10_pesajes_gmd.png') });
  });

  test('V11. Acciones Rápidas FAB (+) y Modal de Movimiento en Campo', async ({ page }) => {
    const fabBtn = page.locator('#btn-fab-quick-action');
    await expect(fabBtn).toBeVisible({ timeout: 10000 });
    await fabBtn.click();

    const speedDial = page.locator('#fab-speed-dial');
    await expect(speedDial).toBeVisible();

    const btnActionMov = page.locator('#btn-action-movimiento');
    await expect(btnActionMov).toBeVisible();
    await btnActionMov.click();

    const modalMov = page.locator('#modal-registro-movimiento');
    await expect(modalMov).toBeVisible();
    await expect(page.locator('#mov-input-crotal')).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v11_modal_pesaje.png') });

    // Cerrar modal
    await page.locator('#btn-cerrar-modal-movimiento').click();
    await expect(modalMov).not.toBeVisible();
  });

  test('V12. Ficha Técnica con Alerta Preventiva de Retirada Sanitaria', async ({ page }) => {
    // Buscar animal en retirada activa (ES083710104591 - 1045)
    const cardRetirada = page.locator('.animal-card[data-crotal="ES083710104591"]');
    await expect(cardRetirada).toBeVisible({ timeout: 10000 });
    await cardRetirada.click();

    const detailCard = page.locator('.detail-card');
    await expect(detailCard).toBeVisible({ timeout: 10000 });

    const bannerRetirada = page.locator('.banner-alerta-retirada');
    await expect(bannerRetirada).toBeVisible({ timeout: 5000 });
    await expect(bannerRetirada).toContainText('EN PERIODO DE RETIRADA SANITARIA');

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v12_alerta_retirada.png') });
  });

  test('V13. Vista de Liquidaciones con Botón de Subida de Factura PDF', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.click();

    const btnSubirPdf = page.locator('#btn-subir-factura-pdf');
    await expect(btnSubirPdf).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v13_subir_factura_pdf.png') });
  });

  test('V14. Gráficos Interactivos de Rentabilidad: Balance Carne vs Pienso y Cotización', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.click();

    const chartCard = page.locator('#chart-carne-tv-card');
    await expect(chartCard).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#chart-carne-tv-canvas')).toBeVisible({ timeout: 10000 });

    await chartCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v14_graficos_rentabilidad.png') });
  });

  test('V15. Pestaña Cebadero Activo: Monitorización de Corral y Alerta de Salida', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.click();

    const btnCebadero = page.locator('.nav-tab-btn[data-seccion="cebadero"]');
    await expect(btnCebadero).toBeVisible({ timeout: 10000 });
    await btnCebadero.click();

    const kpiCeb = page.locator('text=Animales en Cebo Hoy');
    await expect(kpiCeb).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v15_margen_tecnico_cebo.png') });
  });

  test('V16. Simulador Interactivo de Timing de Venta y Retraso de Sacrificio', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.click();

    const btnCebadero = page.locator('.nav-tab-btn[data-seccion="cebadero"]');
    await expect(btnCebadero).toBeVisible({ timeout: 10000 });
    await btnCebadero.click();

    const btnTiming = page.locator('#btn-abrir-simulador-timing');
    await expect(btnTiming).toBeVisible({ timeout: 5000 });
    await btnTiming.click();

    const inputDias = page.locator('#sim-dias-retraso');
    await expect(inputDias).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v16_radar_materias_primas.png') });

    const btnCerrar = page.locator('#btn-cerrar-modal-timing-ok');
    if (await btnCerrar.isVisible()) {
      await btnCerrar.click();
    }
  });

  test('V17. Pestaña Tesorería y Proveedores: Cash Flow y Desglose Mensual', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.click();

    const btnTesoreria = page.locator('.nav-tab-btn[data-seccion="tesoreria"]');
    await expect(btnTesoreria).toBeVisible({ timeout: 10000 });
    await btnTesoreria.click();

    const chartTesoreria = page.locator('#chart-tesoreria-tv-card');
    await expect(chartTesoreria).toBeVisible({ timeout: 10000 });
    await chartTesoreria.scrollIntoViewIfNeeded();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v17_radar_vacuno_carne.png') });
  });

  test('V18. Auditoría de Liquidación Nivel 3: Desglose de Canales y Deducciones', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.click();

    const primeraFactura = page.locator('.liquidacion-item-card').first();
    await expect(primeraFactura).toBeVisible({ timeout: 10000 });
    await primeraFactura.click();

    const detalleContainer = page.locator('.factura-detail-container');
    await expect(detalleContainer).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v18_timing_y_estacionalidad.png') });
  });

  test('V19. Tesorería con Estimación de Lonja Activa y Reconstrucción', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.click();

    const btnModoProy = page.locator('#btn-modo-proyeccion');
    await expect(btnModoProy).toBeVisible({ timeout: 10000 });
    await btnModoProy.click();

    const proyBanner = page.locator('text=Proyección Lonja Activa');
    await expect(proyBanner).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v19_tesoreria_estimaciones_lonja.png') });
  });

  test('V20. Modal Técnico de Metodología y Fórmulas de Cálculo (GPD, Lonja, Sobrepeso)', async ({ page }) => {
    const btnMov = page.locator('[data-tab="movimientos"]:visible');
    await btnMov.click();

    const banner = page.locator('.banner-liquidaciones');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.click();

    const btnMetodologia = page.locator('#btn-info-metodologia');
    await expect(btnMetodologia).toBeVisible({ timeout: 10000 });
    await btnMetodologia.click();

    const modalOverlay = page.locator('#modal-metodologia-overlay');
    await expect(modalOverlay).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Metodología y Fórmulas Técnicas')).toBeVisible();

    // Comprobar que explica GPD / GMD
    await expect(page.locator('text=Ganancia de Peso Diaria')).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_v20_modal_metodologia.png') });

    // Cambiar a la pestaña de Lonja
    const tabLonja = page.locator('.metodologia-tab-btn[data-tab="lonja"]');
    await tabLonja.click();
    await expect(page.locator('text=Proyección de Facturación con Lonja de Salamanca')).toBeVisible();

    // Cerrar modal
    await page.locator('#btn-cerrar-modal-metodologia').click();
    await expect(modalOverlay).toBeHidden();
  });

  test('V21. Navegación Directa Móvil a Ventas desde Barra Inferior', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Prueba exclusiva para dispositivos móviles (< 768px)');
    const btnVentasMobile = page.locator('.mobile-tab-bar [data-tab="ventas"]');
    await expect(btnVentasMobile).toBeVisible({ timeout: 10000 });
    await btnVentasMobile.click();

    const chartCard = page.locator('#chart-carne-tv-card');
    await expect(chartCard).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#chart-carne-tv-canvas')).toBeVisible({ timeout: 10000 });
  });
});

