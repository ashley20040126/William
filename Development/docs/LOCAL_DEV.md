# 本地开发指南

## 环境依赖

| 工具 | 版本要求 |
|------|---------|
| Node.js | 18+ |
| MySQL | 8+ |
| npm | 9+ |
| Python | 3.10+（仅 `william_algorithm` 容器镜像构建需要） |

---

## 1. 克隆仓库并安装依赖

```bash
git clone <repo-url>
cd Development

# 后端
cd backend && npm install && cd ..

# 前端
cd frontend && npm install && cd ..
```

算法服务现在统一从 Docker 容器提供，先启动 `william_algorithm` 下的容器：

```bash
cd ../william_algorithm
docker compose up -d --build rag voice django
```

启动后本机访问地址固定为：

- `RAG`: `http://127.0.0.1:8010`
- `Voice`: `http://127.0.0.1:8020`
- `Django Expert Bot`: `http://127.0.0.1:8000`

### 当前代码结构补充

- 前端 `src/services/http.ts`
  - 统一管理 token、`ApiError`、`postJsonOrThrow / postForm`
- 前端 `src/services/*Api.ts`
  - `authApi.ts`：登录、游客、退出
  - `chatApi.ts`：William 文本对话、附件、URL 导入
  - `GET /api/chat/history` 读取聊天记录时，可带 `sessionId` 只取单个会话
  - `voiceApi.ts`：语音转写、语音通话
  - `userApi.ts`：profile、mood、journal、today、history、insights
  - `journeyApi.ts`：journey 相关接口
- 前端 `src/services/api.ts`
  - 只做兼容导出，老调用方不需要一次性改完
- 后端 `src/routes/user.js`
  - 现在只保留路由层逻辑
- 后端 `src/services/userProfileService.js`
  - 负责 profile 读取与更新
- 后端 `src/services/userWellbeingService.js`
  - 负责 mood、journal、today、history、insights、practices
- 后端 `src/services/userServiceUtils.js`
  - 统一放事务 helper、JSON parse、参数校验

---

## 2. 数据库配置

### 创建 MySQL 用户和数据库

```sql
CREATE DATABASE william_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'william'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON william_app.* TO 'william'@'localhost';
FLUSH PRIVILEGES;
```

### 初始化数据库表结构

```bash
cd backend
cp .env.example .env
# 编辑 .env，填写 DB_PASS、OPENAI_API_KEY，以及需要时的代理配置
node sql/init.js
```

如果你是在已有数据库上升级，而不是全新初始化，还需要补这列：

```sql
ALTER TABLE users ADD COLUMN language VARCHAR(10) DEFAULT 'zh-CN' AFTER voice_mode;
```

---

## 3. 环境变量配置

**backend/.env**

```
PORT=3001
NODE_ENV=development
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=william
DB_PASS=your_password
DB_NAME=william_app
JWT_SECRET=任意长随机字符串（生产环境请用32位以上）
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT_MS=30000
CLASSIC_FALLBACK_TO_RAG_ON_OPENAI_ERROR=true
OPENAI_BASE_URL=
CORS_ORIGIN=http://localhost:3000
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
RAG_SERVICE_URL=http://127.0.0.1:8010
RAG_SERVICE_AUTOSTART=false
RAG_SERVICE_WARMUP_ON_BOOT=true
RAG_SUPPORT_GUIDANCE_TIMEOUT_MS=10000
VOICE_SERVICE_URL=http://127.0.0.1:8020
VOICE_SERVICE_AUTOSTART=false
VOICE_SERVICE_WARMUP_ON_BOOT=true
ATTACHMENT_TEXT_LIMIT=8000
ATTACHMENT_SUMMARY_LIMIT=220
ATTACHMENT_EXCERPT_LIMIT=800
ATTACHMENT_CONTEXT_LIMIT=4
URL_IMPORT_TIMEOUT_MS=12000
URL_IMPORT_MAX_BYTES=2097152
URL_IMPORT_TEXT_LIMIT=12000
URL_IMPORT_EXCERPT_LIMIT=1000
MEMORY_RECENT_MESSAGE_LIMIT=8
MEMORY_SUMMARY_LOOKBACK_LIMIT=24
MEMORY_USER_MEMORY_LIMIT=12
MEMORY_DEBUG_EVENT_LIMIT=30
MEMORY_SESSION_DEBUG_LIMIT=20
DEBUG_MEMORY_API_ENABLED=true
```

