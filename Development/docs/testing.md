# William 测试方案：一眼看懂版

## 0. 先看结论

你们现在不是“没有测试”，而是：

- 已经有不少有价值的测试入口
- 但这些入口还比较分散
- 还没有形成一套清晰的分层验证体系

这份文档的目标是把测试体系整理成：

- 改什么功能，就知道该跑什么
- 哪些测试应该放在 `tests/`
- 哪些改动不可能只发生在 `tests/`
- 提交前最低该验证到什么程度

---

## 1. 一个原则先说清楚

### 测试代码大部分应该放在 `tests/`

对，**测试本体**尽量应该放在 `tests/` 里，包括：

- smoke test
- review / replay 脚本
- fixture
- mock 输入
- golden case

例如：

- `tests/smoke/*`
- `tests/review/*`
- `tests/fixtures/*`

### 但测试相关改动不可能只发生在 `tests/`

因为一个完整的测试入口通常还会牵涉：

- `package.json` 里的脚本入口
- `README.md` / `docs/*` 里的验证说明
- 少量为了可测性而加的 service 导出
- 少量 debug / audit 接口

所以更准确地说：

| 类型 | 建议放哪 |
| --- | --- |
| 测试脚本本体 | `tests/` |
| fixture / 样本输入 | `tests/fixtures/` |
| smoke / review shell 脚本 | `tests/` |
| 测试命令入口 | `backend/package.json` / `frontend/package.json` |
| 测试说明文档 | `docs/` 或 `tests/README.md` |
| 为了测试暴露的少量函数 | 对应 `src/services/*` |

一句话：

`测试主体尽量进 tests，但测试体系本身不会只改 tests。`

---

## 2. 现在已有的测试入口

当前仓库里已经有这几类：

### 结构审计

- `npm run audit:prompt`
- `npm run audit:memory`
- `npm run audit:schedule`
- `npm run audit:retrieval-intent`
- `npm run audit:intervention-signals`
- `npm run audit:wellbeing-schema`

### 真实评审

- `npm run review:real`

### 音频 smoke

- `tests/smoke/voice-smoke.sh`
- `tests/smoke/ambient-listening-audio-smoke.sh`
- `tests/smoke/voice-negative-smoke.sh`

这些入口本身是有价值的，问题不在“要不要删”，而在：

- 还缺少分层
- 还缺某些关键场景
- 团队还不够容易一眼知道“改这个该跑哪个”

---

## 3. 我建议的测试分层

建议把测试体系明确分成 4 层。

## 3.1 快速层：开发时立刻跑

目标：

- 改完马上知道有没有明显坏掉

适合放进这层的：

- `node --check`
- `tsc --noEmit`
- 最小模块 smoke

适用场景：

- 改单个 route
- 改单个 service
- 改 schema self-heal
- 改 prompt 逻辑

一句话：

`这层测“有没有立刻炸”。`

---

## 3.2 结构层：系统行为审计

目标：

- 确认 wiring 没坏
- 确认 memory / prompt / schedule 这些系统层逻辑还成立

当前对应入口：

- `audit:prompt`
- `audit:memory`
- `audit:schedule`

适合放在这层的内容：

- memory 提取和 promotion
- prompt 装配
- intervention 假阳性
- retrieval intent
- schedule worthiness

一句话：

`这层测“系统逻辑是不是还对”。`

---

## 3.3 集成层：真实 HTTP 主链路

目标：

- 确认 API 真能通
- 确认多模态主链路真能跑完

当前已有：

- voice smoke
- ambient listening audio smoke
- `today` smoke

还应该逐步补：

- chat main flow smoke
- memory center smoke
- `/api/user/today` smoke
- schema self-heal smoke

一句话：

`这层测“真实接口链路是不是通的”。`

---

## 3.4 产品层：真实对话评审

目标：

- 判断最后说出来的话像不像一个有效产品

当前对应入口：

- `review:real`

它适合：

- 重要回复策略改动后跑
- 关键体验场景回归
- 评估“更自然了还是更机械了”

它不适合：

- 承担所有自动回归职责
- 替代结构测试

一句话：

`这层测“产品效果好不好”。`

---

## 4. 现在最需要补的测试

按优先级，我建议补这几项。

## P0：Wellbeing schema self-heal smoke

你刚刚已经踩到了真实问题：

- 服务能起来
- 但数据库缺表
- `/api/user/today` 一直报错

所以现在最应该补的是：

