# William

**Personal AI Companion OS for Emotional Intelligence**

William 是一款隐私优先的 AI 情绪伴侣，基于用户日常生活的上下文信号，持续感知情绪状态、归因触发根源，并在合适时机推送个性化干预。

---

## 项目结构

```
Development/
├── frontend/          React + TypeScript + Vite (WebView 应用)
├── backend/           Node.js + Express API 服务
├── tests/             仓库级 smoke tests
├── docs/              产品与开发文档
│   ├── PRD.md                  产品需求文档
│   ├── 功能设计更新文档.md       最新功能分区设计说明（中文）
│   ├── DEPLOYMENT.md           生产部署指南
│   ├── LOCAL_DEV.md            本地开发指南
│   └── ER_USER_JOURNEY.md      ER 图与用户数据流转链路
└── README.md
```

### 当前代码分层

- 前端 HTTP 基础层：`frontend/src/services/http.ts`
- 前端领域 API：`frontend/src/services/authApi.ts`、`chatApi.ts`、`voiceApi.ts`、`userApi.ts`、`journeyApi.ts`
- 前端兼容导出层：`frontend/src/services/api.ts`
- 后端用户路由：`backend/src/routes/user.js`
- 后端用户服务：`backend/src/services/userProfileService.js`、`backend/src/services/userWellbeingService.js`
- 后端事务与通用工具：`backend/src/services/userServiceUtils.js`

---

## 快速开始

```bash
# 后端
cd backend && npm install && npm run dev   # → :3001

# 前端
cd frontend && npm install && npm run dev  # → :3000
```

详见 [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md)。

## 生产部署

如果你要把当前项目部署成公网网站，直接看 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

当前推荐方案不是把前后端拆到多个轻量平台，而是：

- `Nginx` 同域托管前端静态资源和 `/api`
- `PM2` 常驻 `backend`
- `systemd` 常驻 `rag` 和 `voice`
- `MySQL 8` 仅内网或本机访问

这是目前与仓库结构最匹配、风险最低的上线方式。

### Chat 双模式说明

- `William Classic`
  - 由后端直接请求 OpenAI
  - 在当前本地网络环境中通常依赖 `HTTP_PROXY` / `HTTPS_PROXY`
  - 如果日志出现 `Request timed out`，优先检查代理或 `OPENAI_BASE_URL`
- `Digital Expert`
  - 由后端调用 Docker 中的 RAG 服务
  - 默认地址为 `http://127.0.0.1:8010`
  - `backend` 启动时只做健康检查与预热，不再在宿主机自动拉起 Python 服务

### 对话生成日程候选

- `William` 现在会从用户对话里提取明确的未来安排，生成 `schedule_candidates`
- 提取逻辑现在优先使用 LLM 做结构化抽取，直接输出 `title / location / participants / dateText / timeText`
- 是否值得生成候选现在也优先由模型判定；只因为出现“今天/明天”和一个动作，不会直接机械生成候选
- V1 只抽明确的未来事件，重点识别：
  - 事件标题
  - 日期/时间
  - 地点
  - 参与人
- 规则层只保留兜底和时间归一化，不再依赖 `在 / 到 / 去` 这类字符串硬映射主结果
- 抽到的内容不会直接写死进正式日程，而是先以候选卡的形式出现在 `William` 和 `Today`
- 相对时间会在候选阶段就归一化成绝对日期；例如 `今天下午3-5` 会显示为 `03月20日（今天） 15:00-17:00`
- 候选确认后会按“时间 / 地点 / 事件”三段结构直接并入 `Journey moments`，例如 `8am  咖啡馆 — 喝咖啡`
- 用户确认后会直接并入 `Journey` 当前日期的 `moments`；忽略后变成 `dismissed`
- 候选项支持编辑标题、时间表达、地点和参与人，编辑后会重新解析时间
- `Journey moments` 里的所有条目现在都支持 `Edit`
- `Delete` 入口已收进编辑弹层：
  - 确认后的日程事件会回写为 `dismissed`
  - 默认/回退事件会在本地持久隐藏
