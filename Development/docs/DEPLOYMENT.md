# 生产部署指南

这份文档针对当前仓库的真实结构：

- `Development/frontend`: React + Vite 静态站点
- `Development/backend`: Node.js + Express API
- `william_algorithm/rag`: FastAPI RAG 服务
- `william_algorithm/voice`: FastAPI 语音服务

目标不是“理论上能部署”，而是给出一条适合当前项目、能上线为公共网站的方案。

## 推荐方案

当前项目最稳妥的上线方式是：

1. 用一台 Ubuntu 云服务器作为应用节点
2. 用 `Nginx` 对外提供 `HTTPS`
3. 用 `PM2` 常驻 `backend`
4. 用 `systemd` 常驻 `rag` 和 `voice`
5. 用 `MySQL 8` 作为主数据库
6. 前端构建成静态文件，由 `Nginx` 直接托管
7. 公网只暴露 `443/80`，`3001/8010/8020/3306` 全部只在内网或本机监听

这是当前代码最匹配的生产形态。不要先把它拆成 `Vercel + Railway + 第三方 Python worker`，那会把 `RAG/Voice/Node/MySQL` 的依赖关系拆碎，运维复杂度反而更高。

## 生产拓扑

```text
Browser / Mobile WebView
        ↓
   https://app.yourdomain.com
        ↓
     Nginx :443
        ├─ /            -> frontend/dist
        └─ /api/*       -> backend :3001
                            ├─ MySQL 8
                            ├─ OpenAI API
                            ├─ Gemini Image API
                            ├─ RAG FastAPI :8010
                            └─ Voice FastAPI :8020
```

建议域名：

- `app.yourdomain.com`: 前端和 API 同域
- 如果以后拆服务，再新增 `api.yourdomain.com`

当前阶段建议同域部署。这样：

- 前端 `VITE_API_BASE` 可以留空
- CORS 更简单
- WebView 集成更省事
- 登录态和 API 调用更稳定

## 上线前必须先做的事

### 1. 立即轮换所有敏感密钥

你当前仓库/本机环境里已经出现过真实格式的密钥和数据库密码。上线前必须重新生成并替换：

- `OPENAI_API_KEY`
- `GEMINI_IMAGE_API_KEY`
- `JWT_SECRET`
- `DB_PASS`
- 任何代理账号或第三方服务凭证

不要把生产 `.env` 提交到 git。

### 2. 确认生产功能边界

建议第一版公网网站只开放：

- 登录 / 注册
- Today / Chat / Journal / Paths / You
- 语音转写与语音通话
- RAG / Digital Expert

建议先不开：

- 开发调试能力
- 未完成的内部实验入口

当前 debug 路由在生产环境会受 `DEBUG_MEMORY_API_ENABLED=false` 保护，但仍建议保持关闭。

## 服务器规格

### MVP 规格

- 2 vCPU
- 4 GB RAM
- 60 GB SSD
- Ubuntu 22.04 LTS

### 如果语音和 RAG 使用频繁

- 4 vCPU
- 8 GB RAM

原因：

- Node + MySQL + Nginx 本身不重
- `voice` 和 `rag` 的 Python 进程才是主要内存消耗
- `ffmpeg`、转写、图像生成调用会拉高峰值

## 目录布局

推荐部署目录：

```text
/srv/william/
├── Development/
│   ├── frontend/
│   └── backend/
├── william_algorithm/
│   ├── rag/
│   └── voice/
└── logs/
```

这样和仓库结构一致，排障最省事。

## DNS 与证书

### DNS

在域名提供商处添加：

- `A` 记录：`app` -> 你的服务器公网 IP

### HTTPS

使用 `Let's Encrypt`：

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

## 机器初始化

```bash
sudo apt update
sudo apt install -y nginx mysql-server git curl build-essential ffmpeg python3 python3-venv python3-pip
```

安装 Node.js 20：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

