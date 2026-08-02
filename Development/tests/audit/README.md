# Audit Tests

这个目录放可重复执行的结构性审计脚本。

它们主要验证：

- 路由和分类有没有明显回归
- schema self-heal 能不能扛住旧库/空库
- 关键词规则会不会产生明显假阳性

当前脚本：

- `retrievalIntentAudit.js`
- `interventionSignalsAudit.js`
- `wellbeingSchemaAudit.js`