### `William Classic` 与 `Digital Expert` 的区别

- `William Classic`
  - 由 `Development/backend/src/services/ai.js` 直接调用 OpenAI `chat/completions`
  - 默认模型为 `gpt-4o-mini`
  - 当前本地网络环境通常需要 `HTTP_PROXY` / `HTTPS_PROXY` 才能稳定访问 `api.openai.com`
- `Digital Expert`
  - 由 `Development/backend/src/services/ragService.js` 调用 Docker 中的 `rag` 服务
  - 默认服务地址为 `http://127.0.0.1:8010`
  - 后端只做健康检查和预热，不再在宿主机自动拉起 Python 进程

### William 页的语音能力

- 右上角 `📞`
  - 连续语音通话
  - 输入侧统一走 `MediaRecorder -> /api/voice/transcribe-chunk`
  - 检测到短暂停顿后，会自动把这一轮 transcript 发到 `POST /api/voice/call-turn-text`
  - `Settings -> Language` 会决定通话 STT 后处理语言偏好，以及 William 回复播报时使用的 TTS 语言
  - William 播报回复优先走 OpenAI TTS；默认中文音色为 `verse`，英文音色为 `sage`；未配置时才回退浏览器原生 TTS
  - William 播报回复后会自动回到 listening 状态；用户也可以在 William 播报时再次点按钮打断
  - 通话页会显示 `Listening / Thinking / Speaking` 三段状态
  - 为减少浏览器 TTS 被 STT 误收，播报结束后会延迟恢复监听，并过滤与刚播报内容高度相似的转写
  - 后端再复用和文本聊天相同的 `chatService`
- 右下角 `🎙️`
- 语音转文字
  - 直接内联写入聊天输入框，不再进入单独二级页面
  - 统一走 `MediaRecorder -> /api/voice/transcribe-chunk` 做流式预转写
  - 停止录音后，再用 `POST /api/voice/transcribe` 对整段音频做一次最终校正
  - `Settings -> Language` 会决定 STT 后处理所采用的语言偏好
- 两种语音入口都复用同一套记忆系统
  - 语音内容先转文本
  - 再写入 `chat_messages / session_memories / user_memories / memory_events`
  - 如果当前 session 是 `Temporary chat`，仍然走同一条 `chatService`，但不会写入 `session_memories / user_memories`
- 底部 `+` 面板新增 `Start Listening`
  - 这是一个 App 内全局监听开关，不是单轮 STT 输入
  - 开启后会在 `AppShell` 层维持 `MediaRecorder` 分段采集
  - 用户可以继续浏览 `Today / Journey / You`
  - V1 只保证在单页 app 前台持续监听；浏览器最小化、锁屏或系统收回麦克风权限时可能中断
  - 每个音频片段会异步调用 `POST /api/voice/ambient-listening-audio`
  - 后端会通过 `voice_service.py:/analyze` 跑音频分析，得到 `voice_stress / speech_pace / stability / vocal_vitality`
  - 分析结果会写入 `ambient_listening_events`，并聚合到 `day_profiles.ambient_stress_avg / ambient_stress_peak`
  - 前端展示层会把 `ambient_stress_avg` 作为 voice signal 融合进 `Today` 和 `You` 的 stress 展示；当前阶段不回写 `composite_stress`
  - 后端 `GET /api/user/today` 和 `GET /api/user/insights` 也会读取融合后的 stress 口径，因此 `TodayFeed` 和纵向洞察会感知 voice signal

### William 页的附件能力

- `photo` 和 `file` 仍然通过 `POST /api/chat/message` 进入主聊天链路
- 原始文件落在 `backend/uploads/`，结构化信息额外写入 `chat_attachments`
- 图片会做视觉摘要与 OCR 文本提取
- `PDF / DOCX / TXT / MD / CSV` 会做文本抽取与摘要
- `AI Chat` 输入框支持导入公开 URL；后端会抓取页面正文、生成摘要，并按“虚拟附件”接入同一条链路
- 当前对 `ChatGPT / Claude / Gemini` 公开分享页有专门解析规则，会优先提取对话轮次而不是整页正文
- V1 只支持公开可访问的分享页或普通网页，不支持需要登录的私有聊天页
- 当前附件摘要会进入本轮 prompt；最近附件摘要会作为后续追问的上下文继续注入
- 附件中提炼出的稳定事实会继续进入 `session_memories / user_memories`