安装 `uv`：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
```

校验：

```bash
node -v
npm -v
pm2 -v
python3 --version
uv --version
ffmpeg -version
```

## 拉代码

```bash
sudo mkdir -p /srv
sudo chown -R $USER:$USER /srv
cd /srv
git clone <your-repo-url> william
cd /srv/william
```

## 数据库初始化

```bash
sudo mysql
```

```sql
CREATE DATABASE william_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'william'@'127.0.0.1' IDENTIFIED BY '<strong-password>';
GRANT ALL PRIVILEGES ON william_app.* TO 'william'@'127.0.0.1';
FLUSH PRIVILEGES;
```

然后初始化表：

```bash
cd /srv/william/Development/backend
npm install
node sql/init.js
```

如果你要预置演示账号：

```bash
npm run db:seed:full-demo
```

## 后端生产环境变量

在 `/srv/william/Development/backend/.env` 中配置：

```env
PORT=3001
NODE_ENV=production

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=william
DB_PASS=<strong-password>
DB_NAME=william_app

JWT_SECRET=<at-least-32-chars-random-secret>

OPENAI_API_KEY=<your-openai-key>
OPENAI_TIMEOUT_MS=30000
OPENAI_BASE_URL=https://api.openai.com/v1

GEMINI_IMAGE_API_KEY=<your-gemini-key>
GEMINI_IMAGE_MODEL=imagen-3.0-generate-002
GEMINI_IMAGE_TIMEOUT_MS=60000

CORS_ORIGIN=https://app.yourdomain.com

HTTP_PROXY=
HTTPS_PROXY=
http_proxy=
https_proxy=

RAG_SERVICE_URL=http://127.0.0.1:8010
RAG_SERVICE_AUTOSTART=false
RAG_SERVICE_WARMUP_ON_BOOT=true
RAG_SERVICE_HOST=127.0.0.1
RAG_SERVICE_PORT=8010
RAG_SERVICE_APP=rag_service:app
RAG_SERVICE_PYTHON=/srv/william/william_algorithm/rag/.venv/bin/python3

VOICE_SERVICE_URL=http://127.0.0.1:8020
VOICE_SERVICE_AUTOSTART=false
VOICE_SERVICE_WARMUP_ON_BOOT=false
VOICE_SERVICE_HOST=127.0.0.1
VOICE_SERVICE_PORT=8020
VOICE_SERVICE_APP=voice_service:app
VOICE_SERVICE_PYTHON=
VOICE_SERVICE_STARTUP_TIMEOUT_MS=120000

DEBUG_MEMORY_API_ENABLED=false
```

生产建议：

- `RAG_SERVICE_AUTOSTART=false`
- `VOICE_SERVICE_AUTOSTART=false`

原因：

- 生产环境里 `rag` 和 `voice` 应当由独立进程托管
- 不要让 Node 进程在请求链路里负责“拉起 Python 子服务”

## RAG 服务部署

```bash
sudo apt install -y libmagic1 poppler-utils tesseract-ocr
cd /srv/william/william_algorithm/rag
uv sync
cp .env.example .env
```

如果你要启用 `CohereRerank`：

```bash
cd /srv/william/william_algorithm/rag
uv sync --extra rerank
```

建议 systemd 文件 `/etc/systemd/system/william-rag.service`：

```ini
[Unit]
Description=William RAG Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/william/william_algorithm/rag
ExecStart=/srv/william/william_algorithm/rag/.venv/bin/python3 -m uvicorn rag_service:app --host 127.0.0.1 --port 8010
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now william-rag
```

## Voice 服务部署

```bash
cd /srv/william/william_algorithm/voice
cp .env.example .env
uv sync
```

建议 systemd 文件 `/etc/systemd/system/william-voice.service`：

```ini
[Unit]
Description=William Voice Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/william/william_algorithm/voice
ExecStart=/bin/bash -lc 'uv run python -m uvicorn voice_service:app --host 127.0.0.1 --port 8020'
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now william-voice
```

## Backend 部署

安装依赖：

```bash
cd /srv/william/Development/backend
npm install --omit=dev
```

当前仓库已有 PM2 配置 [ecosystem.config.js](../backend/ecosystem.config.js)，但上线时建议把 `watch` 关掉。

启动：

```bash
cd /srv/william/Development/backend
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

