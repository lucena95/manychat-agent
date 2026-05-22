// ManyChat automation via Browserless
// Usa el endpoint interno easyBuilder/edit (capturado via reverse engineering)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || 'wss://browserless-production-84b4.up.railway.app';
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || 'leadsmastery2024';
const SESSION_FILE = process.env.SESSION_FILE || path.join(__dirname, 'session.json');
const ACCOUNT_ID = 'fb105106091491726';
const GHL_PHONE = '34663117022';

// Flow NS del flujo activo "copy 32" — se actualiza automáticamente al crear nuevos
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
    // Paso 1: Cargar ManyChat para activar las cookies
    console.log('[ManyChat] Conectando...');
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/dashboard`, {
      waitUntil: 'domcontentloaded', timeout: 60000
    });
    await page.waitForTimeout(2000);

    if (page.url().includes('signin') || page.url().includes('login')) {
      throw new Error('Sesión expirada');
    }

    // Paso 2: Obtener CSRF token y datos del flujo actual
    console.log('[ManyChat] Obteniendo flujo...');
    const { flowData, csrfToken } = await page.evaluate(async ({ accountId, flowNs }) => {
      const res = await fetch(`https://app.manychat.com/${accountId}/easyBuilder/get?flow_ns=${flowNs}`, {
        credentials: 'include',
        headers: { 'x-requested-with': 'XMLHttpRequest' }
      });

      // Buscar CSRF token en el HTML
      const match = document.documentElement.innerHTML.match(/csrf[_-]token['":\s]+['"]([a-f0-9]+)['"]/i);
      const csrf = match?.[1] || document.querySelector('meta[name="csrf-token"]')?.content || '';

      const text = await res.text();
      return { flowData: text, csrfToken: csrf };
    }, { accountId: ACCOUNT_ID, flowNs: ACTIVE_FLOW_NS });

    if (!flowData || flowData.includes('DOCTYPE')) {
      throw new Error(`No se pudo obtener el flujo (status: sin JSON)`);
    }

    const flow = JSON.parse(flowData);
    console.log(`[ManyChat] Flujo obtenido: ${flow.flow_name} (${flow.status})`);

    // Paso 3: Modificar keyword y URL en el JSON
    const flowStr = JSON.stringify(flow);

    // Cambiar keyword
    const newFlowStr = flowStr.replace(
      /"include_keywords":\s*\[[^\]]*\]/g,
      `"include_keywords":["${keyword}"]`
    );

    // Cambiar URL wa.me
    const finalStr = newFlowStr.replace(
      /"url":"https:\/\/wa\.me\/[^"]+"/g,
      `"url":"https://wa.me/${GHL_PHONE}?text=REEL_${keyword}"`
    );

    const changes = (flowStr !== newFlowStr ? 'keyword ' : '') + (newFlowStr !== finalStr ? 'url' : '');
    console.log(`[ManyChat] Cambios: ${changes || 'ninguno detectado'}`);

    if (flowStr === finalStr) {
      console.warn('[ManyChat] AVISO: No se detectaron cambios en el JSON');
    }

    const modifiedFlow = JSON.parse(finalStr);

    // Paso 4: Guardar via easyBuilder/edit
    console.log('[ManyChat] Guardando...');
    const saveResult = await page.evaluate(async ({ accountId, flowNs, structure, csrf }) => {
      const body = JSON.stringify({ flow_ns: flowNs, structure: structure.structure });

      const res = await fetch(`https://app.manychat.com/${accountId}/easyBuilder/edit`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
          'x-csrf-token': csrf,
          'x-frontend-bundle': '936'
        },
        body
      });

      const text = await res.text();
      return { status: res.status, body: text.substring(0, 300) };
    }, { accountId: ACCOUNT_ID, flowNs: ACTIVE_FLOW_NS, structure: modifiedFlow, csrf: csrfToken });

    console.log(`[ManyChat] Guardado: ${saveResult.status} — ${saveResult.body.substring(0, 100)}`);

    if (saveResult.status !== 200) {
      throw new Error(`Error al guardar: ${saveResult.status} ${saveResult.body}`);
    }

    // Guardar sesión actualizada
    await context.storageState({ path: SESSION_FILE });

    console.log(`[ManyChat] ✅ REEL_${keyword} listo`);
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
