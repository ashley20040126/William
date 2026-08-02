# William 记忆系统：一眼看懂版

## 0. 先看结论

William 现在不是“用户说一句话，我就直接记住”。

它现在的实际逻辑是：

`用户消息 -> 判断这轮是什么场景 -> 决定要读哪些上下文 -> 生成回复 -> 再判断这轮里有没有值得长期记住的内容`

记忆系统的核心目标只有两个：

- 回复时，尽量用上真正相关的上下文
- 写入时，尽量别把不该记的内容写进长期记忆

---

## 1. 一条消息到底怎么流转

### 极简流程

```text
用户发消息
  ↓
chatService
  ↓
基础分析（情绪 / 压力 / 模式）
  ↓
composePromptContext
  ├─ 取显式档案 users
  ├─ 取最近状态 day_profiles
  ├─ 取长期记忆 user_memories
  ├─ 取进行中事项 user_active_loops
  └─ 取支持方式偏好 user_intervention_preferences
  ↓
ai.js 组装最终 prompt
  ↓
模型回复
  ↓
回写数据库
  ├─ chat_messages
  ├─ day_profiles
  ├─ intervention_outcomes
  ├─ user_memories / user_active_loops
  └─ schedule_candidates
```

### 对应主文件

| 阶段 | 主要文件 | 作用 |
| --- | --- | --- |
| 聊天入口 | [chatService.js](../backend/src/services/chatService.js) | 收消息、写消息、调上下文、调模型、回写结果 |
| Prompt 组装 | [composePromptContext.js](../backend/src/services/prompting/composePromptContext.js) | 决定这轮该读哪些上下文 |
| 最终回复 | [ai.js](../backend/src/services/ai.js) | 把 system prompt 拼好，再请求模型 |
| 长期记忆 | [memoryService.js](../backend/src/services/memoryService.js) | 读取记忆、写入记忆、排序记忆 |
| 记忆分类 | [memoryClassifierService.js](../backend/src/services/memoryClassifierService.js) | 用模型判断一句话该不该记、记成什么 |
| 支持路由 | [mentalSupportService.js](../backend/src/services/mentalSupportService.js) | 判断要不要进心理支持模块、进哪个模块 |
| 干预记录 | [interventionService.js](../backend/src/services/interventionService.js) | 记录什么支持方式似乎更有效 |

---

## 2. 系统到底“记什么”

William 现在主要记 4 类东西：

| 层 | 表 | 记的是什么 | 举例 |
| --- | --- | --- | --- |
| 显式档案 | `users` | 用户主动填写或设置的内容 | 名字、语言、偏好 |
| 长期记忆 | `user_memories` | 相对稳定的事实和偏好 | 在准备转岗、沟通偏好更直接 |
| 进行中事项 | `user_active_loops` | 正在推进或反复卡住的事 | 还没和老板开口、睡眠恢复中 |
| 日级状态 | `day_profiles` | 最近几天的情绪/压力/主题变化 | 这几天聊天压力偏高 |

最重要的区别是：

- `user_memories`：更像“这个人长期是什么样”
- `user_active_loops`：更像“这个人现在正在卡什么”

---

## 3. 一句话为什么会被记住

### 真实逻辑不是一步，而是三步

```text
一句用户话
  ↓
第一层：Hard Filter
  ↓
第二层：Memory Classifier
  ↓
第三层：Write Policy
  ↓
决定：
- 不记
- 先放候选池
- 直接升为正式记忆
```

### 第一步：Hard Filter

这一层是规则型，主要负责拦截明显不该记的句子。

典型会被拦掉的内容：

- 提问句
- 假设句
- 纯引用
- 转述别人说的话
- 很短、很泛的情绪句
- 明显只是“看这个文件/链接”的追问

一句话理解：

`Hard Filter` 负责“什么不能记”。

### 第二步：Memory Classifier

这一层是模型辅助，负责判断这句话在语义上是什么。

它只允许输出两类结果：

- `memory`
- `active_loop`

#### 当前允许的 `memoryType`

- `goal`
- `preference`
- `relationship`
- `support_style`
- `trigger`
- `problem_pattern`
- `action_history`
- `emotional_state`

#### 当前允许的 `activeLoopType`

- `goal_process`
- `difficult_conversation`
- `sleep_recovery`
- `upcoming_commitment`
- `emotional_cycle`

一句话理解：

`Memory Classifier` 负责“这句话到底是什么”。

### 第三步：Write Policy

模型说“值得记”，系统也不一定立刻写进长期记忆。

现在的策略是：