### William 对话里的日程候选

- `William` 现在会在用户发送文本后，自动抽取明确的未来安排候选
- 抽取链路：
  - 先由模型判断“这句话是否值得生成日程候选”
  - 先用 LLM 做结构化抽取，输出 `title / location / participants / dateText / timeText`
  - 再用后端规则做时间归一化、去重和 fallback
- 如果模型明确判断“不值得生成候选”，不会再回退成规则硬判
- 当前 V1 重点识别：
  - 事件标题
  - 日期/时间
  - 地点
  - 参与人
- 抽取结果不会直接进入正式日程，而是先写入 `schedule_candidates`
- 展示位置：
  - `William` 消息流里的候选卡
  - `Today` 页顶部的 `Planned from William`
  - 用户确认后直接并入对应日期的 `moments`
- 时间显示规则：
  - 相对时间会先归一化成绝对日期再展示
  - 例如 `今天下午3-5要去体育馆打球` 会被解析成 `03月20日（今天） 15:00-17:00`
  - `Journey` 会始终补齐最近 7 个自然日，因此即使当天还没有 mood/journal 记录，确认后的计划也能并入当天的 `moments`
- `moments` 展示规则：
  - 不再做额外风格化改写
  - 确认后的候选项直接按“时间 / 地点 / 事件”映射进 `moments`
  - 例如 `今天早上8-9要在咖啡馆喝咖啡` 会显示成 `8-9am  咖啡馆 — 喝咖啡`
- 当前规则偏保守：
  - LLM 失败时会自动回退到规则抽取，不影响聊天主链路
  - 愿望句、假设句、回忆句默认不抽
  - 模糊时间只保留 `date_text`，并要求后续确认
  - 同一事件会按 `dedupe_key` 去重
  - 但如果用户明确在说“帮我加入日程/加到日程里”，且已经给出像 `上午10去咖啡馆喝咖啡` 这样的同日明确时间块，系统会优先按“今天”生成候选
  - 如果上一轮已经给了时间/地点框架，例如 `下午3点要去体育馆打球`，下一轮再补 `羽毛球，帮我加入日程`，系统会先尝试把两轮合并成一条完整候选
  - 多轮补全的主路径会优先让 LLM 直接输出 `title / location / dateText / timeText` 这样的结构化结果，规则层主要负责时间归一化、合法性校验和兜底 fallback
- V1 典型例子：
  - `周五下午三点和老板聊离职`
  - `明天早上去医院复诊`
- 当前支持操作：
  - `Add to Journey`
  - `Edit`（修改标题、时间表达、地点、参与人，并重新解析时间）
  - `Delete`（在 `Edit moment` 弹层里删除候选）
- `Journey moments` 删除规则：
  - 所有 `moments` 都支持 `Edit`
  - `Delete` 入口放在 `Edit moment` 弹层中
  - 来自确认后日程候选的 `moment` 会调用 `dismiss`，删除后刷新不再出现
  - 来自默认/回退数据的 `moment` 会写入本地持久隐藏列表，删除后当前设备刷新不再出现
  - `Today` 页里的 `Moments` 使用紧凑列表展示，每条右侧有常驻 `Edit`
  - `Edit` 进入统一弹层：日程 `moment` 可改标题/时间/地点并删除，默认 `moment` 可改时间/地点/事件/压力并删除

### Digital Expert 的结构化心理知识库

`Digital Expert` 现在除了检索专家语料，还会额外通过 RAG 容器暴露的接口读取结构化心理支持知识：

- 目录：`william_algorithm/rag/mental_kb/`
- `safety/risk_policy.json`
  - 用于高风险表达识别和危机分流
- `modules/*.json`
  - 用于高频心理支持场景的模块化指导

当前 V1 模块：

- `anxiety_escalation`
- `rumination`
- `difficult_conversation`
- `boundaries_relationship`
- `sleep_disruption`
- `low_mood_inertia`

这层知识不会替代原本的专家 RAG，而是作为生成前的“专业约束层”：

1. 先识别风险等级
2. 再选最相关的心理支持模块
3. 把模块中的提问、解释、微动作、禁区和来源锚点注入 prompt
4. 最后再生成回复

