# ⚡ Live Chat - 高質感即時語音對話系統 (Node.js & Python 雙引擎 + Docker 版)

<p align="left">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Ready" />
  <img src="https://img.shields.io/badge/Node.js-v20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Python-3.11%2B-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/FastAPI-0.111%2B-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/WebSockets-Real--time-FF6600?style=for-the-badge&logo=websocket&logoColor=white" alt="WebSockets" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License" />
</p>

基於 **Multimodal Live API** 與 **WebSockets** 的高質感即時雙向語音與文字對話網頁應用程式。提供 **Node.js** 與 **Python** 兩種獨立後端引擎實作，具備強大的 AI 角色 (Persona) 設定系統、即時語音播報、打字機動態字幕、多聲線切換、即時打斷 (Barge-in) 與現代深色玻璃擬態 UI。

🌐 **100% 跨平台與容器化支援 (Cross-Platform & Docker Ready)**：適用於 **Windows**、**macOS**、**Linux** 與 **Docker**！

---

## 🌟 主要特色

- 🎭 **動態 AI 角色設定 (Persona Prompt Modal)**：
  - 開啟網頁時跳出設定視窗，讓您隨心輸入自訂 Prompt（例如：「你是一位專業且幽默的 Python 架構師」）。
  - 提供多款預設角色快捷卡片（程式大師 💻、加勒比海盜船長 🏴‍☠️、溫暖心靈導師 🧘、傲嬌貓娘 🐱）。
  - 支援在對話過程中隨時點擊「變更角色 Prompt」切換設定。
  
  <p align="center">
    <img src="./image.png" alt="System Persona Prompt Modal" width="600" />
  </p>

- 🎙️ **低延遲雙向語音與打字機字幕**：
  - 使用最新 Multimodal Live 語音串流技術。
  - 支援 **👨 男聲 (Puck)** 與 **👩 女聲 (Aoede)** 一鍵切換。
  - 支援 **🖐️ 即時打斷 (Barge-in)**：點擊打斷按鈕、開啟麥克風或發送新訊息時，0 毫秒即時中斷語音播放。
  - **聲音字幕 100% 同步**：字幕打字機速度對齊語音播報速率，字字同步流暢。

- 🟢 / 🐍 / 🐳 **三種靈活部署與執行方式**：
  - **Docker 容器化**：提供 `docker-compose.yml`，一鍵啟動 Node.js 與 Python 雙引擎。
  - **Node.js 版本**：使用 Express + `ws` WebSocket Proxy 封裝 (Port 3000)。
  - **Python 版本**：使用 FastAPI + Uvicorn + `websockets` 非同步架構，推薦搭配 **`uv`** 執行 (Port 8000)。

- 🎨 **極致 UI/UX 視覺設計 (Midnight Cyan & Electric Blue)**：
  - 採用深深海洋藍與電光青色 (Zero Purple) 質感 Glassmorphic 介面。

---

## 🐳 Docker 快速啟動指南 (推薦 🚀)

本專案提供完全容器化的 Docker 支援，無須本機安裝 Node.js 或 Python 環境：

### 步驟 1：提供 `GEMINI_API_KEY` (選一方式)

#### 方式 A：透過根目錄的 `.env` 檔案 (最推薦 🚀)
`docker-compose.yml` 已預設設定 `env_file: - .env`，會自動讀取根目錄 `.env` 中的金鑰。
在專案根目錄下建立 `.env` 檔案（可複製 `.env.example`）：
```env
GEMINI_API_KEY=your_api_key_here
```

#### 方式 B：在執行指令時直接帶入環境變數 (免建檔)
不用建立 `.env` 檔案，在命令行中直接傳入金鑰：
- **Windows (PowerShell)**:
  ```powershell
  $env:GEMINI_API_KEY="your_api_key_here"; docker compose up -d --build
  ```
- **Windows (CMD)**:
  ```cmd
  set GEMINI_API_KEY=your_api_key_here && docker compose up -d --build
  ```
- **macOS / Linux**:
  ```bash
  GEMINI_API_KEY="your_api_key_here" docker compose up -d --build
  ```

#### 方式 C：使用 `docker run` 單獨啟動容器
若直接使用 `docker run` 指令啟動單一容器，可透過 `-e` 參數傳入：
- **Node.js 容器 (Port 3000)**:
  ```bash
  docker run -d -p 3000:3000 -e GEMINI_API_KEY="your_api_key_here" livechat-nodejs
  ```
- **Python 容器 (Port 8000)**:
  ```bash
  docker run -d -p 8000:8000 -e GEMINI_API_KEY="your_api_key_here" livechat-python
  ```

---

### 步驟 2：啟動與管理容器

#### 🚀 容器管理指令
```bash
# 構建並啟動所有容器 (Node.js & Python 服務)
docker compose up -d --build

# 查看容器即時執行日誌
docker compose logs -f

# 停止並移除容器
docker compose down
```

#### 🌐 服務訪問網址
- **🟢 Node.js 服務引擎**：[http://localhost:3000](http://localhost:3000)
- **🐍 Python 服務引擎**：[http://localhost:8000](http://localhost:8000)

---

## 💻 本機手動啟動指南 (Windows / macOS / Linux)

### 前置準備
1. 設定 `.env` 檔案中的 API Key
2. 選取您欲執行的版本：

#### 🐍 1. 執行 Python 版本（推薦使用 `uv` 🚀）
```bash
cd python-version

# 安裝依賴 (uv 超快速)
uv pip install -r requirements.txt

# 啟動伺服器
uv run main.py
```
訪問：[http://localhost:8000](http://localhost:8000)

#### 🟢 2. 執行 Node.js 版本
```bash
cd nodejs-version

# 安裝依賴
npm install

# 啟動伺服器
npm run dev
```
訪問：[http://localhost:3000](http://localhost:3000)

---

## 📁 專案目錄結構

```text
LiveChat/
├── .env                  # 環境變數設定 (含 API Key，已設定 Git 忽略)
├── .env.example          # 環境變數範例
├── .gitignore            # Git 忽略檔案清單
├── docker-compose.yml    # Docker Compose 多容器編排設定
├── README.md             # 使用者專案介紹說明
├── README_AI.md          # 本 AI 生成技術架構與部署說明文件
├── nodejs-version/       # Node.js 實作目錄
│   ├── Dockerfile        # Node.js Docker 映像檔構建檔
│   ├── package.json
│   ├── server.js
│   └── public/
└── python-version/       # Python 實作目錄
    ├── Dockerfile        # Python Docker 映像檔構建檔
    ├── requirements.txt
    ├── main.py
    └── static/
```

---

## 📄 授權條款 (License)

MIT License
