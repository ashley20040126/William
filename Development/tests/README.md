# Tests

这个目录放 William 的可重复执行测试脚本。

当前先提供轻量的 smoke tests，目标是：

- 删减功能后，快速验证主链路没有断
- 不依赖额外测试框架
- 直接对本地 HTTP 服务做真实请求
- 在算法已经“能跑”后，再用真实对话样本做人工评审

## 目录结构

```text
tests/
├── README.md
├── audit/
│   ├── README.md
│   ├── interventionSignalsAudit.js
│   ├── retrievalIntentAudit.js
│   └── wellbeingSchemaAudit.js
├── fixtures/
│   └── README.md
├── review/
│   ├── README.md
│   ├── realConversationReview.js
│   └── run-real-review.sh
└── smoke/
    ├── all.sh
    ├── ambient-listening-audio-smoke.sh
    ├── attachment-smoke.sh
    ├── chat-smoke.sh
    ├── call-turn-text-smoke.sh
    ├── common.sh
    ├── insights-smoke.sh
    ├── journey-smoke.sh
    ├── schedule-candidate-smoke.sh
    ├── schedule-candidate-lifecycle-smoke.sh
    ├── today-smoke.sh
    ├── url-import-smoke.sh
    ├── voice-negative-smoke.sh
    └── voice-smoke.sh
```

## 前置条件

- 后端服务已启动，默认 `http://127.0.0.1:3103`
- MySQL 已连接
- OpenAI / Voice / TTS 相关环境变量已配置

如果你的后端跑在其他端口：

```bash
API_BASE=http://127.0.0.1:3001 ./tests/smoke/all.sh
```

## 运行方式

单条测试：

```bash
cd Development
cd backend && npm run audit:retrieval-intent
cd backend && npm run audit:intervention-signals
cd backend && npm run audit:wellbeing-schema
./tests/smoke/attachment-smoke.sh
./tests/smoke/chat-smoke.sh
./tests/smoke/call-turn-text-smoke.sh
./tests/smoke/voice-smoke.sh
./tests/smoke/voice-negative-smoke.sh
./tests/smoke/ambient-listening-audio-smoke.sh
./tests/smoke/schedule-candidate-smoke.sh
./tests/smoke/schedule-candidate-lifecycle-smoke.sh
./tests/smoke/today-smoke.sh
./tests/smoke/insights-smoke.sh
./tests/smoke/journey-smoke.sh
```

整套 smoke：

```bash
cd Development
./tests/smoke/all.sh
# 或
cd backend && npm run smoke:all
```

如果你也想把公开 URL 导入链路一起测上：

```bash
cd Development
RUN_URL_IMPORT_SMOKE=1 ./tests/smoke/all.sh
```

## 语音测试说明

`voice-smoke.sh` 默认优先调用 `/api/voice/tts` 生成一段测试音频，再回灌到：

- `POST /api/voice/transcribe`
- `POST /api/voice/transcribe-chunk`

如果你不想依赖 TTS，也可以直接指定现成音频文件：

```bash
cd Development
VOICE_SMOKE_AUDIO=/absolute/path/to/sample.mp3 ./tests/smoke/voice-smoke.sh
```

`voice-negative-smoke.sh` 会覆盖几类语音失败路径：

- `POST /api/voice/transcribe` 缺少音频文件应返回 `400`
- 非音频上传应返回 `400`
- 超过 `15MB` 的音频应返回 `413`
- `POST /api/voice/ambient-listening-audio` 静音音频应返回 `422`
- `POST /api/voice/transcribe-chunk` 的坏音频片段应返回 `200` 且 `ignored: true`

## URL 导入测试说明

`url-import-smoke.sh` 默认不进入 `all.sh`，因为它依赖外网抓取。

默认目标：

```bash
URL_IMPORT_TARGET=https://example.com
```

手动执行：

```bash
cd Development
./tests/smoke/url-import-smoke.sh
```

## 输出约定

- 成功时输出 `[PASS] ...`
- 失败时输出 `[FAIL] ...` 并退出非零状态

这样可以直接接进 CI，或者让你本地删减功能后快速回归。

## 真实对话样本评审

除了 smoke 和 deterministic audit，仓库现在还提供一条更接近真实产品判断的人工评审链路：

- 默认样本：`tests/fixtures/real-conversation-review.sample.json`
- 运行脚本：
  - `tests/review/run-real-review.sh`：真实调用本地 API
  - `tests/review/realConversationReview.js`：评分包渲染和 dry-run
- npm 入口：`cd backend && npm run review:real`

它会：

- 对每个样本 case 新建一个独立 guest 用户，避免跨 case 污染
- 按 case 定义的 profile / mode / temporary chat 设置真实调用 `POST /api/chat/message`
- 生成一份 review bundle：
  - `review-results.json`
  - `review-transcript.md`
  - `review-scorecard.md`
  - `review-scorecard.csv`

默认输出到 `/tmp/william-real-review-<timestamp>/`。

常用用法：

```bash
cd Development/backend
npm run review:real
npm run review:real -- --dry-run
npm run review:real -- --cases ../tests/fixtures/real-conversation-review.sample.json --out /tmp/william-real-review
```

建议把它当成“上线前人工 review 包生成器”，而不是自动判分脚本。

## 推荐分层

- `audit:*`
  - 测结构和规则边界
  - 适合改 memory / prompt / intervention / schema self-heal 后先跑
- `smoke:*`
  - 测真实 HTTP 主链路
  - 适合改 route / service / today feed / insights / journey / voice 后跑
- `review:real`
  - 测真实产品输出
  - 适合改回复策略、prompt 行为覆盖后跑