- 高置信度：直接写
- 中等置信度：先写入 `memory_candidates`
- 后续重复出现：再 promotion

对 `active_loop` 还有一个最近刚明确收紧过的原则：

- 规则层不再因为“自己没检测到 loop”就把模型识别出的 loop 全部清空
- 如果规则层也检测到了同类 loop，它现在只作为增强信号，提高模型候选的置信度
- 最终是否能正式写入，仍然由 promotion 阈值决定

这意味着当前 active loop 的职责关系已经明确成：

- 模型负责判断“这是不是一个进行中的事项”
- 规则负责补充佐证，而不是一票否决

一句话理解：

`Write Policy` 负责“现在该不该正式记进去”。

---

## 4. 回复前到底会读哪些信息

回复前，系统不会把所有东西一股脑塞进 prompt。

它会先判断这轮大概是什么场景，也就是 `retrievalIntent`。

### 常见场景

| intent | 代表什么 |
| --- | --- |
| `general_support` | 普通支持、普通聊天 |
| `file_or_url_followup` | 追问文件、链接、附件 |
| `memory_audit` | 用户在问“你还记得吗” |
| `schedule_logistics` | 日程、安排、时间相关 |
| `active_problem_solving` | 用户明确要方案、下一步 |
| `relationship_conversation` | 关系/边界/沟通类问题 |
| `sleep_recovery` | 睡眠问题 |

### 不同场景读的东西不一样

| 场景 | 重点读什么 | 默认少读什么 |
| --- | --- | --- |
| `file_or_url_followup` | 附件上下文 | 最近状态 |
| `memory_audit` | 记忆、active loops | 最近状态 |
| `schedule_logistics` | 时间和安排线索 | 最近状态 |
| `general_support` | 紧凑版 profile + 紧凑版 state | 大段历史记忆 |
| `active_problem_solving` | relevant memory + active loops | 无关的情绪背景 |
| `relationship_conversation` | 关系相关记忆 + active loops | 无关的附件上下文 |
| `sleep_recovery` | 睡眠相关支持规则 | 复杂关系背景 |

一句话理解：

`composePromptContext` 负责“这轮该读什么，不该读什么”。

---

## 5. 最终 prompt 是怎么拼的

最终拼接在 [ai.js](../backend/src/services/ai.js)。

### 当前默认顺序

| 场景 | 顺序 |
| --- | --- |
| `file_or_url_followup` | `attachment -> memory -> support` |
| `memory_audit` | `memory -> attachment -> support` |
| 其他 | `support -> memory -> attachment` |

### 当前额外有少量“本轮行为覆盖”

这部分是最近加的，但刻意控制得很少，不让它无限膨胀。

当前主要覆盖 4 类场景：

| 场景 | 当前覆盖目标 |
| --- | --- |
| `memory_audit` | 优先直接复述记住的事实 |
| `active_problem_solving` | 用户明确要求直接时，优先给下一步动作 |
| `relationship_conversation` | 用户问“怎么开口”时，优先给可直接说的话术 |
| `sleep_recovery` | 优先给一个现在或今晚就能做的小动作 |

为什么要有这层？

因为我们真实评测后发现，模型默认太容易：

- 先共情
- 再追问
- 最后才给动作

但有些场景里，用户真正要的是：

- 先给下一步
- 先给话术
- 先给一个即时动作

---

## 6. intervention 是什么

这一层不是“记忆”，而是“William 觉得什么支持方式对你更有用”。

主要表：

- `intervention_outcomes`
- `user_intervention_preferences`

### 当前会记录的 intervention 类型

- `grounding`
- `breathing`
- `journaling`
- `reframing`
- `difficult_conversation_script`
- `task_breakdown`
- `sleep_reset`
- `boundary_prompt`
- `reflection_question`

### 它的逻辑很简单

```text
助手给了某种支持方式
  ↓
系统记录下来
  ↓
之后观察：
- 用户是否接受
- 用户是否执行
- 后续有没有看起来更好一些
  ↓
形成一个弱监督偏好总结
```

要注意：

- 它不是严格疗效评估
- 它只是“方向性经验总结”

---

## 7. 什么是规则型，什么是模型辅助

### 应该继续规则型的

- question / hypothetical / quote 过滤
- dedupe
- canonical key
- promotion threshold
- safety hard block
- 日期时间归一化

### 适合模型辅助的

- 这句话是否值得记
- 是长期记忆还是 active loop
- 属于哪种 memoryType / activeLoopType
- 内部摘要怎么写得自然

### 当前仍然偏启发式的

- 支持模块路由
- intervention 检测
- outcome attribution

一句话总结：

