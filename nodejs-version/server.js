const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const dotenv = require('dotenv');

// Load .env from parent directory or current directory
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true, maxPayload: 1024 * 1024 });

let visitorQuota = null;
if (process.env.DAILY_VISITOR_LIMIT) {
  const { Firestore } = require('@google-cloud/firestore');
  const { createQuota, firestoreStore } = require('./visitor-quota');
  visitorQuota = createQuota({
    store: firestoreStore(new Firestore({ databaseId: process.env.FIRESTORE_DATABASE || '(default)' })),
    secret: process.env.VISITOR_COOKIE_SECRET,
    limit: Number(process.env.DAILY_VISITOR_LIMIT)
  });
} else if (process.env.K_SERVICE) {
  throw new Error('Cloud Run requires DAILY_VISITOR_LIMIT and VISITOR_COOKIE_SECRET');
}

function sameOrigin(req) {
  try { return new URL(req.headers.origin).host === req.headers.host; }
  catch { return false; }
}

server.on('upgrade', (req, socket, head) => {
  if (visitorQuota && (!sameOrigin(req) || !visitorQuota.permitted(req.headers.cookie))) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

const PORT = process.env.NODE_PORT || process.env.PORT || 3000;
const validApiKey = key => typeof key === 'string' && /^[\x21-\x7e]{16,512}$/.test(key) && !key.startsWith('your_');

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use((error, req, res, next) => {
  if (!error) return next();
  // Parsing failures can include body fragments; never echo or log those fragments.
  return res.status(400).json({ error: '無效的請求內容。' });
});

app.post('/api/access', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!sameOrigin(req)) return res.status(403).json({ error: '來源不符。' });
  if (!visitorQuota) return res.json({ allowed: true });
  try {
    const cookie = await visitorQuota.admit(req.headers.cookie);
    if (!cookie) return res.status(429).json({ error: '今日訪客名額已滿，請於台灣時間午夜後再試。' });
    res.set('Set-Cookie', cookie + (process.env.K_SERVICE ? '; Secure' : ''));
    return res.json({ allowed: true });
  } catch (error) {
    console.error('[Visitor quota] Admission unavailable:', error.code || error.name);
    return res.status(503).json({ error: '暫時無法確認今日名額，請稍後重試。' });
  }
});

// API health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    requiresUserApiKey: true,
    version: '1.0.0-node'
  });
});

// The user's key is used only for this request and is never stored or returned.
app.post('/api/openai/live-session', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const origin = req.get('origin');
  if (!origin) return res.status(403).json({ error: '來源不符。' });
  try {
    if (new URL(origin).host !== req.get('host')) {
      return res.status(403).json({ error: '來源不符。' });
    }
  } catch {
    return res.status(403).json({ error: '來源不符。' });
  }
  const { sdp, instructions } = req.body || {};
  if (visitorQuota && !visitorQuota.permitted(req.headers.cookie)) {
    return res.status(403).json({ error: '請重新開始對話，以確認今日訪客名額。' });
  }
  if (typeof sdp !== 'string' || !sdp.trim() || sdp.length > 65536 ||
      typeof instructions !== 'string' || !instructions.trim() || instructions.length > 4000) {
    return res.status(400).json({ error: '無效的 SDP 或角色設定。' });
  }
  const apiKey = req.get('x-api-key');
  if (!validApiKey(apiKey)) {
    return res.status(400).json({ error: '請輸入您自己的 OpenAI API Key。' });
  }
  try {
    const upstream = await fetch('https://api.openai.com/v1/live/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session: {
          model: 'gpt-live-1',
          instructions,
          delegation: {
            type: 'responses',
            responses: { model: 'gpt-5.6-terra', instructions: '協助回答需要深入推理的問題，簡潔回覆以便口語轉述。' }
          }
        },
        transport: { type: 'webrtc', sdp }
      })
    });
    if (!upstream.ok) {
      console.error('[OpenAI Live] Session creation failed:', upstream.status);
      return res.status(upstream.status).json({ error: `建立 GPT-Live 會話失敗 (${upstream.status})。` });
    }
    return res.status(201).json(await upstream.json());
  } catch (error) {
    console.error('[OpenAI Live] Session creation request failed');
    return res.status(502).json({ error: '無法連線至 OpenAI Live API。' });
  }
});

