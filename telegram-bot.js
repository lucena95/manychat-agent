const express = require('express');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'leadsmastery2024';
const RAILWAY_WEBHOOK = 'https://manychat-agent-production.up.railway.app/webhook/nuevo-reel';
const ALLOWED_CHAT_IDS = (process.env.ALLOWED_CHAT_IDS || '').split(',').filter(Boolean);
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';

const app = express();
app.use(express.json());

// ─── Telegram API helper ─────────────────────────────────────────────────────
async function sendTelegram(chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
    const data = await res.json();
    if (!data.ok) console.error('Telegram send error:', data.description);
    return data;
  } catch (e) {
    console.error('sendTelegram error:', e.message);
  }
}

// ─── Call Railway ManyChat agent ─────────────────────────────────────────────
async function createManyChatFlow(keyword, phone) {
  const res = await fetch(RAILWAY_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: WEBHOOK_SECRET, keyword, phone })
  });
  return res.json();
}

// ─── Parse message with Claude ───────────────────────────────────────────────
async function parseWithClaude(message) {
  if (!CLAUDE_API_KEY) return null;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `Eres un asistente que interpreta comandos de automatización de marketing.
Cuando el usuario pide crear un flujo de ManyChat, extrae la keyword.
Responde SOLO en JSON: {"action": "crear_reel", "keyword": "KEYWORD"}
o {"action": "otro", "respuesta": "texto de respuesta"} si no es una solicitud de reel.
Ejemplos:
- "keyword pilates" → {"action": "crear_reel", "keyword": "PILATES"}
- "nuevo reel para yoga" → {"action": "crear_reel", "keyword": "YOGA"}
- "reel 3" → {"action": "crear_reel", "keyword": "3"}
- "hola" → {"action": "otro", "respuesta": "Hola! Puedo crear flujos de ManyChat. Dime: /reel KEYWORD"}`,
      messages: [{ role: 'user', content: message }]
    })
  });

  const data = await res.json();
  try {
    return JSON.parse(data.content[0].text);
  } catch {
    return null;
  }
}

// ─── Webhook from Telegram ────────────────────────────────────────────────────
app.post(`/telegram/${TELEGRAM_TOKEN}`, async (req, res) => {
  res.sendStatus(200);

  const update = req.body;
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const text = msg.text || '';
  const userId = msg.from?.id?.toString();

  console.log(`[Telegram] ${msg.from?.username || userId}: ${text}`);

  // Security: only allow authorized users
  if (ALLOWED_CHAT_IDS.length > 0 && !ALLOWED_CHAT_IDS.includes(chatId.toString())) {
    sendTelegram(chatId, '❌ No autorizado.');
    return;
  }

  // ── Comandos directos ──
  if (text.startsWith('/start')) {
    sendTelegram(chatId, `🤖 *Agente LeadsMastery activo*\n\nPuedo crear flujos de ManyChat automáticamente.\n\n*Comandos:*\n/reel KEYWORD — Crea flujo REEL\\_KEYWORD\n/status — Estado del servidor\n/ayuda — Ver ayuda\n\n*O escríbeme en lenguaje natural:*\n"nuevo reel para pilates"\n"keyword YOGA"`);
    return;
  }

  if (text.startsWith('/ayuda')) {
    sendTelegram(chatId, `📋 *Cómo crear un flujo de ManyChat:*\n\n1️⃣ Escribe: \`/reel PILATES\`\n2️⃣ El agente abre ManyChat y:\n   • Cambia la keyword a \`REEL\\_PILATES\`\n   • Actualiza la URL a \`wa.me/34663117022?text=REEL\\_PILATES\`\n   • Publica el flujo\n3️⃣ En ~60 seg recibes confirmación\n\nTambién puedes escribir en lenguaje natural:\n"Nuevo reel de yoga, keyword YOGA"`);
    return;
  }

  if (text.startsWith('/status')) {
    try {
      const r = await fetch('https://manychat-agent-production.up.railway.app/');
      const d = await r.json();
      sendTelegram(chatId, `✅ Servidor online\n\`${d.ts}\``);
    } catch {
      sendTelegram(chatId, '❌ Servidor no responde');
    }
    return;
  }

  // Comando directo /reel KEYWORD
  if (text.startsWith('/reel ')) {
    const keyword = text.replace('/reel ', '').trim().toUpperCase().replace(/\s+/g, '_');
    if (!keyword) { sendTelegram(chatId, '⚠️ Usa: /reel KEYWORD'); return; }
    sendTelegram(chatId, `⏳ Creando flujo *REEL\\_${keyword}* en ManyChat...`);
    const result = await createManyChatFlow(keyword);
    sendTelegram(chatId, `✅ Solicitud enviada: REEL\\_${keyword}\nID: ${result.jobId || '?'}`);
    return;
  }

  // Lenguaje natural con Claude
  if (CLAUDE_API_KEY) {
    const parsed = await parseWithClaude(text);
    if (parsed?.action === 'crear_reel' && parsed?.keyword) {
      const keyword = parsed.keyword.toUpperCase().replace(/\s+/g, '_');
      sendTelegram(chatId, `⏳ Creando flujo *REEL\\_${keyword}* en ManyChat...`);
      await createManyChatFlow(keyword);
      sendTelegram(chatId, `✅ Flujo *REEL\\_${keyword}* en proceso (~60 seg)\n\nURL activa: \`https://wa.me/34663117022?text=REEL\\_${keyword}\``);
    } else if (parsed?.respuesta) {
      sendTelegram(chatId, parsed.respuesta);
    } else {
      sendTelegram(chatId, `No entendí. Prueba:\n/reel KEYWORD\n\nEjemplo: \`/reel PILATES\``);
    }
  } else {
    // Sin Claude, solo comandos directos
    const match = text.match(/(?:reel|keyword)[:\s]+([A-Z0-9_]+)/i);
    if (match) {
      const keyword = match[1].toUpperCase();
      sendTelegram(chatId, `⏳ Creando flujo *REEL\\_${keyword}*...`);
      await createManyChatFlow(keyword);
      sendTelegram(chatId, `✅ Flujo *REEL\\_${keyword}* en proceso (~60 seg)`);
    } else {
      sendTelegram(chatId, `Hola! Usa:\n/reel KEYWORD\nEjemplo: \`/reel PILATES\``);
    }
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'ManyChat Agent + Telegram Bot' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🤖 Servidor corriendo en puerto ${PORT}`);

  // Registrar webhook de Telegram
  if (TELEGRAM_TOKEN) {
    const webhookUrl = `${process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : 'https://manychat-agent-production.up.railway.app'}/telegram/${TELEGRAM_TOKEN}`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl })
      });
      const data = await res.json();
      console.log(`📡 Telegram webhook: ${data.ok ? '✅' : '❌'} ${webhookUrl}`);
    } catch (e) {
      console.error('Telegram webhook error:', e.message);
    }
  } else {
    console.log('⚠️  TELEGRAM_TOKEN no configurado');
  }
});
