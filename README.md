# Live Chat

Live Chat 是一個可選擇 Gemini Live 或 OpenAI GPT-Live 的即時語音對話展示網頁。使用者可透過線上展示網頁測試，也可取得本儲存庫的原始碼，在自己的電腦上啟動；兩種方式都需要使用自己的 API 金鑰。使用者先選擇服務與 AI 角色提示詞，再開啟麥克風與 AI 對話；畫面會顯示對話字幕，並播放模型回傳的語音。專案提供功能相近、彼此獨立的 Node.js 與 Python 後端，方便比較兩種實作。

## 線上體驗

前往 [Live Chat 線上測試網頁](https://livechat-692593511264.asia-east1.run.app)，即可體驗 Node.js 版，無需在本機安裝。

請準備自己的 Gemini 或 OpenAI API Key，在網頁選擇服務、輸入金鑰並設定角色，再允許麥克風存取以開始語音對話。模型使用費用由你的 API 帳戶負擔。

## Node.js 公開部署與金鑰

Node.js 版使用訪客自己的 API Key：在角色設定視窗輸入 Gemini 或 OpenAI 金鑰，確認後分別儲存在此網站的瀏覽器 `localStorage`，下次自動帶入；可用「清除此服務已儲存的金鑰」移除。金鑰會經後端轉送給所選模型服務，伺服器不持久儲存，也不使用部署者的模型金鑰。共用電腦使用後請清除。Python 版仍沿用下方 `.env` 設定。

Node.js 可設定每日 500 位瀏覽器訪客的名額控制，台灣時間午夜換日。沒有另設應用層對話時間上限；名額不代表真實人數或費用上限。

## 目前可用的操作

- 在開始對話前選擇預設角色，或輸入自訂角色提示詞；對話中也可重新設定。
- 開啟麥克風對話、觀看雙方字幕，並切換語音播放或靜音。
- Gemini 模式可切換 Puck／Aoede 聲線，並停止瀏覽器正在播放的模型音訊；OpenAI 模式可靜音輸出，但沒有聲線切換與中途打斷按鈕。
- Gemini 模式在瀏覽器支援 SpeechRecognition 時顯示使用者辨識文字；OpenAI 模式的雙方字幕來自 GPT-Live 資料通道。

目前頁面以麥克風操作為主，**沒有文字輸入框**。Gemini 後端支援文字訊息，但介面沒有手動發送入口。字幕、麥克風與播放能力會受瀏覽器支援和權限影響；麥克風通常需在 `localhost` 或 HTTPS 環境使用。

## 快速啟動：Docker Compose

需要 Docker Compose 和所選服務的 API 金鑰。Python 版須在專案根目錄複製 `.env.example` 為 `.env`，填入 `GEMINI_API_KEY` 或 `OPENAI_API_KEY`；Node.js 版則在網頁輸入金鑰。執行：

```bash
docker compose up --build
```

兩個獨立版本會同時啟動：

| 版本 | 網址 | 後端 |
| --- | --- | --- |
| Node.js | http://localhost:3000 | Express、ws |
| Python | http://localhost:8000 | FastAPI、websockets |

開啟其中一個網址，選擇服務與角色（Node.js 另需輸入自己的金鑰），再點擊麥克風並允許瀏覽器使用麥克風。Gemini 在確認角色時建立後端 WebSocket 連線；OpenAI 在點擊麥克風時建立計費會話，再次點擊會結束。服務狀態可查看 `/api/health`；Node.js 回傳 `requiresUserApiKey: true`，Python 的 `hasApiKey` 與 `hasOpenAiApiKey` 只表示是否讀到金鑰，**不代表 API 連線已成功**。結束時執行 `docker compose down`。

Compose 使用根目錄 `.env` 為 `${GEMINI_API_KEY}`、`${OPENAI_API_KEY}`、`${NODE_PORT}`、`${PYTHON_PORT}` 提供變數；不需 `env_file` 設定。`.env` 已列入 Git 忽略清單，請勿提交金鑰。

## 本機啟動單一版本

Node.js 不需要伺服器模型金鑰，啟動後在網頁輸入即可。Node.js 版本需要 Node.js 20 以上：

```bash
cd nodejs-version
npm ci
npm start
```

Python 版本先在專案根目錄 `.env` 填入 `GEMINI_API_KEY` 或 `OPENAI_API_KEY`，並使用 Python 3.11 以上；在 `python-version` 目錄安裝 `requirements.txt` 後執行：

```bash
cd python-version
python -m pip install -r requirements.txt
python main.py
```

本機預設埠號分別為 3000 與 8000。Node.js 可用 `NODE_PORT` 調整；Python 可用 `PORT` 或 `PYTHON_PORT` 調整。若以 Docker Compose 啟動，使用根目錄 `.env` 的 `NODE_PORT` 與 `PYTHON_PORT` 調整主機對外埠號。

## 運作方式與限制

Gemini 模式透過 WebSocket 將麥克風音訊傳給後端，再由後端連接 Gemini Live，將模型音訊與字幕傳回瀏覽器。OpenAI 模式由瀏覽器透過 WebRTC 傳送麥克風音訊並接收語音；後端負責使用金鑰建立會話。Node.js 使用瀏覽器提供的訪客金鑰；Python 使用伺服器環境變數。OpenAI 的資料通道提供雙方字幕；再次點擊麥克風會送出結束會話指令。Gemini 的文字 REST 備援只處理文字，不能接手語音。

OpenAI 模式需要有 GPT-Live 使用權限的 OpenAI API 專案金鑰；程式固定使用 `gpt-live-1` 語音模型與 `gpt-5.6-terra` Responses 委派模型。麥克風須在 HTTPS 或 localhost 使用。GPT-Live 依會話時長計費，Responses 委派另計費。Node.js 公開部署採 BYOK 與每日瀏覽器名額限制，沒有登入或個人用量上限；Python 仍沒有訪客限制。參考 [GPT-Live 入門](https://developers.openai.com/api/docs/guides/live) 與 [WebRTC 連線](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)。


## 授權

本專案採用 GNU General Public License v3.0（GPL-3.0-only），僅適用第 3 版。完整條款請見 [LICENSE](LICENSE)。

允許使用、修改與商用；散布本專案或受 GPL 涵蓋的修改版本時，須遵守 GPL-3.0，包括依條款提供對應原始碼，並以相同授權散布受涵蓋的作品。

第三方相依套件仍依各自的授權條款提供。
