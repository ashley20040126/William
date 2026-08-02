# William 全栈集成开发计划 (Master DEV_PLAN)

本计划旨在通过分阶段迭代，将基于 LLM 的数字专家 RAG 系统集成到 William 前端应用中，实现真正具备领域知识和个性化风格的专家对话体验。

---

## 版本 1.0：最小可行性集成 (MVP)
**目标**：打通前后端链路，实现单个专家 (`ZhengyuLuo`) 的 RAG 对话功能。前端不再直接调用 Gemini Mock 专家，而是通过 Django API 获取 RAG 增强的回答。

### [TASK001] 后端专家配置与 API 暴露
*   **版本**：1.0
*   **状态**：计划中
*   **子任务**：
    1.  **迁移/配置专家数据**: 在 Django 中配置 `ZhengyuLuo` 专家。
    2.  **验证 RAG 路径**: 确保 `ZhengyuLuo` 的知识库路径 (`rag_storage/ZhengyuLuo`) 和风格文件路径 (`styles/coach_style.txt` 或新建) 正确映射。
    3.  **创建专家列表 API**: 编写 Django 视图，返回专家列表 JSON，供前端动态加载。

*   **详细规范**:
    *   **文件**: `source/django_expert_bot/chat/experts.py`
    *   **变更**:
        *   清除旧 Mock 数据。
        *   添加 `ZhengyuLuo` 实例。
        *   确保 `storage_dir` 指向 `../../source/rag/rag_storage/ZhengyuLuo` (需处理相对路径)。
    *   **文件**: `source/django_expert_bot/chat/views.py`
    *   **变更**: 添加 `@api_view(['GET']) def get_experts_list(request)`。

### [TASK002] 后端 RAG 服务调用链优化
*   **版本**：1.0
*   **状态**：计划中
*   **子任务**：
    1.  **修正 Import 路径**: 解决 `django_expert_bot` 调用 `source/rag` 模块时的路径引用问题。
    2.  **封装异步服务**: 确保 `ai_service.py` 正确调用 `rag.py` 的 `query` 函数。
    3.  **日志与降级**: 添加日志记录 RAG 耗时；如果 RAG 失败（如目录为空），降级到纯 GPT 回答。

*   **详细规范**:
    *   **文件**: `source/django_expert_bot/chat/services/ai_service.py`
    *   **变更**:
        *   `sys.path.append` 添加 `source/rag` 以支持导入。
        *   使用 `async` 处理 `get_llm_response`。
        *   RAG 调用参数: `working_dir` (expert storage), `style_path` (expert style), `mode='mix'`.

### [TASK003] 前端 API 客户端适配
*   **版本**：1.0
*   **状态**：计划中
*   **子任务**：
    1.  **新建 API Service**: 在前端创建 `services/apiService.ts`。
    2.  **对接专家列表**: `App.tsx` 启动时从 `/api/experts/` 获取列表，替换 `MOCK_EXPERTS`。
    3.  **对接聊天接口**: `TwinChat.tsx` 发送消息时调用后端 `/api/chat/`。

*   **详细规范**:
    *   **文件**: `William_Rob/services/apiService.ts` (New)
    *   **文件**: `William_Rob/App.tsx` (Modify State Initialization)
    *   **文件**: `William_Rob/components/TwinChat.tsx` (Modify `handleSendMessage`)

---

## 版本 2.0：多专家与多模态扩展
**目标**：扩展专家库，支持不同领域的专家，并恢复前端的多模态能力（语音、图片）。

### [TASK004] 多专家数据构建
*   **状态**：待定
*   **任务**: 编写数据摄入脚本；配置 Alistair (物理), Sarah (经济) 等专家。

### [TASK005] 风格化引擎增强
*   **状态**：待定
*   **任务**: 优化 `style_rewrite.py`，支持动态 Context 注入。

---

## 版本 3.0：高级功能（图谱联动与课程生成）
**目标**：恢复前端的高级功能，让后端支持图谱数据生成和课程生成。

### [TASK006] 知识图谱后端支持
*   **状态**：待定
*   **任务**: 创建 `/api/graph/generate` 接口。

---

## 验收标准清单 (Checklist)
*   [ ] **1.0**: 前端 Expert Directory 显示唯一的 `ZhengyuLuo`。
*   [ ] **1.0**: 前端向 `ZhengyuLuo` 提问，能收到基于 RAG 检索的回答（需预先在该目录放入测试文档）。
*   [ ] **1.0**: 如果 RAG 检索无结果，能收到兜底的 GPT 回答。
*   [ ] **1.0**: 系统无明显延迟卡顿（API 响应 < 5s）。
