# Algorithm 服务部署清单

这份清单只针对：

- `william_algorithm/rag`
- `william_algorithm/voice`

目标是让服务器上这两项部署过程可重复，不再靠手工猜环境。

## 1. 先装系统依赖

```bash
sudo apt update
sudo apt install -y python3 python3-venv build-essential ffmpeg libmagic1 poppler-utils tesseract-ocr
```

## 2. 安装 uv

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
uv --version
```

## 3. 安装 RAG

```bash
cd /srv/william/william_algorithm/rag
cp .env.example .env
uv sync
```

如果要启用 `CohereRerank`：

```bash
cd /srv/william/william_algorithm/rag
uv sync --extra rerank
```

## 4. 安装 Voice

```bash
cd /srv/william/william_algorithm/voice
cp .env.example .env
uv sync
```

## 5. 本地手动启动验证

RAG：

```bash
cd /srv/william/william_algorithm/rag
.venv/bin/python3 -m uvicorn rag_service:app --host 127.0.0.1 --port 8010
```

Voice：

```bash
cd /srv/william/william_algorithm/voice
.venv/bin/python3 -m uvicorn voice_service:app --host 127.0.0.1 --port 8020
```

## 6. 健康检查

```bash
curl http://127.0.0.1:8010/health
curl http://127.0.0.1:8020/health
```

## 7. 安装 systemd 服务

```bash
sudo cp /srv/william/Development/deploy/systemd/william-rag.service /etc/systemd/system/
sudo cp /srv/william/Development/deploy/systemd/william-voice.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now william-rag william-voice
```

## 8. 查看运行状态

```bash
sudo systemctl status william-rag
sudo systemctl status william-voice
sudo journalctl -u william-rag -n 100 --no-pager
sudo journalctl -u william-voice -n 100 --no-pager
```

## 9. 最容易卡住的点

- `ffmpeg` 没装：voice 无法转写或分析
- 首次模型下载失败：服务器无外网或代理没配
- `OPENAI_API_KEY` 没配：RAG 和部分 voice 增强链路会失败
- `unstructured` 文档解析链缺系统组件：PDF/DOCX/PPTX 解析失败
- `uv sync` 没跑在正确目录：`.venv` 不完整
