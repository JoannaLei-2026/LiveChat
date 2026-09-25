# Live Chat

Live Chat 是一個可選擇 Gemini Live 或 OpenAI GPT-Live 的即時語音對話展示網頁。這個儲存庫提供原始碼，供使用者在自己的電腦上啟動並使用自己的 API 金鑰；它不是已部署、免設定即可使用的線上服務。使用者先選擇服務與 AI 角色提示詞，再開啟麥克風與 AI 對話；畫面會顯示對話字幕，並播放模型回傳的語音。專案提供功能相近、彼此獨立的 Node.js 與 Python 後端，方便比較兩種實作。

## 目前可用的操作

- 在開始對話前選擇預設角色，或輸入自訂角色提示詞；對話中也可重新設定。
- 開啟麥克風對話、觀看雙方字幕，並切換語音播放或靜音。
- Gemini 模式可切換 Puck／Aoede 聲線，並停止瀏覽器正在播放的模型音訊；OpenAI 模式可靜音輸出，但沒有聲線切換與中途打斷按鈕。
- Gemini 模式在瀏覽器支援 SpeechRecognition 時顯示使用者辨識文字；OpenAI 模式的雙方字幕來自 GPT-Live 資料通道。

目前頁面以麥克風操作為主，**沒有文字輸入框**。Gemini 後端支援文字訊息，但介面沒有手動發送入口。字幕、麥克風與播放能力會受瀏覽器支援和權限影響；麥克風通常需在 `localhost` 或 HTTPS 環境使用。

## 快速啟動：Docker Compose

需要 Docker Compose 和所選服務的 API 金鑰。從 GitHub 取得本儲存庫後，在專案根目錄複製 `.env.example` 為 `.env`，填入 `GEMINI_API_KEY` 或 `OPENAI_API_KEY`（可同時設定），再執行：

```bash
docker compose up --build
```

兩個獨立版本會同時啟動：

| 版本 | 網址 | 後端 |
| --- | --- | --- |
| Node.js | http://localhost:3000 | Express、ws |
| Python | http://localhost:8000 | FastAPI、websockets |

開啟其中一個網址，選擇服務與角色，再點擊麥克風並允許瀏覽器使用麥克風。Gemini 在確認角色時建立後端 WebSocket 連線；OpenAI 在點擊麥克風時建立計費會話，再次點擊會結束。服務狀態可查看 `/api/health`，其中 `hasApiKey` 與 `hasOpenAiApiKey` 只表示後端是否讀到相應金鑰，**不代表 API 連線已成功**。結束時執行 `docker compose down`。

Compose 使用根目錄 `.env` 為 `${GEMINI_API_KEY}`、`${OPENAI_API_KEY}`、`${NODE_PORT}`、`${PYTHON_PORT}` 提供變數；不需 `env_file` 設定。`.env` 已列入 Git 忽略清單，請勿提交金鑰。

## 本機啟動單一版本

先在專案根目錄建立 `.env`，填入所選服務的 `GEMINI_API_KEY` 或 `OPENAI_API_KEY`。Node.js 版本需要 Node.js 20 以上：

```bash
cd nodejs-version
npm ci
npm start
```

Python 版本需要 Python 3.11 以上；在 `python-version` 目錄安裝 `requirements.txt` 後執行：

```bash
cd python-version
python -m pip install -r requirements.txt
python main.py
```

本機預設埠號分別為 3000 與 8000。Node.js 可用 `NODE_PORT` 調整；Python 可用 `PORT` 或 `PYTHON_PORT` 調整。若以 Docker Compose 啟動，使用根目錄 `.env` 的 `NODE_PORT` 與 `PYTHON_PORT` 調整主機對外埠號。

## 運作方式與限制

Gemini 模式透過本機 WebSocket 將麥克風音訊傳給後端，再由後端連接 Gemini Live，將模型音訊與字幕傳回瀏覽器。OpenAI 模式由瀏覽器透過 WebRTC 傳送麥克風音訊並接收語音；後端只負責用 `OPENAI_API_KEY` 建立會話，金鑰不傳到瀏覽器。OpenAI 的資料通道提供雙方字幕；再次點擊麥克風會送出結束會話指令。Gemini 的文字 REST 備援只處理文字，不能接手語音。

OpenAI 模式需要有 GPT-Live 使用權限的 OpenAI API 專案金鑰；程式固定使用 `gpt-live-1` 語音模型與 `gpt-5.6-terra` Responses 委派模型。麥克風須在 HTTPS 或 localhost 使用。GPT-Live 依會話時長計費，Responses 委派另計費。此展示專案的會話建立端點沒有使用者登入或用量限制；若對外公開，請先加上驗證、限流與 HTTPS。參考 [GPT-Live 入門](https://developers.openai.com/api/docs/guides/live) 與 [WebRTC 連線](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)。
