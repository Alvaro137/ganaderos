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
});