- `William` 底部 `+` 面板新增 `Start Listening`
  - 这是一个前端全局监听开关
  - 开启后会在 AppShell 层持续录制音频片段，并允许用户继续切到 `Today / Journey / You`
  - 当前 V1 仅保证在 app 内跨页面持续监听；浏览器切到真正后台、锁屏或系统回收麦克风时不保证继续运行
  - 音频片段会异步发到 `/api/voice/ambient-listening-audio`
  - 后端会调用 `voice_service.py:/analyze` 跑 `voice` 算法，得到 `voice_stress / speech_pace / stability / vocal_vitality`
  - 分析结果会写入 `ambient_listening_events`，并聚合到 `day_profiles.ambient_stress_*`
  - `Today` 与 `You` 读取历史画像时，会把 `ambient_stress_avg` 作为 voice signal 融合进展示 stress，不直接覆盖原有 `composite_stress`
  - 后端 `today feed / insights` 也会读取融合后的 stress，所以 `William noticed` 和纵向洞察本身会感知 voice signal

### 语音入口

- 右上角 `📞`
  - 进入免按键的连续语音通话
  - 输入侧统一走 `MediaRecorder + Whisper`
  - 预转写通过 `POST /api/voice/transcribe-chunk`
  - 系统会在短暂停顿后自动收束这一轮，发到 `/api/voice/call-turn-text`
  - `Settings -> Language` 会决定通话 STT 后处理语言偏好，以及 William 回复播报时使用的 TTS 语言
  - William 回复播报现在优先走 OpenAI TTS；默认中文音色为 `verse`，英文音色为 `sage`；服务未配置时才退回浏览器原生 TTS
  - 播报回复后会自动回到听你说的状态；说话时可再次点按钮打断
  - 通话页会明确显示 `Listening / Thinking / Speaking` 状态
  - 播报结束后会延迟恢复监听，并过滤与刚播报内容高度相似的回声转写
- 右下角 `🎙️`
  - 用于语音转文字
  - 识别结果会直接写入输入框，用户可编辑后再发送
  - 不再进入单独二级页面
  - 统一走 `MediaRecorder + /api/voice/transcribe-chunk`
  - 停止录音后再用 `/api/voice/transcribe` 校正最终文本
  - `Settings -> Language` 会决定 STT 后处理所采用的语言偏好
- 语音能力依赖 Docker 中的 `Voice` 服务，默认地址为 `http://127.0.0.1:8020`

### Smoke Tests

仓库内置了一套轻量的主链路 smoke tests，放在 `tests/`：

```bash
cd Development
./tests/smoke/all.sh
```

当前覆盖：

- `POST /api/chat/message`
- `POST /api/chat/message` + 文本附件上传
- `POST /api/voice/call-turn-text`
- `POST /api/voice/transcribe`
- `POST /api/voice/transcribe-chunk`
- 语音失败路径：缺少音频 / 非音频 / 超大文件 / 静音音频 / chunk 忽略
- `POST /api/voice/ambient-listening-audio`
- 对话触发的 `scheduleCandidates` 提取
- `scheduleCandidates` 的 `confirm / dismiss`

可选扩展：

- 公开 URL 导入 smoke：`RUN_URL_IMPORT_SMOKE=1 ./tests/smoke/all.sh`

### 算法审计与 Prompt 回归

后端现在内置了一套 deterministic 审计脚本，直接复用共享聊天与记忆服务来检查：

- 记忆/active loop 抽取是否误判
- 心理支持模块是否误路由
- prompt 是否按意图做了条件化瘦身
- intervention 效果学习是否只影响相关干预

运行方式：

```bash
cd backend
npm run audit:prompt
npm run audit:memory
npm run review:real
```

脚本会创建临时审计用户跑完整矩阵，并在结束后自动清理测试用户数据。

