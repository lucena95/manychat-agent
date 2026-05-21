const express = require('express');
const { createManyChatFlow } = require('./manychat-automation');

const TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'leadsmastery2024';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GHL_PHONE = '34663117022';

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok', service: 'ManyChat Agent + Telegram Bot' }));

app.post('/webhook/nuevo-reel', async (req, res) => {
  const { secret, keyword } = req.body;
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!keyword) return res.status(400).json({ error: 'Keyword no encontrada' });
  res.json({ status: 'processing', keyword });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
  if (TOKEN) startPolling();
  else console.log('⚠️ TELEGRAM_TOKEN no configurado');
});

// ─── Telegram helper ──────────────────────────────────────────────────────────
async function tg(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// ─── Whisper transcription ────────────────────────────────────────────────────
async function transcribeAudio(fileId) {
  // 1. Get file path from Telegram
  const fileInfo = await fetch(`https://api.telegram.org/bot${TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileInfo.json();
  const filePath = fileData.result?.file_path;
  if (!filePath) throw new Error('No se pudo obtener el archivo');

  // 2. Download the audio file
  const audioRes = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`);
  const audioBuffer = await audioRes.arrayBuffer();

  // 3. Send to Whisper
  const form = new globalThis.FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'audio.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'es');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: form
  });

  const whisperData = await whisperRes.json();
  return whisperData.text || '';
}

// ─── Extract keyword from text ────────────────────────────────────────────────
function extractKeyword(text) {
  const t = text.toLowerCase();
  // Patterns: "keyword pilates", "reel pilates", "nuevo reel pilates", "/reel pilates"
  const patterns = [
    /(?:keyword|reel|flujo)[:\s]+([a-z0-9_]+)/i,
    /(?:crea|nuevo|crear)[^a-z]*([a-z]{3,})/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return m[1].toUpperCase().replace(/\s+/g, '_');
  }
  // If single word, use it as keyword
  const words = text.trim().split(/\s+/);
  if (words.length === 1 && words[0].length > 2) return words[0].toUpperCase();
  return null;
}

// ─── Create ManyChat flow ─────────────────────────────────────────────────────
async function sendPhoto(chatId, imageBuffer, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption);
  form.append('parse_mode', 'Markdown');
  form.append('photo', new Blob([imageBuffer], { type: 'image/jpeg' }), 'screenshot.jpg');

  await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
    method: 'POST',
    body: form
  });
}

async function createReel(chatId, keyword) {
  await tg('sendMessage', { chat_id: chatId, text: `⏳ Abriendo ManyChat en la nube para *REEL\\_${keyword}*...`, parse_mode: 'Markdown' });
  try {
    const result = await createManyChatFlow(keyword);

    // Enviar screenshot como prueba
    if (result.screenshot) {
      await sendPhoto(
        chatId,
        result.screenshot,
        `✅ *REEL\\_${keyword}* creado en ManyChat\n\nURL: \`https://wa.me/${GHL_PHONE}?text=REEL\\_${keyword}\``
      );
    } else {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `✅ *REEL\\_${keyword}* listo\n\nURL: \`https://wa.me/${GHL_PHONE}?text=REEL\\_${keyword}\``,
        parse_mode: 'Markdown'
      });
    }
  } catch (e) {
    await tg('sendMessage', { chat_id: chatId, text: `❌ Error: ${e.message}` });
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const voice = msg.voice;
  const audio = msg.audio;

  console.log(`[${chatId}] ${msg.from?.first_name}: ${text || (voice ? '[AUDIO]' : '[?]')}`);

  // ── Voice / Audio message ──
  if (voice || audio) {
    if (!OPENAI_API_KEY) {
      await tg('sendMessage', { chat_id: chatId, text: '⚠️ Transcripción de audio no configurada.' });
      return;
    }
    await tg('sendMessage', { chat_id: chatId, text: '🎙️ Transcribiendo audio...' });
    try {
      const fileId = (voice || audio).file_id;
      const transcribed = await transcribeAudio(fileId);
      console.log(`[${chatId}] Transcripción: "${transcribed}"`);
      await tg('sendMessage', { chat_id: chatId, text: `📝 Escuché: "${transcribed}"` });

      const keyword = extractKeyword(transcribed);
      if (keyword) {
        await createReel(chatId, keyword);
      } else {
        await tg('sendMessage', { chat_id: chatId, text: `No detecté una keyword. Di algo como:\n"keyword PILATES" o "reel yoga"` });
      }
    } catch (e) {
      await tg('sendMessage', { chat_id: chatId, text: `❌ Error transcribiendo: ${e.message}` });
    }
    return;
  }

  // ── Text commands ──
  if (text.startsWith('/start')) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `🤖 *Agente LeadsMastery*\n\nCrea flujos de ManyChat por texto o nota de voz.\n\n*Texto:*\n• /reel PILATES\n• "keyword yoga"\n\n*Voz:*\nDi "keyword pilates" o "nuevo reel yoga"`,
      parse_mode: 'Markdown'
    });
    return;
  }

  if (text.startsWith('/status')) {
    await tg('sendMessage', { chat_id: chatId, text: `✅ Online\n🎙️ Whisper: ${OPENAI_API_KEY ? 'activo' : 'inactivo'}` });
    return;
  }

  if (text.match(/^\/reel\s+(.+)/i)) {
    const keyword = text.match(/^\/reel\s+(.+)/i)[1].trim().toUpperCase().replace(/\s+/g, '_');
    await createReel(chatId, keyword);
    return;
  }

  // Natural language text
  const keyword = extractKeyword(text);
  if (keyword) {
    await createReel(chatId, keyword);
    return;
  }

  await tg('sendMessage', {
    chat_id: chatId,
    text: `Di o escribe:\n/reel PILATES\no una nota de voz: "keyword pilates"`
  });
}

// ─── Polling loop ─────────────────────────────────────────────────────────────
async function startPolling() {
  await tg('deleteWebhook');
  console.log('🤖 Bot activo (polling) | Whisper:', OPENAI_API_KEY ? '✅' : '❌');

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
