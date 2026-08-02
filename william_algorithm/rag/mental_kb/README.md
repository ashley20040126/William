William 心理知识库 V1

目录说明：

- `safety/risk_policy.json`
  - 高风险表达、危机分流和资源提示
- `modules/*.json`
  - 面向 `Digital Expert` 的结构化心理支持模块

设计原则：

- 使用权威来源做底座：WHO、NICE、VA、988 Lifeline
- 不做“心理学百科全量 RAG”，先做高频场景模块
- 不让模型自由决定专业路径，而是先做 `risk -> module -> response`

当前 V1 首批模块：

- `anxiety_escalation`
- `rumination`
- `difficult_conversation`
- `boundaries_relationship`
- `sleep_disruption`
- `low_mood_inertia`

注意：

- 这些模块用于日常心理支持与反思，不用于医疗诊断
- 如果命中高风险内容，应优先走 `risk_policy`，而不是继续普通 reflective coaching
