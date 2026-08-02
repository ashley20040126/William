# William Algorithm

`william_algorithm/` 是 William 后端依赖的算法侧目录，当前实际接入的是两个服务：

- `rag/`
  - 数字专家 RAG 服务
  - 默认由 `Development/backend` 自动拉起到 `http://127.0.0.1:8010`
- `voice/`
  - 语音转写与音频分析服务
  - 默认由 `Development/backend` 自动拉起到 `http://127.0.0.1:8020`

这份文档的目标不是介绍概念，而是保证你在本机启动 `Development/backend` 时，`rag` 和 `voice` 都能正常工作。

## 目录结构

```text
william_algorithm/
├── rag/
│   ├── rag_service.py
│   ├── rag.py
│   ├── requirements.txt
│   └── .venv/                 # 建议独立虚拟环境
├── voice/
│   ├── voice_service.py
│   ├── run_pipeline.py
│   ├── pyproject.toml
│   ├── uv.lock
│   └── .venv/                 # uv 管理的独立虚拟环境
└── README.md
```

## 运行原则

- `rag` 和 `voice` 必须使用各自独立的 Python 环境
- 不要让 `rag/.venv` 和 `voice/.venv` 混用
- 启动 `Development/backend` 时，后端会尝试自动拉起这两个服务
- 即使你当前 shell prompt 显示 `(voice)` 或 `(.venv)`，后端现在也会尽量避免把外层 `VIRTUAL_ENV` 串进子服务，但你仍然应该按下面的方式单独初始化两个目录

## 先决条件

本机需要这些基础依赖：

```bash
python3 --version
node --version
npm --version
uv --version
ffmpeg -version
```

如果 `uv` 或 `ffmpeg` 缺失：

```bash
brew install uv
brew install ffmpeg
```

## 一次性初始化

### 1. 初始化 RAG

RAG 当前使用 `requirements.txt`，建议单独建虚拟环境：

```bash
cd william_algorithm/rag
python3 -m venv .venv
.venv/bin/python3 -m ensurepip --upgrade
.venv/bin/python3 -m pip install -r requirements.txt
```

可选验证：

```bash
.venv/bin/python3 -c "import uvicorn, langchain_openai; print('rag ok')"
```

如果这里失败，后端自动启动时也一定会失败。

### 2. 初始化 Voice

Voice 使用 `uv` 管理依赖：

```bash
cd william_algorithm/voice
cp .env.example .env
uv sync
```

可选验证：

```bash
uv run python -c "import uvicorn, faster_whisper; print('voice ok')"
```

## 后端依赖的环境变量

后端配置文件是 [`Development/backend/.env`](../Development/backend/.env)。

至少确认这些项存在：

```env
RAG_SERVICE_URL=http://127.0.0.1:8010
RAG_SERVICE_AUTOSTART=true
RAG_SERVICE_WARMUP_ON_BOOT=true
RAG_SERVICE_HOST=127.0.0.1
RAG_SERVICE_PORT=8010
RAG_SERVICE_APP=rag_service:app
RAG_SERVICE_PYTHON=

VOICE_SERVICE_URL=http://127.0.0.1:8020
VOICE_SERVICE_AUTOSTART=true
VOICE_SERVICE_WARMUP_ON_BOOT=false
VOICE_SERVICE_HOST=127.0.0.1
VOICE_SERVICE_PORT=8020
VOICE_SERVICE_APP=voice_service:app
VOICE_SERVICE_PYTHON=
VOICE_SERVICE_STARTUP_TIMEOUT_MS=120000
```

说明：

- `RAG_SERVICE_PYTHON` 留空时，后端默认优先找 `william_algorithm/rag/.venv/bin/python3`
- `VOICE_SERVICE_PYTHON` 留空时，后端默认在 `voice/` 目录下执行 `uv run python -m uvicorn ...`
- `VOICE_SERVICE_STARTUP_TIMEOUT_MS`
  - 建议至少 `120000`
  - 首次启动 voice 时可能要下载或初始化模型，`30000` 经常不够

## 推荐启动方式

### 方式 A：完全交给后端自动拉起

这是当前推荐方式。

```bash
cd Development/backend
npm run dev
```

正常日志应接近：

```text
[William] Server running on port 3001
[DB] MySQL connected
[RAG Service] ... Uvicorn running on http://127.0.0.1:8010
[Voice Service] ...
```