当前知识库的设计原则不是“把每句话写死”，而是：

- `must_do`
  - 这轮必须守住的方向
- `nice_to_do`
  - 可以考虑推进的点
- `do_not`
  - 明确禁区
- `response_requirements`
  - 最终回复必须落到的锚点，例如“困难对话至少要碰到最怕的反应 / 最想让对方听见的一句话 / 一个可开口的开场”

也就是说，知识库决定方向和边界，不直接规定最终措辞，避免回复变得像脚本。

当前知识来源优先使用：

- WHO `mhGAP`
- NICE 指南
- VA 公开 CBT-I / sleep 材料
- 988 Lifeline

---

## 4. 运行 smoke tests

仓库内置了一组主链路 smoke tests，在 `Development/tests/`：

```bash
cd Development
./tests/smoke/all.sh
```

也可以单独执行：

```bash
cd Development
./tests/smoke/attachment-smoke.sh
./tests/smoke/chat-smoke.sh
./tests/smoke/call-turn-text-smoke.sh
./tests/smoke/voice-smoke.sh
./tests/smoke/voice-negative-smoke.sh
./tests/smoke/ambient-listening-audio-smoke.sh
./tests/smoke/schedule-candidate-smoke.sh
./tests/smoke/schedule-candidate-lifecycle-smoke.sh
```

默认测试目标：

- `API_BASE=http://127.0.0.1:3103`

如果你的后端不在这个端口：

```bash
cd Development
API_BASE=http://127.0.0.1:3001 ./tests/smoke/all.sh
```

如果你也想把公开 URL 导入链路一起测上：

```bash
cd Development
RUN_URL_IMPORT_SMOKE=1 ./tests/smoke/all.sh
```

`voice-smoke.sh` 默认会先调用 `/api/voice/tts` 生成测试音频，再验证：

- `POST /api/voice/transcribe`
- `POST /api/voice/transcribe-chunk`

`voice-negative-smoke.sh` 会额外验证：

- 缺少音频文件返回 `400`
- 非音频上传返回 `400`
- 超过 `15MB` 的音频返回 `413`
- 静音 ambient listening 音频返回 `422`
- 坏的 chunk 音频返回 `200` 且 `ignored: true`

如果你已经有固定音频样本，也可以指定：

```bash
cd Development
VOICE_SMOKE_AUDIO=/absolute/path/to/sample.mp3 ./tests/smoke/voice-smoke.sh
```

边界：

- 它是日常心理支持与反思系统，不是医疗诊断系统
- 高风险表达会优先触发 crisis handoff 语言
- 不要把这层知识库理解成“心理学百科搜索”

### William Classic 的精简支持层

`William Classic` 现在也会通过 RAG 容器复用同一套 `mental_kb` 数据，但只读取压缩后的支持规则：

- 高风险时优先给出更安全的转介/危机提示
- 普通支持场景里尽量避免空泛安慰
- 仍然保持 `Classic` 的短答和陪伴感，不直接变成结构化 coach

实现位置：

- `Development/backend/src/services/mentalSupportService.js`
- `Development/backend/src/services/ai.js`

### 心理知识库评测

当前有两套本地评测：

```bash
cd william_algorithm/rag
python3 evaluate_mental_kb.py
python3 evaluate_support_quality.py
```

评测文件：

- `william_algorithm/rag/mental_kb/evals/routing_cases_v2.json`
  - 42 条路由样本
  - 覆盖 6 个模块、通用低风险样本，以及 `imminent / high / moderate` 风险分层
- `william_algorithm/rag/mental_kb/evals/quality_cases_v1.json`
  - 24 条质量样本
  - 同时包含“应该通过”的自然回复和“应该失败”的模板化/说教式回复

评测用途：

- `evaluate_mental_kb.py`
  - 检查风险等级和模块命中是否正确
  - 输出总通过率、`risk accuracy`、`module accuracy` 和分类统计
- `evaluate_support_quality.py`
  - 不看“路由对不对”，而是看“回复质量好不好”
  - 当前评分维度：
    - `safety`
    - `naturalness`
    - `anti_template`
    - `module_alignment`
  - 另外会对明显坏回复做硬上限：
    - 缺少 crisis handoff
    - 误触发危机语言
    - AI 自述
    - 列表/步骤化模板
    - 打鸡血式低质量安慰
    - 过强的抽象说教腔

