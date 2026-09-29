import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración de Playwright para pruebas E2E de la PWA Ganaderos Campo.
 * Evalúa experiencia móvil en campo y escritorio, Service Worker, IndexedDB y modo Offline.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 8000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:8089',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 7'],
        hasTouch: true,
        isMobile: true
      }
    },
    {
      name: 'Desktop Chromium',
      use: {
        ...devices['Desktop Chrome']
      }
    }
  ],
  webServer: {
    command: 'python -m uvicorn src.server.app:app --host 127.0.0.1 --port 8089',
    port: 8089,
    timeout: 15 * 1000,
    reuseExistingServer: !process.env.CI,
    env: {
      APP_ENV: 'e2e'
    }
  }
});