// WebSocket Connection Handling
wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected');
  let sessionConfig = {
    systemInstruction: "你是熱情好客且博學多聞的 AI 助理。",
    model: "gemini-3.1-flash-live-preview",
    voiceName: "Puck",
    history: []
  };

  let geminiWs = null;
  let apiKey = null;

  // Initialize Gemini WebSocket Connection
  function connectToGeminiLive() {
    if (!validApiKey(apiKey)) {
      ws.send(JSON.stringify({
        type: 'error',
        message: '請輸入您自己的 Gemini API Key。'
      }));
      return;
    }

    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      geminiWs = new WebSocket(geminiUrl);

      geminiWs.on('open', () => {
        console.log('[Live Chat] WebSocket opened');
        let targetModel = sessionConfig.model || 'gemini-3.1-flash-live-preview';
        let voice = sessionConfig.voiceName || 'Puck';

        // Send setup message as specified in official Live Chat API guide
        const setupMsg = {
          setup: {
            model: `models/${targetModel}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voice
                  }
                }
              }
            },
            systemInstruction: {
              parts: [{ text: sessionConfig.systemInstruction }]
            }
          }
        };
        geminiWs.send(JSON.stringify(setupMsg));
        ws.send(JSON.stringify({ type: 'status', connected: true, mode: `Live Chat (Gemini 3.1 - ${voice})` }));
      });

      geminiWs.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.serverContent) {
            const sc = response.serverContent;

            // 1. Process Audio Data from modelTurn
            if (sc.modelTurn?.parts) {
              for (const part of sc.modelTurn.parts) {
                if (part.inlineData && part.inlineData.data) {
                  ws.send(JSON.stringify({
                    type: 'audio',
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || 'audio/pcm'
                  }));
                }
                if (part.text) {
                  ws.send(JSON.stringify({ type: 'chunk', text: part.text }));
                }
              }
            }

            // 2. Process Output Transcription (AI Subtitles) as per Live API docs
            if (sc.outputTranscription && sc.outputTranscription.text) {
              ws.send(JSON.stringify({ type: 'chunk', text: sc.outputTranscription.text }));
            }

            if (sc.turnComplete) {
              ws.send(JSON.stringify({ type: 'end' }));
            }
          }
        } catch (err) {
          console.error('[Live Chat] Message parse error:', err);
        }
      });

      geminiWs.on('error', (err) => {
        console.warn('[Live Chat] WebSocket connection failed');
        ws.send(JSON.stringify({ type: 'status', connected: true, mode: 'REST Stream (Fallback)' }));
      });

      geminiWs.on('close', () => {
        console.log('[Live Chat] WebSocket closed');
      });

    } catch (e) {
      console.warn('[Live Chat] Could not initiate WebSocket');
    }
  }

  // Handle client messages
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'init') {
        if (!validApiKey(data.apiKey)) {
          ws.send(JSON.stringify({ type: 'error', message: '請輸入您自己的 Gemini API Key。' }));
          return;
        }
        apiKey = data.apiKey;
        sessionConfig.systemInstruction = data.systemInstruction || sessionConfig.systemInstruction;
        sessionConfig.voiceName = data.voice || sessionConfig.voiceName || "Puck";
        sessionConfig.model = data.model || "gemini-3.1-flash-live-preview";
        sessionConfig.history = [];
        if (geminiWs) {
          geminiWs.terminate();
        }
        connectToGeminiLive();
        ws.send(JSON.stringify({ type: 'init_success', systemInstruction: sessionConfig.systemInstruction }));
      } else if (data.type === 'audio') {
        // Real-time audio stream chunk from client mic (16kHz PCM Base64)
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(JSON.stringify({
            realtimeInput: {
              audio: {
                mimeType: "audio/pcm",
                data: data.data
              }
            }
          }));
        }
      } else if (data.type === 'message') {
        const userText = data.text;
        sessionConfig.history.push({ role: 'user', parts: [{ text: userText }] });

        // If Live WebSocket is active and open
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          const clientMsg = {
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [{ text: userText }]
                }
              ],
              turnComplete: true
            }
          };
          geminiWs.send(JSON.stringify(clientMsg));
        } else {
          // Stream via Gemini HTTP SSE API as robust fallback
          await streamViaRestApi(userText, ws, sessionConfig, apiKey);
        }
      }
    } catch (err) {
      console.error('[Client Message Error] Invalid message');
      ws.send(JSON.stringify({ type: 'error', message: '處理訊息時發生錯誤。' }));
    }
  });

  ws.on('close', () => {
    apiKey = null;
    if (geminiWs) geminiWs.terminate();
  });
});

// REST Fallback streaming helper using native fetch
async function streamViaRestApi(userText, ws, sessionConfig, apiKey) {
  if (!validApiKey(apiKey)) {
    ws.send(JSON.stringify({
      type: 'error',
      message: '請輸入您自己的 Gemini API Key。'
    }));
    return;
  }

  let model = sessionConfig.model || 'gemini-2.0-flash';
  if (!model || model.includes('3.1') || model.includes('exp')) {
    model = 'gemini-2.0-flash';
  }

  const payload = {
    system_instruction: {
      parts: [{ text: sessionConfig.systemInstruction }]
    },
    contents: sessionConfig.history
  };

  const candidateModels = [model, 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  let response = null;

  try {
    for (const m of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          response = res;
          break;
        }
      } catch (e) { }
    }

    if (!response) {
      ws.send(JSON.stringify({
        type: 'error',
        message: '無法連線至 Gemini API，請檢查 API Key 是否有效。'
      }));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullResponseText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep partial line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.replace('data: ', '').trim();
          if (!jsonStr) continue;
          try {
            const data = JSON.parse(jsonStr);
            const candidates = data.candidates || [];
            for (const cand of candidates) {
              const parts = cand.content?.parts || [];
              for (const part of parts) {
                if (part.text) {
                  fullResponseText += part.text;
                  ws.send(JSON.stringify({ type: 'chunk', text: part.text }));
                }
              }
            }
          } catch (e) {
            // ignore JSON chunk parse error
          }
        }
      }
    }

    // Record model response in history
    sessionConfig.history.push({ role: 'model', parts: [{ text: fullResponseText }] });
    ws.send(JSON.stringify({ type: 'end' }));

  } catch (err) {
    console.error('[REST Fallback Stream Error] Request failed');
    ws.send(JSON.stringify({ type: 'error', message: '連線至模型服務失敗，請稍後重試。' }));
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`🚀 Live Chat (Node.js) is running on port ${PORT}`);
  console.log(`🔗 Web UI: http://localhost:${PORT}`);
  console.log(`==================================================`);
});

module.exports = server;