当前默认标准：

- 路由评测应达到 `42/42`
- 质量评测应达到 `24/24`

如果你要测真实回复，而不是静态样本，也可以把真实返回内容整理成和 `quality_cases_v1.json` 同结构的 JSON，再执行：

```bash
python3 evaluate_support_quality.py --cases /tmp/your_real_reply_cases.json
```
- 检查高风险表达是否优先走安全规则
- 作为后续扩模块时的最小回归集

### 共享记忆系统

`William Classic` 和 `Digital Expert` 现在共用一套记忆底座：

- `shared_core`
  - 存长期稳定信息：目标、偏好、关系、触发点
- `shared_session`
  - 存当前会话摘要、高频主题、未聊透的问题
- `classic_bias`
  - 陪伴模式更优先读取：支持偏好、情绪触发点、压力线索
- `expert_bias`
  - 数字分身更优先读取：反复模式、已尝试方案、问题定义

后端启动时会自动确保这些表结构存在：

- `chat_messages.attachments`
- `users.memory_enabled`
- `chat_sessions.is_temporary`
- `chat_attachments`
- `session_memories`
- `user_memories`
- `memory_events`

`user_memories` 现在还带有这些用于调优的字段：

- `canonical_key`
  - 用于把“准备转 PM”和“准备转产品经理”这类表达归并成同一条长期记忆
- `status`
  - `active / suppressed / deleted`
  - 调试时可以先 `suppressed`，不必直接物理删除
- `times_seen`
  - 同一记忆被反复提及时会累加，用于提升置信度
- `last_used_at`
  - 记录这条记忆最近一次被注入模型的时间

`memory_events` 现在会记录：

- `event_type`
- `rule_name`
- `before_value`
- `after_value`
- `payload`

这样你能追溯一条记忆是被哪条规则写入、更新，还是被手工 suppress 掉了。

当前正式用户侧也已经有两类基础控制：

- `Memory Center`
  - 通过 `GET /api/user/memories` 拉取当前可见长期记忆
  - 通过 `POST /api/user/memories/:memoryId/status` 把单条记忆改成 `deleted`
  - 同一个接口现在也会返回 `active loops`，表示用户当前正在推进或反复卡住的事项
  - 同一个接口也会返回 `interventionOverview`，表示 William 当前学到哪些支持方式更有效、哪些较少起作用
  - 通过 `POST /api/user/active-loops/:loopId/status` 可以把某个 active loop 标记为 `resolved / dismissed`
- `Temporary chat`
  - 当前轮仍走共享聊天主链路
  - 不读取 `user_memories / session_memories`
  - 不写入新的长期/会话记忆
  - 不出现在 `GET /api/chat/history`
  - V1 仍会保留当前 temporary session 的原始 `chat_messages` 以支撑当轮连续对话；它不是“无痕数据库级销毁”

如果你切了新库、删了表，或者怀疑结构不同步，直接重新执行：

```bash
cd backend
node sql/init.js
```

三个与记忆系统直接相关的环境变量：

- `MEMORY_RECENT_MESSAGE_LIMIT`
  - 每次请求前直接注入给模型的最近消息条数
- `MEMORY_SUMMARY_LOOKBACK_LIMIT`
  - 用来滚动生成 session summary 的历史窗口
- `MEMORY_USER_MEMORY_LIMIT`
  - 每次读取注入的长期记忆条数上限
- `MEMORY_ACTIVE_LOOP_LIMIT`
  - 每次读取注入的 active loop 条数上限
- `intervention_outcomes`
  - 保存每次建议/脚本/练习型回复后，用户是否接受、是否跟进、以及后续结果信号
- `user_intervention_preferences`
  - 聚合每种支持方式对该用户的效果倾向，供 prompt 和用户侧 UI 使用
- `MEMORY_DEBUG_EVENT_LIMIT`
  - 调试接口一次返回的最近事件条数
- `MEMORY_SESSION_DEBUG_LIMIT`
  - 调试接口一次返回的最近原始消息条数
- `DEBUG_MEMORY_API_ENABLED`
  - 是否启用 `/api/debug/memory/*` 调试接口
  - 建议只在本地开发环境开启
- `VOICE_SERVICE_URL`
  - 语音转写 FastAPI 地址
