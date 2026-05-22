// ManyChat automation via Browserless (Chrome en la nube)
// Estrategia: usar el API interno de ManyChat via fetch autenticado
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || 'wss://browserless-production-84b4.up.railway.app';
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || 'leadsmastery2024';
const SESSION_FILE = process.env.SESSION_FILE || path.join(__dirname, 'session.json');
const ACCOUNT_ID = 'fb105106091491726';
const GHL_PHONE = '34663117022';
const BASE_FLOW_NS = 'content20260521152458_230387';

async function createManyChatFlow(keyword) {
  console.log(`[ManyChat] Conectando a Browserless para palabra: ${keyword}`);

  const wsUrl = `${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`;
  let browser;

  try {
    browser = await chromium.connectOverCDP(wsUrl);
    console.log(`[ManyChat] Conectado a Browserless ✅`);
  } catch (e) {
    throw new Error(`Browserless no disponible: ${e.message}`);
  }

  const sessionExists = fs.existsSync(SESSION_FILE);
  const context = await browser.newContext({
    storageState: sessionExists ? SESSION_FILE : undefined,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    // Paso 1: Cargar ManyChat para obtener cookies de sesión válidas
    console.log(`[ManyChat] Iniciando sesión...`);
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/dashboard`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(3000);

    if (page.url().includes('signin') || page.url().includes('login')) {
      throw new Error('Sesión expirada — ejecuta /renovar_sesion');
    }

    console.log(`[ManyChat] Dashboard abierto ✅`);

    // Paso 2: Usar el API interno de ManyChat via fetch desde el contexto del browser
    // (ya tiene las cookies de sesión cargadas)
    const result = await page.evaluate(async ({ accountId, flowNs, keyword, phone }) => {
      // Obtener el flujo actual
      const getRes = await fetch(`/fb${accountId}/easyBuilder/get?flow_ns=${flowNs}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!getRes.ok) return { error: `GET falló: ${getRes.status}` };
      const flowData = await getRes.json();

      if (!flowData || flowData.status === 'error') {
        return { error: 'No se pudo obtener el flujo: ' + JSON.stringify(flowData).substring(0, 100) };
      }

      // Modificar la keyword en el trigger
      const flow = flowData.data || flowData;
      let modified = false;

      // Buscar y cambiar keyword en triggers
      const flowStr = JSON.stringify(flow);
      const newFlowStr = flowStr.replace(
        /"include_keywords":\s*\[[^\]]*\]/g,
        `"include_keywords":["${keyword}"]`
      );

      // También cambiar la URL wa.me
      const finalStr = newFlowStr.replace(
        /https:\/\/wa\.me\/[^"]+/g,
        `https://wa.me/${phone}?text=REEL_${keyword}`
      );

      if (flowStr === finalStr) {
        return { error: 'No se encontraron patrones para cambiar', preview: flowStr.substring(0, 200) };
      }

      // Guardar el flujo modificado
      const newFlow = JSON.parse(finalStr);
      const saveRes = await fetch(`/fb${accountId}/easyBuilder/save`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow_ns: flowNs, data: newFlow })
      });

      if (!saveRes.ok) return { error: `SAVE falló: ${saveRes.status}` };
      const saveData = await saveRes.json();

      // Publicar
      const publishRes = await fetch(`/fb${accountId}/easyBuilder/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow_ns: flowNs })
      });

      const publishData = await publishRes.json();

      return {
        success: true,
        saved: saveData.status,
        published: publishData.status
      };
    }, { accountId: ACCOUNT_ID, flowNs: BASE_FLOW_NS, keyword, phone: GHL_PHONE });

    console.log(`[ManyChat] Resultado API:`, result);

    if (result.error) {
      throw new Error(result.error);
    }

    // Screenshot como prueba
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/cms/easy-builder/${BASE_FLOW_NS}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    }).catch(() => {}); // No bloquear si falla el screenshot
    await page.waitForTimeout(2000);
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null);

    await context.storageState({ path: SESSION_FILE });

    console.log(`[ManyChat] ✅ REEL_${keyword} listo`);
    return {
      success: true,
      keyword,
      url: `https://wa.me/${GHL_PHONE}?text=REEL_${keyword}`,
      screenshot
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
    await page.evaluate(() => {
      const banner = document.getElementById('usercentrics-cmp-ui');
      if (banner) banner.remove();
      document.body.style.pointerEvents = 'auto';
      document.body.style.overflow = 'auto';
    });
  } catch (e) {}
}

module.exports = { createManyChatFlow };
