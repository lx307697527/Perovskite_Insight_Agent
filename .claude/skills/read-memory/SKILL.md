---
name: read-memory
description: "读取 Memory 文件摘要，包括 DECISIONS、PITFALLS、PATTERNS、GLOSSARY。"
---

# 读取 Memory 摘要

## 触发时机

- 用户想快速了解项目知识库
- 开始新会话时加载上下文
- 用户说"看看 memory"、"有什么决策"、"已知陷阱"时

## 自动执行动作

### 1. 依次读取 Memory 文件

使用 Read 工具读取：
1. `.claude/memory/DECISIONS.md`
2. `.claude/memory/PITFALLS.md`
3. `.claude/memory/PATTERNS.md`
4. `.claude/memory/GLOSSARY.md`

### 2. 提取关键信息

从每个文件提取：
- DECISIONS: 所有 ADR 编号和标题
- PITFALLS: 所有 PITFALL 编号和问题
- PATTERNS: 所有 PATTERN 编号和适用场景
- GLOSSARY: 核心术语列表

### 3. 输出格式

```markdown
## 📚 PIA Memory 摘要

### 🏛️ 架构决策 (DECISIONS.md)

| ADR | 标题 | 状态 | 核心决策 |
|-----|------|------|----------|
| ADR-001 | Tauri vs Electron | ✅ 已采纳 | 选择 Tauri |
| ADR-002 | SSE vs WebSocket | ✅ 已采纳 | 选择 SSE |
| ADR-003 | Redis/Celery vs ThreadPool | ✅ 已采纳 | 选择 ThreadPool |
| ADR-004 | SQLite vs PostgreSQL | ✅ 已采纳 | 选择 SQLite |
| ADR-005 | AI Pipeline 设计 | ✅ 已采纳 | 两阶段设计 |
| ADR-006 | 状态管理策略 | ✅ 已采纳 | useState + Props |
| ADR-007 | 本地缓存策略 | ✅ 已采纳 | DOI 级缓存 |

### ⚠️ 已知陷阱 (PITFALLS.md)

| PITFALL | 问题 | 严重程度 | 预防措施 |
|---------|------|----------|----------|
| PITFALL-001 | SSE 连接未关闭导致内存泄漏 | 高 | useEffect cleanup |
| PITFALL-002 | SQLite 并发写入锁定 | 中 | WAL 模式 + 锁 |
| PITFALL-003 | 钙钛矿组分识别错误 | 高 | 正则提取阳离子 |
| PITFALL-004 | 异步状态更新竞态 | 中 | 函数式更新 |
| PITFALL-005 | 单位换算错误 | 高 | 标准化函数 |

### 📐 最佳实践 (PATTERNS.md)

| PATTERN | 名称 | 适用场景 |
|---------|------|----------|
| PATTERN-001 | API 调用封装 | 前端 API 调用 |
| PATTERN-002 | SSE 连接管理 | 实时数据推送 |
| PATTERN-003 | 任务状态管理 | 并发任务管理 |
| PATTERN-004 | React 状态提升 | 组件间共享状态 |
| PATTERN-005 | 数据验证清洗 | AI 提取数据 |

### 📖 术语表 (GLOSSARY.md)

**钙钛矿领域**:
- PCE: 光电转换效率 (%)
- Voc: 开路电压 (V)
- Jsc: 短路电流密度 (mA/cm²)
- FF: 填充因子 (%)
- SPO: 稳态功率输出

**项目术语**:
- doi: 论文唯一标识符
- metrics: 性能指标数据
- evidence: 数据溯源证据

---
💡 提示: 使用 `/pia-workflow` 开始完整开发流程
```

## 可选参数

- `--decision` : 仅显示 DECISIONS.md
- `--pitfall` : 仅显示 PITFALLS.md
- `--pattern` : 仅显示 PATTERNS.md
- `--glossary` : 仅显示 GLOSSARY.md

## 示例

**用户**: `/read-memory`

**助手**: 输出上述完整摘要

**用户**: `/read-memory --pitfall`

**助手**: 仅输出 PITFALLS.md 详细内容
