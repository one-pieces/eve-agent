# Eve Agent

Eve 内置 11 个工具：`ask_question`、`bash`、`glob`、`grep`、`read_file`、`write_file`、`todo`、`web_fetch`、`web_search`、`load_skill`、`agent`。

## How to Run
### 启动 ChromaDB Server
```bash
npm run run:chromadb
```
## 启动 agent 服务
```bash
npm run dev
```
访问 http://localhost:3000/

# 手动构建索引（命令运行 RAG）
RAG 需要离线 chunk，在使用前需要先构建向量索引

## 启动 ChromaDB Server

```bash
# 安装 chromadb
pip3 install chromadb

# 运行方式 1（推荐）
yarn run:chromadb

# 运行方式 2（需要先把 Python bin 加到 PATH）
# export PATH="$HOME/Library/Python/3.10/bin:$PATH"
# chroma run --path ./rag/data/chroma_data --port 8000
```

## 构建离线索引
```bash
yarn build:index
```

## 问答
```bash
yarn ask "S3 文件什么时候会被删除?"
# or
npx tsx --env-file=.env rag/scripts/ask.ts "S3 文件什么时候会被删除?"
```