如果一切正常：

- RAG 健康检查：`GET http://127.0.0.1:8010/health`
- Voice 健康检查：`GET http://127.0.0.1:8020/health`

### 方式 B：手动先启动 RAG 和 Voice，再启动后端

适合排查问题。

RAG：

```bash
cd william_algorithm/rag
.venv/bin/python3 -m uvicorn rag_service:app --host 127.0.0.1 --port 8010
```

Voice：

```bash
cd william_algorithm/voice
uv run python -m uvicorn voice_service:app --host 127.0.0.1 --port 8020
```

然后再启动后端：

```bash
cd Development/backend
npm run dev
```

如果你采用手动方式，建议把 `.env` 里的这两项保留为 `true` 也没关系，因为后端会先检查健康状态，服务已在线时不会重复拉起。

## 手动验证

### 验证 RAG

```bash
curl http://127.0.0.1:8010/health
```

如果要验证查询接口，可在后端启动后直接走后端链路，或者自己发 `POST /query`。

### 验证 Voice

```bash
curl http://127.0.0.1:8020/health
```

Voice 依赖 `ffmpeg` 做音频解码。如果 `ffmpeg` 不在 PATH，上游会返回明确错误。

## 常见问题

### 1. `ModuleNotFoundError: No module named 'langchain_openai'`

说明 `rag/.venv` 没装完整，重新安装：

```bash
cd william_algorithm/rag
.venv/bin/python3 -m ensurepip --upgrade
.venv/bin/python3 -m pip install -r requirements.txt
```

### 2. `No module named uvicorn`

如果出现在 voice：

```bash
cd william_algorithm/voice
uv sync
```

如果出现在 rag：

```bash
cd william_algorithm/rag
.venv/bin/python3 -m pip install -r requirements.txt
```

### 3. `ffmpeg is not installed or not on PATH`

安装：

```bash
brew install ffmpeg
```

### 4. `Timed out waiting for voice service at http://127.0.0.1:8020`

通常是以下原因之一：

- 第一次启动 voice，模型初始化太慢
- `ffmpeg` 缺失
- voice 依赖没同步

先执行：

```bash
cd william_algorithm/voice
uv sync
```

然后把后端 `.env` 中的：

```env
VOICE_SERVICE_STARTUP_TIMEOUT_MS=120000
```

### 5. `address already in use`

说明端口已被占用，通常是你已经手动起过服务：

- RAG 默认占用 `8010`
- Voice 默认占用 `8020`
- Backend 默认占用 `3001`

先关闭旧进程，再重启。

### 6. shell prompt 显示 `(voice)`、`(.venv)`、`(base)` 会不会有影响

现在后端启动器已经尽量隔离子进程环境，不会再轻易把外层虚拟环境串进 `rag` 或 `voice`。

但从工程习惯上，仍然建议：

- 初始化 `rag` 时只在 `rag/` 下操作 `.venv`
- 初始化 `voice` 时只在 `voice/` 下执行 `uv sync`
- 启动后端时，最好不要依赖“当前 shell 激活了哪个环境”来决定服务是否能跑

## `run_pipeline.py` 的正确用法

下面这种写法是错的：

```bash
uv run python run_pipeline.py <音频>
```

`<音频>` 只是占位符，不是可直接输入的命令。

正确示例：

```bash
cd william_algorithm/voice
uv run python run_pipeline.py ./sample.wav
```

如果你要跑“无 ASR”模式：

```bash
uv run python run_pipeline.py ./sample.wav --no-asr
```

注意：`run_pipeline.py` 走的是完整分析链路，和后端调用的 `/transcribe`、`/analyze` 不是同一条最短路径。排查后端问题时，优先看 `voice_service.py` 是否能正常启动。

## 当前推荐的最短启动流程

第一次配置：

```bash
cd william_algorithm/rag
python3 -m venv .venv
.venv/bin/python3 -m ensurepip --upgrade
.venv/bin/python3 -m pip install -r requirements.txt

cd william_algorithm/voice
cp .env.example .env
uv sync

cd Development/backend
npm run dev
```

之后日常启动通常只需要：

```bash
cd Development/backend
npm run dev
```

## 相关文档

- Voice 详细说明：[voice/README.md](voice/README.md)
- RAG 说明：[rag/README](rag/README)
