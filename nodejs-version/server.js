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
const wss = new WebSocket.Server({ server });

const PORT = process.env.NODE_PORT || process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: !!GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here',
    hasOpenAiApiKey: !!OPENAI_API_KEY && OPENAI_API_KEY !== 'your_api_key_here',
    version: '1.0.0-node'
  });
});

// The browser sends its WebRTC offer here; the project key never reaches the browser.
app.post('/api/openai/live-session', async (req, res) => {
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
  if (typeof sdp !== 'string' || !sdp.trim() || sdp.length > 65536 ||
      typeof instructions !== 'string' || !instructions.trim() || instructions.length > 4000) {
    return res.status(400).json({ error: '無效的 SDP 或角色設定。' });
  }
  if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_api_key_here') {
    return res.status(503).json({ error: '請在 .env 設定 OPENAI_API_KEY。' });
  }
  try {
    const upstream = await fetch('https://api.openai.com/v1/live/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
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
    console.error('[OpenAI Live] Session creation error:', error);
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

  // Initialize Gemini WebSocket Connection
  function connectToGeminiLive() {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
      ws.send(JSON.stringify({
        type: 'error',
        message: '未設定有效的 GEMINI_API_KEY。請在 .env 檔案中填入您的 Gemini API Key。'
      }));
      return;
    }

    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

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
        console.warn('[Live Chat] WebSocket error, falling back to HTTP stream:', err.message);
        ws.send(JSON.stringify({ type: 'status', connected: true, mode: 'REST Stream (Fallback)' }));
      });

      geminiWs.on('close', () => {
        console.log('[Live Chat] WebSocket closed');
      });

    } catch (e) {
      console.warn('[Live Chat] Exception initiating WebSocket:', e.message);
    }
  }

  // Handle client messages
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'init') {
        sessionConfig.systemInstruction = data.systemInstruction || sessionConfig.systemInstruction;
        sessionConfig.voiceName = data.voice || sessionConfig.voiceName || "Puck";
        sessionConfig.model = data.model || "gemini-3.1-flash-live-preview";
        sessionConfig.history = [];
        console.log('[Init Persona & Voice]', sessionConfig.systemInstruction, sessionConfig.voiceName);

        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.close();
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
          await streamViaRestApi(userText, ws, sessionConfig);
        }
      }
    } catch (err) {
      console.error('[Client Message Error]', err);
      ws.send(JSON.stringify({ type: 'error', message: '處理訊息時發生錯誤：' + err.message }));
    }
  });

  ws.on('close', () => {
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close();
    }
  });
});

// REST Fallback streaming helper using native fetch
async function streamViaRestApi(userText, ws, sessionConfig) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    ws.send(JSON.stringify({
      type: 'error',
      message: '未設定有效的 GEMINI_API_KEY。請在 .env 檔案中填入您的 Gemini API Key。'
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
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;
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
    console.error('[REST Fallback Stream Error]', err);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`🚀 Live Chat (Node.js) is running on port ${PORT}`);
  console.log(`🔗 Web UI: http://localhost:${PORT}`);
  console.log(`==================================================`);
});

module.exports = server;
