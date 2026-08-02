# Review

这里放需要人工评估的真实对话评审工具。

当前包含：

- `run-real-review.sh`
  - 用 shell + curl 真实调用本地 `POST /api/chat/message`
  - 适合当前测试环境，行为和 smoke tests 一致
- `realConversationReview.js`
  - 负责生成 transcript、Markdown 评分表和 CSV 评分表
  - 支持 `--dry-run` 和 `--results`
  - 默认样本在 `tests/fixtures/real-conversation-review.sample.json`

建议用途：

- 在算法审计通过后，做更接近真实产品体验的人工 review
- 比较不同 prompt / memory 策略前后的回复质量
- 把“感觉 William 变怪了”变成可追踪的评分记录