- `audit:prompt`
  - 检查 retrieval、support routing、prompt slimming、intervention 归因
- `audit:memory`
  - 检查模型判义的 memory classifier、候选池 promotion、以及规则 fallback
- `review:real`
  - 用真实对话样本打本地 `chat` API，生成 transcript + 人工评分表
  - 默认样本在 `tests/fixtures/real-conversation-review.sample.json`
  - live runner 在 `tests/review/run-real-review.sh`
  - 渲染脚本在 `tests/review/realConversationReview.js`
  - 默认输出到 `/tmp/william-real-review-<timestamp>/`

### 共享记忆系统

- `William Classic` 与 `Digital Expert` 现在共享一套记忆底座
- 长期记忆通过 `user_memories` 保存，当前会话摘要通过 `session_memories` 保存
- `user_active_loops` 会额外维护“用户当前正在推进或反复卡住的事项”
- `intervention_outcomes + user_intervention_preferences` 会记录什么支持动作被采纳、跟进，以及对这个用户更容易有效
- 长期记忆抽取现在采用 `规则保底 + 模型判义 + 策略落库`
  - `question / hypothetical / pure quote / reported speech` 这类边界仍由规则先过滤
  - 通过过滤的句子会进入统一 memory classifier，判断是否值得记、该写成 `stable memory` 还是 `active loop`
  - 中低置信度结果会先进入 `memory_candidates`，而不是直接污染长期画像
- 两种模式共用 `shared_core` / `shared_session`，再分别叠加 `classic_bias` / `expert_bias`
- 读取时会按模式和当前问题意图重新排序：`Classic` 更优先情绪/关系/支持偏好，`Digital Expert` 更优先目标/模式/行动历史
- Prompt 装配会按意图裁剪：`file / memory audit / schedule` 默认不再强行叠加最近状态画像与支持偏好
- 长期记忆支持 `canonical_key` 去重、`times_seen` 累计、`status` 控制和 `memory_events` 调试追踪
- 用户现在可以在正式设置页查看长期记忆、active loops、支持方式效果摘要，删除单条记忆，并通过 `users.memory_enabled` 暂停长期记忆读写
- 聊天页支持 `Temporary chat`：仍走同一条 `chatService` 主链路，但不会读取/写入长期记忆，也不会进入历史记录
- 具体启动和排障见 `docs/LOCAL_DEV.md`

### Digital Expert 的心理知识库

- `Digital Expert` 现在除了专家语料 RAG，还会额外通过 RAG 容器接口读取 `mental_kb`
- 这是一套结构化心理支持模块，不是泛百科
- 当前 V1 覆盖：
  - 焦虑升级
  - 反刍与内耗
  - 困难对话准备
  - 边界与关系内耗
  - 睡眠受扰
  - 低落与难以启动
- 高风险表达会优先触发安全规则，而不是继续普通 reflective coaching
- 本地还配了两套评测：
  - `python3 william_algorithm/rag/evaluate_mental_kb.py`
  - `python3 william_algorithm/rag/evaluate_support_quality.py`
  - 前者测“路由与风险分层”，后者测“回复质量是否自然、不过度模板化”

### William Classic 的支持层

- `William Classic` 现在也会通过 RAG 容器读取同一套 `mental_kb` 数据
- 它只使用精简后的支持规则，不直接使用完整模块 prompt
- 作用：
  - 高风险表达时优先给出更安全的 crisis handoff 语言
  - 在困难对话、反刍、焦虑、睡眠、低落等场景里减少空泛安慰
  - 保持 `Classic` 的短答和陪伴感，不把它变成结构化 coach

---

## 核心功能分区