- `VOICE_SERVICE_AUTOSTART`
  - 后端请求语音接口时，是否自动拉起 Voice FastAPI
- `VOICE_SERVICE_WARMUP_ON_BOOT`
  - 后端启动时是否预热 Voice FastAPI

### 记忆调试接口

当 `DEBUG_MEMORY_API_ENABLED=true` 时，后端会开放这些仅开发用接口：

- `GET /api/debug/memory/session/:sessionKey`
  - 查看当前 session 的原始消息、session summary、最近事件，以及 `Classic / Digital Expert` 两种模式下的注入上下文
- `GET /api/debug/memory/user`
  - 查看长期记忆、active loops、intervention 效果摘要
- `GET /api/debug/memory/context?sessionKey=...&mode=classic|direct`
  - 单独查看某次模式下真正注入给模型的上下文
- `POST /api/debug/memory/rebuild-session`
  - 重建该 session 的 `shared_session / classic_bias / expert_bias`
- `POST /api/debug/memory/reextract-user`
  - 基于指定 session 的历史消息重新抽取长期记忆
- `PATCH /api/debug/memory/:memoryId`
  - 手工把某条长期记忆改成 `active / suppressed / deleted`

推荐排查顺序：

1. 先看 `GET /api/debug/memory/session/:sessionKey`
2. 再看 `GET /api/debug/memory/context`
3. 如果发现长期记忆脏了，先 `PATCH` 成 `suppressed`
4. 再决定是否执行 `reextract-user`

### 代理配置说明

如果你发现 `William Classic` 在日志中报 `Request timed out`，优先检查代理，而不是先怀疑 API Key：

- 直连 `api.openai.com` 在当前机器上可能超时
- 当前后端实现会读取 `HTTP_PROXY` / `HTTPS_PROXY`
- 如果你使用 Clash、Surge、Quantumult 之类工具，常见本地端口类似 `7890`
- 如果你通过中转访问 OpenAI，可以设置 `OPENAI_BASE_URL`

建议最少配置：

```bash
OPENAI_API_KEY=sk-proj-...
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
```

**frontend/.env**（可选 — 开发环境下 Vite 代理已自动转发 `/api` 请求）

```
VITE_API_BASE=http://localhost:3001
```

说明：

- 如果你直接访问 `http://localhost:3000` 的 Vite 页面，`VITE_API_BASE` 设为 `http://localhost:3001` 可以最直接
- 如果你更想依赖 Vite 自带代理，也可以将它留空，让前端请求走 `/api`

---

## 4. 启动服务

打开两个终端窗口分别运行：

```bash
# 终端 1 — 后端
cd backend
npm run dev
# → 服务启动在端口 3001
```

当 `backend/.env` 里的 `RAG_SERVICE_AUTOSTART=true` 时，后端启动后会自动预热本地 `FastAPI` 数字分身服务，`Digital Expert` 首次可直接对话，无需再手动运行 `rag.py query`。

如果 `backend/.env` 里的 `VOICE_SERVICE_AUTOSTART=true`，语音转写接口在第一次使用时会自动拉起 `william_algorithm/voice/voice_service.py`。

后端启动后，正常情况下你会看到：

- `[William] Server running on port 3001`
- `[DB] MySQL connected`
- 没有出现 `[Memory] Schema initialization failed`
- 若启用自动预热，随后会看到 `RAG Service` 相关日志

```bash
# 终端 2 — 前端
cd frontend
npm run dev
# → 应用运行在 http://localhost:3000
```

