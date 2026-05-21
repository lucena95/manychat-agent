const express = require('express');

const TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'leadsmastery2024';
const GHL_PHONE = '34663117022';

const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'ManyChat Agent + Telegram Bot' }));

// ManyChat webhook endpoint (se mantiene)
app.post('/webhook/nuevo-reel', async (req, res) => {
  const { secret, message, keyword } = req.body;
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  let kw = keyword;
  if (!kw && message) {
    const m = message.match(/(?:keyword|reel)[:\s]+([A-Z0-9_]+)/i);
    if (m) kw = m[1].toUpperCase();
  }
  if (!kw) return res.status(400).json({ error: 'Keyword no encontrada' });
  res.json({ status: 'processing', keyword: kw });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
  if (TOKEN) startPolling();
  else console.log('⚠️ TELEGRAM_TOKEN no configurado');
});

// ─── POLLING ──────────────────────────────────────────────────────────────────
async function tg(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function startPolling() {
  // Eliminar webhook si existe
  await tg('deleteWebhook');
  console.log('🤖 Bot Telegram activo (polling)');

  let offset = 0;
  while (true) {
    try {
      const data = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (update.message) await handleMessage(update.message);
        }
      }
    } catch (e) {
      console.error('Polling error:', e.message);
      await sleep(5000);
    }
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  console.log(`[${chatId}] ${msg.from?.first_name}: ${text}`);

  if (text.startsWith('/start')) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `🤖 *Agente LeadsMastery activo*\n\nPuedo crear flujos de ManyChat automáticamente.\n\n*Comandos:*\n/reel KEYWORD — Crea flujo REEL\\_KEYWORD\n/status — Estado del servidor\n/ayuda — Ayuda`,
      parse_mode: 'Markdown'
    });
    return;
  }

  if (text.startsWith('/status')) {
    await tg('sendMessage', { chat_id: chatId, text: '✅ Servidor online y funcionando' });
    return;
  }

  if (text.startsWith('/ayuda')) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `Usa: /reel PILATES\nEso crea el flujo REEL\\_PILATES en ManyChat`,
      parse_mode: 'Markdown'
    });
    return;
  }

  if (text.toLowerCase().startsWith('/reel ')) {
    const keyword = text.slice(6).trim().toUpperCase().replace(/\s+/g, '_');
    await tg('sendMessage', { chat_id: chatId, text: `⏳ Creando flujo REEL_${keyword}...` });
    try {
      await fetch('https://manychat-agent-production.up.railway.app/webhook/nuevo-reel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: WEBHOOK_SECRET, keyword })
      });
      await tg('sendMessage', {
        chat_id: chatId,
        text: `✅ *REEL\\_${keyword}* en proceso (~60 seg)\n\nURL: \`https://wa.me/${GHL_PHONE}?text=REEL\\_${keyword}\``,
        parse_mode: 'Markdown'
      });
    } catch (e) {
      await tg('sendMessage', { chat_id: chatId, text: `❌ Error: ${e.message}` });
    }
    return;
  }

  // Respuesta por defecto
  await tg('sendMessage', {
    chat_id: chatId,
    text: `Usa /reel KEYWORD para crear un flujo.\nEjemplo: /reel PILATES`
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