- 空库 / 旧库下启动
- `ensureWellbeingSchema()` 能补齐关键表
- `/api/user/today` 不再因为缺表报错

这是当前最现实、最值的测试。

---

## P1：`detectRetrievalIntent` 回归测试

因为它会影响：

- 读什么 memory
- prompt 怎么装
- support rule 怎么走
- behavior override 会不会触发

这层如果错了，后面很多行为都会跟着歪。

建议单独拉出测试矩阵，例如：

- `我想和老板聊聊怎么转岗`
- `我最近睡不好，也不知道怎么跟老板说请假`
- `你还记得我刚刚卡在哪吗`
- `我今天下午三点开会`

---

## P1：Intervention 假阳性测试

当前最需要重点盯的关键词：

- `呼吸`
- `边界`
- `今晚`
- `可以`
- `行`

这些词单独出现时特别容易误标。

建议补：

- 正样本
- 负样本
- 边界样本

---

## P2：Today / You / Journey 关键接口 smoke

这些页面越来越重，但最容易因为：

- feed 拼装
- schema 缺字段
- 新表没建

而出问题。

尤其建议补：

- `/api/user/today`
- `/api/user/insights`
- `/api/journey/*`

现在已经补上的关键入口：

- `cd backend && npm run audit:retrieval-intent`
- `cd backend && npm run audit:intervention-signals`
- `cd backend && npm run audit:wellbeing-schema`
- `cd backend && npm run smoke:today`
- `cd backend && npm run smoke:insights`
- `cd backend && npm run smoke:journey`
- `cd backend && npm run smoke:all`

---

## 5. 建议哪些东西放进 `tests/`

下面这些应该尽量往 `tests/` 收：

### 应该放在 `tests/`

- smoke shell 脚本
- review 脚本
- fixture 输入
- replay case
- expected snapshots

### 不一定放在 `tests/`

- `backend/scripts/*.js` 这类 audit 脚本  
  这类更像“系统审计入口”，放在 `backend/scripts` 也合理，但最好由 `package.json` 提供统一命令。

- `package.json` 中的测试脚本入口

- `docs/*` 中的测试说明

### 一个现实建议

如果你希望结构更统一，后面可以逐步把：

- `backend/scripts/promptAudit.js`
- `backend/scripts/memoryAudit.js`
- `backend/scripts/scheduleAudit.js`

迁到例如：

- `tests/audit/promptAudit.js`
- `tests/audit/memoryAudit.js`
- `tests/audit/scheduleAudit.js`

但这不是最高优先级。  
当前更重要的是先把测试覆盖补完整，而不是先搬目录。

---

## 6. 哪些测试产物不应该长期提交

像这种更像运行结果而不是稳定 fixture 的内容：

- `tests/fixtures/review-dryrun/review-results.json`
- `tests/fixtures/review-dryrun/review-scorecard.md`
- `tests/fixtures/review-dryrun/review-transcript.md`

要谨慎。

建议默认策略：

- 保留输入样本
- 不默认提交每次运行产物
- 除非它们被明确当成 golden snapshot 使用

一句话：

`测试输入应该稳定，测试输出不应该默认进仓库。`

---

## 7. 建议增加统一命名

现在命令入口有价值，但还不够统一。

建议逐步整理成这种风格：

- `test:quick`
- `test:audit`
- `test:smoke`
- `test:review`

例如：

- `npm run test:quick`
- `npm run test:audit:memory`
- `npm run test:smoke:voice`
- `npm run test:review:real`

这样团队成员不用记很多零散命令。

---

## 8. 提交前最低验证建议

### 改普通后端逻辑

至少跑：

- `node --check`
- 对应模块的最小 smoke 或 audit

### 改聊天 / memory / prompt 主链路

至少跑：

- `node --check`
- `audit:memory`
- `audit:prompt`
- 至少一条真实 chat smoke

### 改音频链路

至少跑：

- `node --check`
- 对应 voice smoke
- 至少一条 negative smoke

### 改 wellbeing / today / schema

至少跑：

- `node --check`
- schema self-heal smoke
- `/api/user/today` smoke

---

## 9. 最后一句判断

现在不是要推翻你们已有测试，而是要把它们从：

- 一批分散工具

整理成：

- 有分层
- 有优先级
- 有入口
- 有对应场景

一句话总结：

`测试主体应该尽量放在 tests/，但测试体系不会只改 tests/；现在最值得补的是 schema/self-heal 和关键主链路 smoke。`
