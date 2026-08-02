┌──────────────┐
│  Knowledge   │  ← LightRAG（事实 / 观点）
└──────┬───────┘
       ↓
┌──────────────┐
│  Raw Answer  │  ← 中性、保守、不模仿 (query功能)
└──────┬───────┘
       ↓
┌──────────────┐
│ Style Profile│  ← LLM 从 .txt（对话历史）中总结出来说话风格
└──────┬───────┘
       ↓
┌──────────────┐
│ Style Rewrite│  ← 按这个人的说话风格改写
└──────────────┘


Lightrag具体函数实现为：

ingest(input_path: str, working_dir: str, output_dir: str, device: str = "cpu")

query(question: str, working_dir: str, mode: str = "mix")

每个人都应该有自己的working_dir和output_dir

使用时首先:

export OPENAI_API_KEY="sk-...your_opeai_key..."

然后通过CLI调用两个函数

使用示例 （数据: ./data/test1.pdf, ./data/test2.jpg）

**** 知识库构建

往知识库中批量加入一个目录:（每次都可以直接把数据文件夹丢过去，因为不会重复处理同一个文件）

uv run python rag_factory.py ingest ./data --working-dir ./lightrag_storage/boris --output-dir ./output/boris

或者往知识库中加入一个文件:

uv run python rag_factory.py ingest ./data/test1.pdf --working-dir ./lightrag_storage/boris --output-dir ./output/boris

**** 问答

普通查询:
uv run python rag_factory.py query "introduce boris song to me" --working-dir ./lightrag_storage/boris

** 说话风格提取（从对话历史 .txt 生成风格文件）
uv run python style_rewrite.py extract ./chat_logs/boris.txt --output ./lightrag_storage/boris/boris_style.txt
** 带风格重写的查询:
uv run python rag_factory.py query "introduce boris song to me" --working-dir ./lightrag_storage/boris --style-path ./lightrag_storage/boris/boris_style.txt
