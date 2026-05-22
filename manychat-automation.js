// ManyChat automation via Browserless
// Estrategia: interceptar el GET del flujo y hacer el POST edit con los datos capturados
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || 'wss://browserless-production-84b4.up.railway.app';
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || 'leadsmastery2024';
const SESSION_FILE = process.env.SESSION_FILE || path.join(__dirname, 'session.json');
const ACCOUNT_ID = 'fb105106091491726';
const GHL_PHONE = '34663117022';
const ACTIVE_FLOW_NS = process.env.ACTIVE_FLOW_NS || 'content20260522004258_498566';

async function createManyChatFlow(keyword) {
  console.log(`[ManyChat] Iniciando para palabra: ${keyword}`);

  const browser = await chromium.connectOverCDP(
    `${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`
  ).catch(e => { throw new Error(`Browserless no disponible: ${e.message}`); });

  const context = await browser.newContext({
    storageState: fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    // Interceptar el GET del flujo para capturar sus datos y el CSRF token
    let capturedFlow = null;
    let capturedCsrf = null;

    await context.route(`**/${ACCOUNT_ID}/easyBuilder/get*`, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      try {
        capturedFlow = JSON.parse(body);
        console.log(`[ManyChat] Flujo capturado: ${capturedFlow.flow_name}`);
      } catch (e) {
        console.log(`[ManyChat] Respuesta no es JSON: ${body.substring(0, 100)}`);
      }
      await route.fulfill({ response, body });
    });

    // Interceptar cualquier request para capturar el CSRF token
    context.on('request', req => {
      const csrf = req.headers()['x-csrf-token'];
      if (csrf) capturedCsrf = csrf;
    });

    // Navegar al Easy Builder — esto dispara el GET automáticamente
    console.log('[ManyChat] Cargando Easy Builder...');
    await page.goto(
      `https://app.manychat.com/${ACCOUNT_ID}/cms/easy-builder/${ACTIVE_FLOW_NS}`,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );

    // Verificar sesión
    if (page.url().includes('signin') || page.url().includes('login')) {
      throw new Error('Sesión expirada');
    }

    // Esperar a que el flujo sea capturado
    await page.waitForTimeout(4000);

    if (!capturedFlow) {
      throw new Error('No se capturó el flujo — posible sesión expirada o timeout');
    }

    console.log(`[ManyChat] Flujo OK: ${capturedFlow.flow_name} (${capturedFlow.status})`);

    // Modificar la keyword y la URL en el JSON
    const flowStr = JSON.stringify(capturedFlow);

    const step1 = flowStr.replace(
      /"include_keywords":\s*\[[^\]]*\]/g,
      `"include_keywords":["${keyword}"]`
    );
    const step2 = step1.replace(
      /"url":"https:\/\/wa\.me\/[^"]+"/g,
      `"url":"https://wa.me/${GHL_PHONE}?text=REEL_${keyword}"`
    );

    if (flowStr === step2) {
      console.warn('[ManyChat] No se encontraron patrones para cambiar');
    } else {
      const changes = [];
      if (flowStr !== step1) changes.push('keyword');
      if (step1 !== step2) changes.push('URL');
      console.log(`[ManyChat] Cambiado: ${changes.join(', ')}`);
    }

    const modifiedFlow = JSON.parse(step2);

    // Guardar via POST easyBuilder/edit — usando fetch desde el contexto de la página
    console.log('[ManyChat] Guardando...');
    const saveResult = await page.evaluate(async ({ accountId, flowNs, structure, csrf }) => {
      const res = await fetch(`https://app.manychat.com/${accountId}/easyBuilder/edit`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
          'x-csrf-token': csrf || '',
          'x-frontend-bundle': '936'
        },
        body: JSON.stringify({ flow_ns: flowNs, structure: structure.structure })
      });
      const text = await res.text();
      return { status: res.status, body: text.substring(0, 300) };
    }, {
      accountId: ACCOUNT_ID,
      flowNs: ACTIVE_FLOW_NS,
      structure: modifiedFlow,
      csrf: capturedCsrf || ''
    });

    console.log(`[ManyChat] Guardado: HTTP ${saveResult.status} — ${saveResult.body.substring(0, 80)}`);

    if (saveResult.status !== 200) {
      throw new Error(`Error al guardar (HTTP ${saveResult.status}): ${saveResult.body.substring(0, 100)}`);
    }

    // Guardar sesión actualizada
    await context.storageState({ path: SESSION_FILE });

    console.log(`[ManyChat] ✅ REEL_${keyword} configurado`);
    return {
      success: true,
      keyword,
      url: `https://wa.me/${GHL_PHONE}?text=REEL_${keyword}`
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