用浏览器打开 [http://localhost:3000](http://localhost:3000)。

### 可选：单独重启算法容器

如果你只想重启某个算法服务：

```bash
cd ../william_algorithm
docker compose restart rag
docker compose restart voice
docker compose restart django
```

### 推荐启动顺序

1. 先启动 `backend`
2. 确认 `http://localhost:3001/api/health` 正常
3. 再启动 `frontend`
4. 打开 `http://localhost:3000/chat`
5. 在左上角切换模式测试
   - `William Classic`：验证 OpenAI 通路
   - `Digital Expert`：验证 FastAPI + RAG 通路
6. 测试语音入口
   - 右下角 `🎙️`：验证语音转文字是否自动写入输入框
   - 右上角 `📞`：验证语音通话是否返回转写 + 回复

---

## 5. 在移动端 WebView 中调试

### Android WebView

模拟器中将 `WebView.loadUrl` 地址设为 `http://10.0.2.2:3000`；真机调试使用本机的局域网 IP。

```kotlin
webView.loadUrl("http://192.168.x.x:3000")
```

同时需要开启 JavaScript 和 DOM 存储：

```kotlin
webView.settings.javaScriptEnabled = true
webView.settings.domStorageEnabled = true
```

### iOS WKWebView

```swift
webView.load(URLRequest(url: URL(string: "http://localhost:3000")!))
```

真机调试时，将 `localhost` 替换为 Mac 的局域网 IP。

### React Native WebView

```jsx
<WebView source={{ uri: 'http://localhost:3000' }} />
```

---

## 6. 无后端离线模式

即使不启动后端服务，应用也可正常运行：

- 游客授权失败会被静默忽略
- 对话降级为本地规则匹配回复
- 所有状态通过 Zustand 持久化到 `localStorage`

这意味着在不配置 MySQL 和 OpenAI API Key 的情况下，也可以开发和调试 UI。

---

## 7. 常用命令

```bash
# 检查后端健康状态
curl http://localhost:3001/api/health

# 检查 Digital Expert FastAPI 健康状态
curl http://127.0.0.1:8010/health

# 检查 Voice FastAPI 健康状态
curl http://127.0.0.1:8020/health

# 检查记忆表
mysql -u root -p -e "USE william_app; SHOW TABLES LIKE 'session_memories'; SHOW TABLES LIKE 'user_memories';"

# 清除本地存储（在浏览器控制台执行）
localStorage.clear(); location.reload();

# 仅做 TypeScript 类型检查，不编译
cd frontend && node_modules/.bin/tsc --noEmit

# 构建生产版本前端包
cd frontend && npm run build

# 运行算法审计与 prompt 回归矩阵
cd backend && npm run audit:prompt
cd backend && npm run audit:memory
cd backend && npm run review:real
```

说明：

- `npm run build` 会生成 `frontend/dist/`
- 如果这次只是本地验证，不准备提交构建产物，记得在结束前清理 `frontend/dist/` 里新增的 hash 文件
- 如果你要排查用户保存失败、权限切换失败这类问题，优先做真实 HTTP smoke test，不要只看前端本地状态
- `npm run audit:prompt` 会创建临时审计用户并在结束后自动清理；它依赖本地 MySQL，但不会调用外部大模型生成回复
- `npm run audit:memory` 会创建临时审计用户并在结束后自动清理；它会 monkeypatch classifier 返回，验证 `memory classifier -> memory_candidates -> promotion/fallback` 主链路
- `npm run review:real` 会按真实对话样本逐条调用本地 `POST /api/chat/message`，并在 `/tmp/william-real-review-<timestamp>/` 生成 transcript、Markdown 评分表和 CSV 评分表；live runner 在 `tests/review/run-real-review.sh`，渲染脚本在 `tests/review/realConversationReview.js`，默认样本在 `tests/fixtures/real-conversation-review.sample.json`

### 常见排障

#### 1. 网页打开了，但聊天没有回复

优先检查三个端口：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3001 -sTCP:LISTEN
lsof -nP -iTCP:8010 -sTCP:LISTEN
```

- `3000` 不在：前端没启动
- `3001` 不在：后端没启动，或启动后崩了
- `8010` 不在：`Digital Expert` 的 FastAPI 服务没起来
- `8020` 不在：Voice FastAPI 服务没起来

#### 2. `William Classic` 日志里出现 `Request timed out`

说明后端到 OpenAI 没走通，重点检查：

- `OPENAI_API_KEY`
- `HTTP_PROXY`
- `HTTPS_PROXY`
- `OPENAI_BASE_URL`

#### 3. `Digital Expert` 没回复或很慢

重点检查：

- `RAG_SERVICE_URL` 是否和实际端口一致
- `docker compose ps rag` 是否为 `healthy` / `running`
- `rag_storage/li_songwei` 是否已有索引文件
- `curl http://127.0.0.1:8010/health` 是否正常
- 改过 `william_algorithm/rag` 代码后，是否已重新 `docker compose up -d --build rag`

#### 4. 语音转文字或语音通话失败

重点检查：

- 浏览器 / WebView 是否授予了麦克风权限
- `VOICE_SERVICE_URL` 是否和实际端口一致
- `curl http://127.0.0.1:8020/health` 是否正常
- `docker compose ps voice` 是否为 `healthy` / `running`
- 改过 `william_algorithm/voice` 代码后，是否已重新 `docker compose up -d --build voice`
- 如果浏览器不支持 `SpeechRecognition`，右下角 `🎙️` 会自动走后端转写 fallback

#### 5. 启动后聊天报数据库字段或表不存在

如果报 `Unknown column ...`、`Table ... doesn't exist` 之类错误，说明数据库结构落后于代码：

```bash
cd backend
node sql/init.js
```

重点检查最近是否新增了：

- `chat_messages.attachments`
- `session_memories`
- `user_memories`
- `memory_events`

#### 6. 改完 `.env` 之后看不到效果

需要重启对应进程：

- 改 `backend/.env` 后，重启 `backend`
- 改 `frontend/.env` 后，重启 `frontend`
- 改 `william_algorithm/rag/.env` 后，重启 FastAPI 服务

---

## 8. 当前 API 路由速查

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/auth/signup` | POST | 注册 |
| `/api/auth/login` | POST | 登录 |
| `/api/auth/guest` | POST | 游客授权 |
| `/api/chat/message` | POST | AI 对话 + `photo/file` 附件上传 + 公开 URL 导入 |
| `/api/chat/history` | GET | 聊天历史 |
| `/api/chat/history` | DELETE | 软清空正式聊天历史，不影响长期记忆 |
| `/api/user/memories` | GET | 获取正式用户侧可见的长期记忆 + active loops |
| `/api/user/memories/:memoryId/status` | POST | 更新长期记忆状态 |
| `/api/user/active-loops/:loopId/status` | POST | 更新 active loop 状态 |
| `/api/voice/transcribe` | POST | 整段语音最终转写 |
| `/api/voice/transcribe-chunk` | POST | 流式 STT 分段预转写 |
| `/api/voice/tts` | POST | OpenAI TTS 语音合成 |
| `/api/voice/ambient-listening` | POST | 保存后台监听 transcript 增量并更新 ambient stress 聚合 |
| `/api/voice/ambient-listening-audio` | POST | 上传后台监听音频片段，执行 voice 算法分析并更新 ambient stress 聚合 |
| `/api/voice/call-turn-text` | POST | 流式语音通话文本回合 |
| `/api/voice/call-turn` | POST | 单轮语音通话 |
| `/api/debug/memory/session/:sessionKey` | GET | 查看 session 记忆快照 |
| `/api/debug/memory/user` | GET | 查看长期记忆列表 + active loops |
| `/api/debug/memory/context` | GET | 查看模型实际注入上下文 |
| `/api/debug/memory/rebuild-session` | POST | 重建 session 摘要 |
| `/api/debug/memory/reextract-user` | POST | 重跑长期记忆抽取 |
| `/api/debug/memory/:memoryId` | PATCH | 更新长期记忆状态 |
| `/api/user/profile` | GET / POST | 档案读写 |
| `/api/user/mood` | POST | 情绪打卡 |
| `/api/user/journal` | POST | 日记提交 |
| `/api/user/today` | GET | 个性化今日数据包 |
| `/api/user/practices` | POST | 练习完成记录 |
| `/api/user/history` | GET | 历史 day_profiles |
| `/api/user/insights` | GET | 纵向洞察分析 |
| `/api/journey` | GET | 旅程注册列表 |
| `/api/journey/enroll` | POST | 加入旅程 |
| `/api/journey/progress` | POST | 推进步骤 |
| `/api/journey/schedule-candidates` | GET | 获取由 William 对话抽取出的日程候选 |
| `/api/journey/schedule-candidates/:id/confirm` | POST | 确认一个候选项 |
| `/api/journey/schedule-candidates/:id/dismiss` | POST | 忽略一个候选项 |
| `/api/journey/schedule-candidates/:id` | PATCH | 编辑一个候选项 |

数据库当前包含 **16 张核心表**：`users` · `chat_sessions` · `chat_messages` · `chat_attachments` · `session_memories` · `user_memories` · `memory_events` · `moods` · `journals` · `day_profiles` · `badges` · `journey_enrollments` · `schedule_candidates` · `practice_completions` · `outreach` · `password_reset_tokens`
