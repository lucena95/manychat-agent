// ManyChat automation via Browserless (Chrome en la nube)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || 'wss://browserless-production-84b4.up.railway.app';
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || 'leadsmastery2024';
const SESSION_FILE = process.env.SESSION_FILE || path.join(__dirname, 'session.json');
const ACCOUNT_ID = 'fb105106091491726';
const GHL_PHONE = '34663117022';

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

    // Abrir el flujo base para duplicarlo
    const BASE_FLOW = 'content20260521152458_230387';
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/cms/easy-builder/${BASE_FLOW}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(3000);

    // Clicar Editar
    const editBtn = page.getByText('Editar').first();
    if (await editBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(2000);
    }

    // Cambiar keyword de "IA" a la nueva
    const kwInput = page.locator(`input[name*="include_keywords_input"]`).first();
    if (await kwInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await kwInput.triple_click();
      await kwInput.fill(keyword);
      console.log(`[ManyChat] Keyword cambiada a: ${keyword}`);
    } else {
      // Intentar por placeholder
      const inputs = await page.$$('input[placeholder*="Escribe una palabra"]');
      if (inputs.length > 0) {
        await inputs[0].triple_click();
        await inputs[0].fill(keyword);
      }
    }

    // Buscar y cambiar la URL del botón wa.me
    const allInputs = await page.$$('input, textarea');
    for (const inp of allInputs) {
      const val = await inp.inputValue().catch(() => '');
      if (val.includes('wa.me')) {
        await inp.triple_click();
        await inp.fill(`https://wa.me/${GHL_PHONE}?text=REEL_${keyword}`);
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

module.exports = { createManyChatFlow };