| Tab | 屏幕 | 说明 |
|-----|------|------|
| ☀️ Today | TodayScreen | 个性化今日数据包、William 日程候选、**Moments 日历视图**、日记入口 |
| 💬 William | ChatScreen | 持久 AI 对话伴侣，支持 **William Classic / Digital Expert** 双模式、多轮记忆连续性、**Temporary chat**、**语音通话**、**语音转文字输入**、**photo / file 附件解析**、**公开 AI Chat URL 导入** |
| 🗺️ Journey | JourneyScreen | 情绪故事可视化 + 旅程注册与进度追踪 + 当前时段练习入口 |
| 🪬 You | YouScreen | 个人档案、纵向洞察、隐私与权限控制 |

---

## 后端 API 路由

| 路径 | 说明 |
|------|------|
| `POST /api/auth/signup` | 注册 |
| `POST /api/auth/login` | 登录 |
| `POST /api/auth/guest` | 游客授权 |
| `POST /api/chat/message` | AI 对话（William Classic / Digital Expert）+ `photo/file` 附件上传解析 + 公开 URL 导入 |
| `GET /api/chat/history` | 获取聊天历史，支持 `sessionId` 与 `limit` 查询参数 |
| `DELETE /api/chat/history` | 软清空正式聊天历史；不删除长期记忆 |
| `POST /api/voice/transcribe` | 语音转文字 |
| `POST /api/voice/transcribe-chunk` | 流式 STT 分段预转写 |
| `POST /api/voice/tts` | OpenAI TTS 语音合成 |
| `POST /api/voice/ambient-listening` | 保存后台监听 transcript 增量并更新当日 ambient stress 聚合 |
| `POST /api/voice/ambient-listening-audio` | 上传后台监听音频片段，执行 voice 算法分析并更新当日 ambient stress 聚合 |
| `POST /api/voice/call-turn-text` | 流式语音通话文本回合 |
| `GET /api/debug/memory/session/:sessionKey` | 查看 session 记忆快照（开发调试） |
| `GET /api/debug/memory/user` | 查看长期记忆、active loops、intervention 效果摘要（开发调试） |
| `GET /api/debug/memory/context` | 查看模型实际注入上下文（开发调试） |
| `POST /api/debug/memory/rebuild-session` | 重建 session 摘要（开发调试） |
| `POST /api/debug/memory/reextract-user` | 重跑长期记忆抽取（开发调试） |
| `PATCH /api/debug/memory/:memoryId` | 更新长期记忆状态（开发调试） |
| `GET /api/user/profile` | 获取用户档案 |
| `POST /api/user/profile` | 更新用户档案 |
| `GET /api/user/memories` | 获取用户可见的长期记忆、active loops、intervention 效果摘要与记忆开关状态 |
| `POST /api/user/memories/:memoryId/status` | 更新某条长期记忆状态（当前产品侧主要用于删除） |
| `POST /api/user/active-loops/:loopId/status` | 更新某条 active loop 状态（当前产品侧主要用于标记完成） |
| `POST /api/user/mood` | 记录情绪打卡 |
| `POST /api/user/journal` | 提交日记 |
| `GET /api/user/today` | 个性化今日数据包 |
| `POST /api/user/practices` | 记录练习完成 |
| `GET /api/user/history` | 获取历史 day_profiles |
| `GET /api/user/insights` | 获取纵向洞察分析 |
| `GET /api/journey` | 查询旅程注册记录 |
| `POST /api/journey/enroll` | 加入旅程 |
| `POST /api/journey/progress` | 推进旅程步骤 |
| `GET /api/journey/schedule-candidates` | 查询由 William 对话抽取出的待确认日程候选 |
| `POST /api/journey/schedule-candidates/:id/confirm` | 确认一个日程候选 |
| `POST /api/journey/schedule-candidates/:id/dismiss` | 忽略一个日程候选 |
| `PATCH /api/journey/schedule-candidates/:id` | 编辑一个日程候选 |

---

## 技术栈

**前端：** React 18 · TypeScript · Vite · Tailwind CSS · Zustand · Framer Motion · React Router

**后端：** Node.js · Express · MySQL 8 · OpenAI API · JWT · PM2

**部署：** Nginx · Ubuntu / 阿里云 ECS
