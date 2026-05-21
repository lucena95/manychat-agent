const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'leadsmastery2024';
const GHL_PHONE = '34663117022';
const ACCOUNT_ID = 'fb105106091491726';
const SESSION_FILE = process.env.SESSION_FILE || path.join(__dirname, 'session.json');

// GHL API para confirmar via WhatsApp
const GHL_PIT = process.env.GHL_PIT || 'pit-0e375447-0584-4d94-976d-8de8b0253130';
const GHL_LOCATION = process.env.GHL_LOCATION || 'fdcwP0QXLjRQF4T2pjeo';

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ManyChat Agent v1', ts: new Date().toISOString() });
});

// Webhook recibe: { secret, message } o { secret, keyword }
// Ejemplos: "Nuevo Reel keyword PILATES", "keyword 3", "reel 5"
app.post('/webhook/nuevo-reel', async (req, res) => {
  const { secret, message, keyword, phone } = req.body;

  if (secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let reelKeyword = keyword;
  if (!reelKeyword && message) {
    const match = message.match(/(?:keyword|reel)[:\s]+([A-Z0-9_]+)/i);
    if (match) reelKeyword = match[1].toUpperCase();
    if (!reelKeyword) {
      const numMatch = message.match(/\b(\d+)\b/);
      if (numMatch) reelKeyword = numMatch[1];
    }
  }

  if (!reelKeyword) {
    return res.status(400).json({ error: 'Keyword no encontrada', tip: 'Usa: { "keyword": "PILATES" } o { "message": "Nuevo Reel keyword PILATES" }' });
  }

  const jobId = Date.now();
  console.log(`[${jobId}] Nuevo reel: REEL_${reelKeyword}`);

  res.json({ status: 'processing', keyword: reelKeyword, jobId, message: `Creando flujo REEL_${reelKeyword}... (~60s)` });

  createManyChatFlow(reelKeyword, phone, jobId).catch(err => {
    console.error(`[${jobId}] Error:`, err.message);
  });
});

async function createManyChatFlow(keyword, requesterPhone, jobId) {
  console.log(`[${jobId}] Iniciando Playwright para keyword: ${keyword}`);

  const sessionExists = fs.existsSync(SESSION_FILE);
  if (!sessionExists) {
    console.error(`[${jobId}] ERROR: Session file no encontrada en ${SESSION_FILE}`);
    return;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const context = await browser.newContext({
    storageState: SESSION_FILE,
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();

  try {
    // Ir directo a automatizaciones del account
    console.log(`[${jobId}] Abriendo ManyChat automatizaciones...`);
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/automation/keywords`, {
      waitUntil: 'networkidle', timeout: 30000
    });

    // Si redirige al login, la sesión expiró
    if (page.url().includes('/login') || page.url().includes('/signin')) {
      console.error(`[${jobId}] Sesión expirada - actualizar session.json`);
      await notifyGHL(requesterPhone, `❌ Sesión ManyChat expirada. Contacta al administrador.`);
      return;
    }

    await page.waitForTimeout(2000);

    // Buscar el flujo "IA" en la lista de automatizaciones
    console.log(`[${jobId}] Buscando flujo IA...`);
    await page.goto(`https://app.manychat.com/${ACCOUNT_ID}/automation`, {
      waitUntil: 'networkidle', timeout: 30000
    });
    await page.waitForTimeout(2000);

    // Buscar el flujo existente
    const iaFlowLink = page.locator('a:has-text("IA"), [href*="flow"]:has-text("IA")').first();
    const iaExists = await iaFlowLink.count() > 0;

    let flowUrl;
    if (iaExists) {
      flowUrl = await iaFlowLink.getAttribute('href');
      console.log(`[${jobId}] Flujo IA encontrado: ${flowUrl}`);
    } else {
      // Buscar cualquier flujo de Reel
      const reelLink = page.locator('[href*="flow"]').first();
      if (await reelLink.count() > 0) {
        flowUrl = await reelLink.getAttribute('href');
      }
    }

    if (!flowUrl) {
      console.error(`[${jobId}] No se encontró flujo base`);
      return;
    }

    // Abrir el flujo
    const fullUrl = flowUrl.startsWith('http') ? flowUrl : `https://app.manychat.com${flowUrl}`;
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log(`[${jobId}] Flujo abierto: ${page.url()}`);

    // En el Easy Builder, buscar la sección de Keywords
    // La keyword trigger está arriba del flujo
    const keywordSection = page.locator('text=Keywords, text=Palabras clave, text=Keyword').first();
    if (await keywordSection.count() > 0) {
      await keywordSection.click();
      await page.waitForTimeout(1000);
    }

    // Buscar el input de keyword y cambiarlo
    const kwInput = page.locator('input[value*="IA"], input[value*="REEL"], input[placeholder*="keyword"]').first();
    if (await kwInput.count() > 0) {
      await kwInput.triple_click();
      await kwInput.fill(`REEL_${keyword}`);
      await page.keyboard.press('Enter');
      console.log(`[${jobId}] Keyword actualizada a REEL_${keyword}`);
    }

    // Buscar el botón con wa.me y actualizar URL
    const waButton = page.locator('[class*="button"]:has-text("wa.me"), button:has-text("WhatsApp"), a[href*="wa.me"]').first();
    if (await waButton.count() > 0) {
      await waButton.dblclick();
      await page.waitForTimeout(500);
      const urlInput = page.locator('input[value*="wa.me"]').first();
      if (await urlInput.count() > 0) {
        await urlInput.triple_click();
        await urlInput.fill(`https://wa.me/${GHL_PHONE}?text=REEL_${keyword}`);
        await page.keyboard.press('Enter');
        console.log(`[${jobId}] URL actualizada: wa.me/?text=REEL_${keyword}`);
      }
    }

    // Publicar / Guardar
    await page.waitForTimeout(1000);
    const publishBtn = page.locator('button:has-text("Publish"), button:has-text("Publicar"), button:has-text("Save")').first();
    if (await publishBtn.count() > 0) {
      await publishBtn.click();
      await page.waitForTimeout(2000);
      console.log(`[${jobId}] Flujo publicado ✅`);
    }

    // Guardar la sesión actualizada
    await context.storageState({ path: SESSION_FILE });
    console.log(`[${jobId}] Sesión actualizada`);

    // Notificar via GHL a Javier
    if (requesterPhone) {
      await notifyGHL(requesterPhone, `✅ Flujo REEL_${keyword} creado en ManyChat!\n\nURL activa: https://wa.me/${GHL_PHONE}?text=REEL_${keyword}\n\nÚsala en tu plantilla de Instagram 🎯`);
    }

    console.log(`[${jobId}] ✅ COMPLETADO: REEL_${keyword}`);

  } catch (error) {
    console.error(`[${jobId}] Error en Playwright:`, error.message);
    if (requesterPhone) {
      await notifyGHL(requesterPhone, `❌ Error creando REEL_${keyword}: ${error.message}`);
    }
  } finally {
    await browser.close();
  }
}

async function notifyGHL(phone, message) {
  try {
    // Buscar contacto por teléfono en GHL
    const searchRes = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION}&query=${phone}`, {
      headers: { 'Authorization': `Bearer ${GHL_PIT}`, 'Version': '2021-07-28' }
    });
    const searchData = await searchRes.json();
    const contactId = searchData?.contacts?.[0]?.id;
    if (!contactId) return;

    // Enviar mensaje WhatsApp
    await fetch(`https://services.leadconnectorhq.com/conversations/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GHL_PIT}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      },
      body: JSON.stringify({
        locationId: GHL_LOCATION,
        contactId,
        type: 'WhatsApp',
        message
      })
    });
    console.log('Notificación enviada a GHL');
  } catch (e) {
    console.error('Error notificando GHL:', e.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 ManyChat Agent corriendo en puerto ${PORT}`);
  console.log(`📡 Endpoint: POST /webhook/nuevo-reel`);
  console.log(`   { "secret": "${WEBHOOK_SECRET}", "keyword": "PILATES", "phone": "34XXXXXXXXX" }`);
  console.log(`📁 Session file: ${SESSION_FILE} (${fs.existsSync(SESSION_FILE) ? 'EXISTE ✅' : 'NO EXISTE ❌'})`);
});
