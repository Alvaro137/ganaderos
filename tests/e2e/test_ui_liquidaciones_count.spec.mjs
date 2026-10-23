import { test, expect } from '@playwright/test';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/varo/.gemini/antigravity/brain/1ca10c1f-b9cf-4659-8b4e-132dba12b533';

test.describe('Verificación Visual de Conteo de Facturas en UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('campo_pwa_token', 'e2e-valid-auth-token');
    });
    await page.goto('./');
    await expect(page.locator('#txt-busqueda')).toBeVisible({ timeout: 25000 });
  });

  test('Comprobar conteo de facturas 2026 y total en UI', async ({ page }) => {
    // 1. Ir a sección de ventas / finanzas (compatible con Desktop y Mobile)
    const btnVentas = page.locator('[data-tab="ventas"]:visible, [data-tab="finanzas"]:visible').first();
    await btnVentas.click();

    // 2. Esperar a que cargue la vista de ventas
    const heading = page.locator('h4:has-text("Facturas de Liquidación Auditadas")');
    await expect(heading).toBeVisible({ timeout: 15000 });

    const txt2026 = await heading.textContent();
    console.log('--- ENCABEZADO 2026:', txt2026);

    const facturas = page.locator('.liquidacion-item-card');
    const count2026 = await facturas.count();
    console.log('--- FACTURAS 2026 VISIBLES:', count2026);

    const isMobile = page.viewportSize().width < 600;
    const screenshotSuffix = isMobile ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(ARTIFACT_DIR, `ui_facturas_2026_${screenshotSuffix}.png`), fullPage: true });

    // 3. Cambiar selector de campaña a "TODOS" (Histórico Completo)
    const selectAnio = page.locator('#select-anio-financiero');
    await expect(selectAnio).toBeVisible();
    await selectAnio.selectOption('TODOS');

    await expect(heading).toBeVisible();
    const txtTodos = await heading.textContent();
    console.log('--- ENCABEZADO TODOS:', txtTodos);

    const countTodos = await facturas.count();
    console.log('--- FACTURAS TODOS VISIBLES:', countTodos);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, `ui_facturas_todos_${screenshotSuffix}.png`), fullPage: true });

    // 4. Cambiar a 2025
    await selectAnio.selectOption('2025');
    const txt2025 = await heading.textContent();
    console.log('--- ENCABEZADO 2025:', txt2025);
    console.log('--- FACTURAS 2025 VISIBLES:', await facturas.count());

    // 5. Cambiar a 2024
    await selectAnio.selectOption('2024');
    const txt2024 = await heading.textContent();
    console.log('--- ENCABEZADO 2024:', txt2024);
    console.log('--- FACTURAS 2024 VISIBLES:', await facturas.count());

    // Verificaciones formales
    expect(count2026).toBe(13);
    expect(countTodos).toBe(24);
  });
});
