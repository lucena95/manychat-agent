// ManyChat automation via Browserless (Chrome en la nube)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || 'wss://browserless-production-84b4.up.railway.app';
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || 'leadsmastery2024';
const SESSION_FILE = process.env.SESSION_FILE || path.join(__dirname, 'session.json');
const ACCOUNT_ID = 'fb105106091491726';
const GHL_PHONE = '34663117022';

// Borra el flujo más reciente (el que acabamos de modificar la vez anterior)
async function deleteLatestFlow(page) {
  try {
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/cms?path=/&field=modified&order=desc`, {
      waitUntil: 'domcontentloaded', timeout: 60000
    });
    await page.waitForTimeout(2000);
    await dismissCookieBanner(page);

    // Buscar el botón de menú (3 puntos) del primer flujo y borrarlo
    const deleted = await page.evaluate(() => {
      // Encontrar el primer flujo de la lista y hacer clic en su menú
      const cards = document.querySelectorAll('[class*="_card_"]');
      if (cards.length === 0) return 'no cards';

      // Buscar el botón de opciones en el primer card
      const firstCard = cards[0];
      const menuBtn = firstCard.querySelector('[class*="interactable"], [class*="anchor"]');
      if (menuBtn) {
        menuBtn.click();
        return 'menu clicked';
      }
      return 'no menu button';
    });

    await page.waitForTimeout(1000);

    // Buscar y clicar "Eliminar" en el menú desplegable
    const deleteBtn = page.getByText('Eliminar').first();
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(1000);
      // Confirmar borrado si aparece diálogo
      const confirmBtn = page.getByText('Eliminar').nth(1);
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      }
      console.log('[ManyChat] Flujo anterior borrado ✅');
    }
  } catch (e) {
    console.log('[ManyChat] No se pudo borrar flujo anterior:', e.message);
  }
}

async function createManyChatFlow(keyword) {
  console.log(`[ManyChat] Conectando a Browserless para keyword: ${keyword}`);

  // Conectar a Browserless en la nube via WebSocket
  const wsUrl = `${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`;

  let browser;
  try {
    browser = await chromium.connectOverCDP(wsUrl);
    console.log(`[ManyChat] Conectado a Browserless ✅`);
  } catch (e) {
    console.error(`[ManyChat] Error conectando a Browserless:`, e.message);
    throw new Error(`Browserless no disponible: ${e.message}`);
  }

  // Crear contexto con la sesión de ManyChat guardada
  const sessionExists = fs.existsSync(SESSION_FILE);
  const context = await browser.newContext({
    storageState: sessionExists ? SESSION_FILE : undefined,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    // Abrir ManyChat
    console.log(`[ManyChat] Abriendo ManyChat...`);
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/cms?path=/&field=modified&order=desc`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(3000);

    // Verificar sesión activa
    if (page.url().includes('login') || page.url().includes('signin')) {
      throw new Error('Sesión de ManyChat expirada — necesita renovarse');
    }

    await page.waitForTimeout(2000);
    console.log(`[ManyChat] ManyChat abierto: ${page.url()}`);

    // Cerrar banner de cookies GDPR (bloquea todos los clics si aparece)
    await dismissCookieBanner(page);

    // Borrar el flujo del reel anterior (siempre solo hay uno activo)
    // await deleteLatestFlow(page); // Desactivado por ahora — activar si se quiere borrar el anterior

    // Abrir el flujo base para modificarlo
    const BASE_FLOW = 'content20260521152458_230387';
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/cms/easy-builder/${BASE_FLOW}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(3000);
    await dismissCookieBanner(page); // Cerrar banner también aquí

    // Clicar Editar
    const editBtn = page.getByText('Editar').first();
    if (await editBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(2000);
    }

    // Cambiar keyword — usar type() para que React detecte los cambios
    const kwInput = page.locator(`input[name*="include_keywords_input"]`).first();
    const kwVisible = await kwInput.isVisible({ timeout: 8000 }).catch(() => false);

    if (kwVisible) {
      await kwInput.click({ clickCount: 3 }); // seleccionar todo
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await kwInput.type(keyword, { delay: 50 }); // type carácter a carácter para React
      await page.keyboard.press('Enter');
      console.log(`[ManyChat] Keyword cambiada a: ${keyword}`);
    } else {
      // Fallback: buscar por placeholder
      const inputs = await page.$$('input[placeholder*="Escribe una palabra"]');
      if (inputs.length > 0) {
        await inputs[0].click({ clickCount: 3 });
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(keyword, { delay: 50 });
        await page.keyboard.press('Enter');
        console.log(`[ManyChat] Keyword cambiada (fallback): ${keyword}`);
      }
    }

    // Buscar y cambiar la URL del botón wa.me — también usar type() para React
    const allInputs = await page.$$('input, textarea');
    for (const inp of allInputs) {
      const val = await inp.inputValue().catch(() => '');
      if (val.includes('wa.me')) {
        await inp.click({ clickCount: 3 });
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await inp.type(`https://wa.me/${GHL_PHONE}?text=REEL_${keyword}`, { delay: 30 });
        await page.keyboard.press('Enter');
        console.log(`[ManyChat] URL actualizada: wa.me/?text=REEL_${keyword}`);
        break;
      }
    }

    // Guardar cambios (Actualizar)
    const updateBtn = page.getByText('Actualizar').first();
    if (await updateBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await updateBtn.click();
      await page.waitForTimeout(2000);
      console.log(`[ManyChat] Cambios guardados ✅`);
    }

    // Actualizar sesión guardada
    await context.storageState({ path: SESSION_FILE });

    // Capturar screenshot como prueba
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 });

    console.log(`[ManyChat] ✅ Flujo REEL_${keyword} listo`);
    return {
      success: true,
      keyword,
      url: `https://wa.me/${GHL_PHONE}?text=REEL_${keyword}`,
      screenshot  // Buffer con la imagen
    };

  } catch (err) {
    console.error(`[ManyChat] Error:`, err.message);
    throw err;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function dismissCookieBanner(page) {
  try {
    // Esperar si el banner está cargando
    await page.waitForTimeout(1000);

    // Intentar cerrar el banner de Usercentrics
    const dismissed = await page.evaluate(() => {
      // Método 1: eliminar el elemento del DOM directamente
      const banner = document.getElementById('usercentrics-cmp-ui');
      if (banner) {
        banner.remove();
        return 'removed banner';
      }

      // Método 2: buscar botón de aceptar
      const acceptBtns = Array.from(document.querySelectorAll('button')).filter(b =>
        b.textContent?.toLowerCase().includes('accept') ||
        b.textContent?.toLowerCase().includes('aceptar') ||
        b.textContent?.toLowerCase().includes('agree') ||
        b.textContent?.toLowerCase().includes('rechazar') ||
        b.textContent?.toLowerCase().includes('reject')
      );
      if (acceptBtns.length > 0) {
        acceptBtns[0].click();
        return 'clicked accept button';
      }

      return 'no banner found';
    });

    console.log(`[ManyChat] Cookie banner: ${dismissed}`);

    // También eliminar via shadow DOM si existe
    await page.evaluate(() => {
      const aside = document.querySelector('aside[id*="usercentrics"]');
      if (aside) aside.style.display = 'none';

      // Restaurar el scroll y pointer events del body
      document.body.style.pointerEvents = 'auto';
      document.body.style.overflow = 'auto';
    });

    await page.waitForTimeout(500);
  } catch (e) {
    console.log('[ManyChat] Cookie banner check skipped:', e.message);
  }
}

module.exports = { createManyChatFlow };
