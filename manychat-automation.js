// ManyChat automation — método probado y funcionando
// 1. Navegar al Easy Builder → reload captura el flujo via route interception
// 2. Extraer CSRF de window.__INIT__["app.csrf_token"]
// 3. Modificar keyword + URL
// 4. POST a easyBuilder/edit con CSRF → guarda cambios

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || 'wss://browserless-production-84b4.up.railway.app';
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || 'leadsmastery2024';
const SESSION_FILE = process.env.SESSION_FILE || path.join(__dirname, 'session.json');
const ACCOUNT_ID = 'fb105106091491726';
const GHL_PHONE = '34663117022';

async function getActiveFlowNs(page) {
  // Interceptar la lista de flujos (el fetch directo da 404, route interception sí funciona)
  let flowsList = null;
  await page.route('**/cms/getFlows**', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    try { flowsList = JSON.parse(body); } catch(e) {}
    await route.fulfill({ response, body });
  });

  await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/cms?path=/&field=modified&order=desc`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await page.waitForTimeout(3000);

  if (!flowsList?.list) return null;

  // Encontrar el primer flujo de tipo "next_post" (comentarios → DM)
  const flow = flowsList.list.find(f =>
    f.type === 'flow' &&
    f.triggers?.widgets?.some(w =>
      w.widget_type === 'feed_comment_trigger' &&
      w.data?.feed_comment_settings?.post_covered_area === 'next_post'
    )
  );

  return flow?.ns || null;
}

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
    // Paso 1: Ir al dashboard para verificar sesión
    console.log('[ManyChat] Verificando sesión...');
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/dashboard`, {
      waitUntil: 'domcontentloaded', timeout: 60000
    });
    await page.waitForTimeout(2000);

    if (page.url().includes('signin') || page.url().includes('login')) {
      throw new Error('Sesión expirada');
    }

    // Paso 2: Encontrar el flujo activo más reciente
    let flowNs = process.env.ACTIVE_FLOW_NS;
    if (!flowNs) {
      console.log('[ManyChat] Buscando flujo activo...');
      flowNs = await getActiveFlowNs(page);
    }
    if (!flowNs) throw new Error('No se encontró flujo activo de tipo next_post');
    console.log(`[ManyChat] Flujo: ${flowNs}`);

    // Paso 3: Ir al Easy Builder e interceptar el GET del flujo
    let capturedFlow = null;
    let capturedCsrf = null;

    await context.route(`**/easyBuilder/get*`, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      try { capturedFlow = JSON.parse(body); } catch(e) {}
      await route.fulfill({ response, body });
    });

    context.on('request', req => {
      const csrf = req.headers()['x-csrf-token'];
      if (csrf) capturedCsrf = csrf;
    });

    // Navegar al Easy Builder
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/cms/easy-builder/${flowNs}`, {
      waitUntil: 'domcontentloaded', timeout: 60000
    });
    await page.waitForTimeout(3000);

    // Si el flujo no fue capturado, hacer reload (fuerza el GET)
    if (!capturedFlow) {
      console.log('[ManyChat] Forzando recarga para capturar flujo...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);
    }

    // Extraer CSRF de window.__INIT__ como respaldo
    if (!capturedCsrf) {
      capturedCsrf = await page.evaluate(() => {
        for (const s of document.querySelectorAll('script')) {
          if (s.textContent?.includes('window.__INIT__')) {
            const m = s.textContent.match(/window\.__INIT__\s*=\s*(\{[^<]+\})/);
            if (m) { try { return JSON.parse(m[1])['app.csrf_token']; } catch(e) {} }
          }
        }
        return null;
      });
    }

    if (!capturedFlow) throw new Error('No se capturó el flujo');
    console.log(`[ManyChat] Flujo: ${capturedFlow.flow_name} | CSRF: ${capturedCsrf ? 'OK' : 'VACÍO'}`);

    // Paso 4: Modificar keyword y URL
    const flowStr = JSON.stringify(capturedFlow);
    const modified = flowStr
      .replace(/"include_keywords":\s*\[[^\]]*\]/g, `"include_keywords":["${keyword}"]`)
      .replace(/"url":"https:\/\/wa\.me\/[^"]+"/g, `"url":"https://wa.me/${GHL_PHONE}?text=REEL_${keyword}"`);

    if (flowStr === modified) {
      console.warn('[ManyChat] No se encontraron patrones para cambiar');
    } else {
      const changes = [];
      if (JSON.stringify(capturedFlow).match(/"include_keywords":\s*\[[^\]]*\]/) && modified.includes(keyword)) changes.push('keyword');
      if (modified.includes(`REEL_${keyword}`)) changes.push('URL');
      console.log(`[ManyChat] Cambiado: ${changes.join(', ')}`);
    }

    const modifiedFlow = JSON.parse(modified);

    // Paso 5: Guardar
    console.log('[ManyChat] Guardando...');
    const saveResult = await page.evaluate(async ({ accountId, ns, structure, csrf }) => {
      const res = await fetch(`https://app.manychat.com/${accountId}/easyBuilder/edit`, {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
          'x-csrf-token': csrf || '',
          'x-frontend-bundle': '936'
        },
        body: JSON.stringify({ flow_ns: ns, structure })
      });
      return { status: res.status, body: (await res.text()).substring(0, 200) };
    }, { accountId: ACCOUNT_ID, ns: flowNs, structure: modifiedFlow.structure, csrf: capturedCsrf });

    console.log(`[ManyChat] HTTP ${saveResult.status}: ${saveResult.body.substring(0, 80)}`);

    if (saveResult.status !== 200 || saveResult.body.includes('"errors"')) {
      throw new Error(`Error al guardar: ${saveResult.body.substring(0, 100)}`);
    }

    // Guardar sesión actualizada
    await context.storageState({ path: SESSION_FILE });

    console.log(`[ManyChat] ✅ REEL_${keyword} listo`);
    return { success: true, keyword, url: `https://wa.me/${GHL_PHONE}?text=REEL_${keyword}` };

  } catch (err) {
    console.error(`[ManyChat] Error:`, err.message);
    throw err;
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { createManyChatFlow };
