import os
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
import httpx
import websockets

# Load environment variables
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
PORT = int(os.getenv("PORT", os.getenv("PYTHON_PORT", "8000")))

app = FastAPI(title="Live Chat")

# Serve static files
static_dir = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/")
async def get_index():
    index_file = static_dir / "index.html"
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>Python Live Chat Backend Ready</h1>")


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "hasApiKey": bool(GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here"),
        "version": "1.0.0-python"
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("[Python WS] Client connected")

    session_config = {
        "systemInstruction": "你是熱情好客且博學多聞的 AI 助理。",
        "model": "gemini-3.1-flash-live-preview",
        "voiceName": "Puck",
        "history": []
    }

    gemini_ws = None
    listen_task = None

    async def listen_to_gemini(g_ws, client_ws):
        try:
            async for raw_msg in g_ws:
                try:
                    res = json.loads(raw_msg)
                    server_content = res.get("serverContent")
                    if server_content:
                        # 1. Process Audio & Text parts from modelTurn
                        model_turn = server_content.get("modelTurn", {})
                        parts = model_turn.get("parts", [])
                        for part in parts:
                            inline_data = part.get("inlineData")
                            if inline_data and inline_data.get("data"):
                                await client_ws.send_json({
                                    "type": "audio",
                                    "data": inline_data["data"],
                                    "mimeType": inline_data.get("mimeType", "audio/pcm")
                                })
                            text = part.get("text")
                            if text:
                                await client_ws.send_json({
                                    "type": "chunk",
                                    "text": text
                                })
                        
                        # 2. Process Output Transcription (AI Subtitles) as specified in official docs
                        output_transcription = server_content.get("outputTranscription", {})
                        out_text = output_transcription.get("text")
                        if out_text:
                            await client_ws.send_json({
                                "type": "chunk",
                                "text": out_text
                            })

                        if server_content.get("turnComplete"):
                            await client_ws.send_json({"type": "end"})
                except Exception as ex:
                    print(f"[Gemini Listen Error] {ex}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[Gemini Loop Closed] {e}")

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
                msg_type = data.get("type")

                if msg_type == "init":
                    session_config["systemInstruction"] = data.get("systemInstruction", session_config["systemInstruction"])
                    session_config["voiceName"] = data.get("voice", session_config.get("voiceName", "Puck"))
                    session_config["model"] = data.get("model", "gemini-3.1-flash-live-preview")
                    print(f"[Python Init Persona & Voice] {session_config['systemInstruction']}, Voice: {session_config['voiceName']}")

                    if gemini_ws:
                        await gemini_ws.close()
                    if listen_task:
                        listen_task.cancel()

                    if GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here":
                        g_url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={GEMINI_API_KEY}"
                        try:
                            target_model = session_config.get("model", "gemini-3.1-flash-live-preview")
                            voice_name = session_config.get("voiceName", "Puck")

                            gemini_ws = await websockets.connect(g_url)
                            setup_payload = {
                                "setup": {
                                    "model": f"models/{target_model}",
                                    "generationConfig": {
                                        "responseModalities": ["AUDIO"],
                                        "speechConfig": {
                                            "voiceConfig": {
                                                "prebuiltVoiceConfig": {
                                                    "voiceName": voice_name
                                                }
                                            }
                                        }
                                    },
                                    "systemInstruction": {
                                        "parts": [{"text": session_config["systemInstruction"]}]
                                    }
                                }
                            }
                            await gemini_ws.send(json.dumps(setup_payload))
                            listen_task = asyncio.create_task(listen_to_gemini(gemini_ws, websocket))

                            await websocket.send_json({
                                "type": "init_success",
                                "systemInstruction": session_config["systemInstruction"]
                            })
                            await websocket.send_json({
                                "type": "status",
                                "connected": True,
                                "mode": "Live Chat (Gemini 3.1 Live Preview)"
                            })
                        except Exception as conn_err:
                            print(f"[Gemini WS Connect Error] {conn_err}")
                            await websocket.send_json({
                                "type": "status",
                                "connected": True,
                                "mode": "REST Stream (Fallback)"
                            })
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": "未設定有效的 GEMINI_API_KEY。請在 .env 檔案中填入您的 Gemini API Key。"
                        })

                elif msg_type == "audio":
                    # Proxy 16kHz PCM audio chunk to Live Chat WebSocket
                    audio_b64 = data.get("data")
                    if gemini_ws and audio_b64:
                        audio_msg = {
                            "realtimeInput": {
                                "audio": {
                                    "mimeType": "audio/pcm",
                                    "data": audio_b64
                                }
                            }
                        }
                        await gemini_ws.send(json.dumps(audio_msg))

                elif msg_type == "message":
                    user_text = data.get("text", "")
                    if user_text:
                        if gemini_ws:
                            text_msg = {
                                "clientContent": {
                                    "turns": [
                                        {
                                            "role": "user",
                                            "parts": [{"text": user_text}]
                                        }
                                    ],
                                    "turnComplete": True
                                }
                            }
                            await gemini_ws.send(json.dumps(text_msg))
                        else:
                            await stream_gemini_response(user_text, websocket, session_config)

            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "無效的 JSON 格式"})
            except Exception as e:
                print(f"[Python WS Error] {e}")
                await websocket.send_json({"type": "error", "message": str(e)})

    except WebSocketDisconnect:
        print("[Python WS] Client disconnected")
    finally:
        if listen_task:
            listen_task.cancel()
        if gemini_ws:
            await gemini_ws.close()


async def stream_gemini_response(user_text: str, websocket: WebSocket, session_config: dict):
    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here":
        await websocket.send_json({
            "type": "error",
            "message": "未設定有效的 GEMINI_API_KEY。請在 .env 檔案中填入您的 Gemini API Key。"
        })
        return

    candidate_models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
    payload = {
        "system_instruction": {
            "parts": [{"text": session_config["systemInstruction"]}]
        },
        "contents": session_config["history"]
    }

    full_ai_response = ""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            success = False
            for model in candidate_models:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={GEMINI_API_KEY}"
                try:
                    async with client.stream("POST", url, json=payload) as response:
                        if response.status_code == 200:
                            success = True
                            async for line in response.aiter_lines():
                                if line.startswith("data: "):
                                    json_str = line[6:].strip()
                                    if not json_str:
                                        continue
                                    try:
                                        chunk_data = json.loads(json_str)
                                        candidates = chunk_data.get("candidates", [])
                                        for cand in candidates:
                                            parts = cand.get("content", {}).get("parts", [])
                                            for part in parts:
                                                text_chunk = part.get("text", "")
                                                if text_chunk:
                                                    full_ai_response += text_chunk
                                                    await websocket.send_json({
                                                        "type": "chunk",
                                                        "text": text_chunk
                                                    })
                                    except json.JSONDecodeError:
                                        pass
                            break
                except Exception as stream_err:
                    print(f"[Model {model} failed]: {stream_err}")

            if not success:
                raise Exception("Gemini API 多模型串流連線失敗，請檢查 API Key 是否有效。")

        # Save AI turn in history
        session_config["history"].append({
            "role": "model",
            "parts": [{"text": full_ai_response}]
        })
        await websocket.send_json({"type": "end"})

    except Exception as e:
        print(f"[Stream Exception] {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"串流生成失敗: {str(e)}"
        })


if __name__ == "__main__":
    import uvicorn
    print(f"==================================================")
    print(f"🚀 Live Chat (Python) is running on port {PORT}")
    print(f"🔗 Web UI: http://localhost:{PORT}")
    print(f"==================================================")
    uvicorn.run("main:app", host="0.0.0.0", port=PORT)