### 建议的 PM2 生产调整

- `watch: false`
- 日志目录改到 `/srv/william/logs`
- `max_memory_restart` 至少调到 `512M`

如果你要更稳，可以单独维护一个生产版 `ecosystem.config.prod.js`。

## Frontend 部署

前端 API 基础层在 [http.ts](../frontend/src/services/http.ts)：

```ts
const BASE = import.meta.env.VITE_API_BASE ?? '';
```

同域部署时，生产 `.env` 可以直接留空：

```env
VITE_API_BASE=
```

构建：

```bash
cd /srv/william/Development/frontend
npm install
npm run build
```

构建产物在：

```text
/srv/william/Development/frontend/dist
```

## Nginx 配置

建议使用同域名：

- `/` -> 前端静态资源
- `/api/` -> backend

配置示例 `/etc/nginx/sites-available/william`：

```nginx
server {
    listen 80;
    server_name app.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/app.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.yourdomain.com/privkey.pem;

    root /srv/william/Development/frontend/dist;
    index index.html;

    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        client_max_body_size 25m;
    }
}
```

启用：

```bash
sudo ln -s /etc/nginx/sites-available/william /etc/nginx/sites-enabled/william
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d app.yourdomain.com
```

## 防火墙

只开放：

- `80`
- `443`
- 如果你需要 SSH：`22`

不要开放：

- `3001`
- `3306`
- `8010`
- `8020`

## 上线验证清单

### 基础健康检查

```bash
curl https://app.yourdomain.com/api/health
curl http://127.0.0.1:8010/health
curl http://127.0.0.1:8020/health
pm2 status
sudo systemctl status william-rag
sudo systemctl status william-voice
```

### 产品链路验证

1. 注册 / 登录
2. Chat 发一条消息
3. Today 加载成功
4. Journal 可保存
5. You 页能看到 badges / history
6. Voice 转写接口可用
7. Digital Expert 正常返回
8. Today 的 path / todo / badge 流程可跑通

如果你要快速验收，直接用 demo 种子账号。

## 更新流程

```bash
cd /srv/william
git pull

cd /srv/william/Development/backend
npm install --omit=dev
node sql/init.js
pm2 restart william-api

cd /srv/william/Development/frontend
npm install
npm run build

sudo systemctl restart william-rag
sudo systemctl restart william-voice
sudo systemctl reload nginx
```

## 回滚策略

建议至少保留：

- 最近一个稳定 git tag
- 最近一次前端构建产物
- 每日数据库备份

最小回滚手段：

1. 回滚代码到上一个 tag
2. 重建 frontend
3. `pm2 restart william-api`
4. 必要时恢复数据库备份

## 监控与日志

第一版至少接入：

- `pm2 logs william-api`
- `journalctl -u william-rag -f`
- `journalctl -u william-voice -f`
- `sudo tail -f /var/log/nginx/access.log`
- `sudo tail -f /var/log/nginx/error.log`

建议再补：

- Uptime 检查：`/api/health`
- 磁盘监控
- MySQL 可用性
- OpenAI / Gemini 调用失败率

## 不推荐的部署方式

当前阶段不建议：

- 只把前端扔到 Vercel，而 backend/rag/voice 分散在多个临时平台
- 让公网直接访问 `rag:8010` 或 `voice:8020`
- 生产仍然使用 backend 自动拉起 `rag/voice`
- 把生产密钥写进仓库

## 推荐上线顺序

1. 先按“单机同域名”上线 staging
2. 用 demo 账号完整走一遍产品链路
3. 再切 production 域名
4. 上线后一周内不要同时做“大版本重构 + 架构拆分”

这条路径最符合你当前代码库的成熟度。后面如果用户量上来，再拆：

- 独立 MySQL
- 独立对象存储
- 独立 API 域名
- 独立 RAG/Voice 节点