`规则保底，模型判义。`

补充一条当前已经落地的实现原则：

- 对 active loop 来说，规则层现在已经从“否决者”改成了“增强者”
- 但对部分 memory type，仍然还有少量规则型纠偏逻辑存在，后续仍可继续审计和收紧

---

## 8. 测试到底在测什么

现在有 4 类测试/评审入口：

| 命令 | 主要脚本 | 测什么 |
| --- | --- | --- |
| `npm run audit:prompt` | [promptAudit.js](../backend/scripts/promptAudit.js) | prompt 注入、memory 抽取、support routing 是否乱 |
| `npm run audit:memory` | [memoryAudit.js](../backend/scripts/memoryAudit.js) | 记忆分类 + pending/promoted 策略是否正常 |
| `npm run audit:schedule` | [scheduleAudit.js](../backend/scripts/scheduleAudit.js) | 日程提取是否太机械 |
| `npm run review:real` | [run-real-review.sh](../tests/review/run-real-review.sh) | 真实对话回复效果如何 |

### 8.1 `audit:prompt`

它主要测结构问题：

- memory 有没有误抽
- 有没有漏抽
- support routing 有没有明显误判
- 某些场景是否被错误注入了不相关 prompt

它回答的问题是：

`系统 wiring 对不对？`

不是：

`回复是不是足够好？`

### 8.2 `audit:memory`

它专门测记忆写入策略：

- 模型高置信度时能否直接写入
- 中等置信度是否先 pending
- 重复后能否 promotion
- 模型不可用时，规则 fallback 是否还能工作

它回答的问题是：

`记忆写入逻辑稳不稳？`

### 8.3 `audit:schedule`

它主要防这种低质量行为：

- 看到“今天”“明天”就自动生成候选

例如：

- `我今天要打球`：不该自动生 candidate
- `我今天下午3-5要去体育馆打球`：应该生 candidate

### 8.4 `review:real`

这是最重要的一套，因为它测的是真实回复。

它会：

1. 创建 guest 用户
2. 更新 profile
3. 逐条调用真实 `/api/chat/message`
4. 记录真实回复
5. 生成：
   - `review-results.json`
   - `review-transcript.md`
   - `review-scorecard.md`
   - `review-scorecard.csv`

它回答的问题是：

`William 最终说出来的话到底像不像一个有效产品？`

---

## 9. 现在真实跑出来的问题是什么

### 结构层

目前大体是过线的：

- 记忆不会明显乱飞
- schedule 不再像以前那样机械
- prompt 注入没有明显串场

### 效果层

问题主要还在回复质量，不在 memory wiring。

最近真实评审后，当前状态更像这样：

| 场景 | 当前状态 |
| --- | --- |
| `direct_problem_solving` | 比以前更直接了，但还不够利落 |
| `difficult_conversation` | 已经开始给话术了，但还偏模板 |
| `sleep_recovery` | 已经开始给小动作了，但动作还偏泛 |
| `memory_audit` | 已经可接受，不是当前最优先的问题 |

所以现在真正该盯的是：

`高价值支持场景的回复质量`

而不是：

`记忆有没有完全失控`

---

## 10. 这套系统现在最真实的评价

### 做得不错的地方

- 记忆写入已经比以前受控很多
- 已经区分了长期记忆和进行中事项
- prompt 不再是无脑全量堆叠
- 已经有真实 transcript 评审工具，不再只靠感觉

### 还没做好的地方

- direct problem-solving 还不够果断
- difficult conversation 还不够自然
- sleep recovery 还不够贴夜间当下
- support routing 仍然有规则复杂度风险
- intervention efficacy 仍然只是弱监督

一句话评价：

`现在的 William 不是乱，但还没有足够好。`

---

## 11. 如果只想快速读代码，按这个顺序

1. [chatService.js](../backend/src/services/chatService.js)
2. [composePromptContext.js](../backend/src/services/prompting/composePromptContext.js)
3. [ai.js](../backend/src/services/ai.js)
4. [memoryService.js](../backend/src/services/memoryService.js)
5. [memoryClassifierService.js](../backend/src/services/memoryClassifierService.js)
6. [interventionService.js](../backend/src/services/interventionService.js)
7. [promptAudit.js](../backend/scripts/promptAudit.js)
8. [memoryAudit.js](../backend/scripts/memoryAudit.js)
9. [realConversationReview.js](../tests/review/realConversationReview.js)

---

## 12. 最后一句原则

后续不要默认继续加层。

任何新改动都应该先问一个问题：

`它会不会让真实 transcript 更好，而不是只让系统更复杂？`
