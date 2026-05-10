# Claude Memory System

PIA 项目的工程化记忆系统，遵循 **Hermes 工程化思维：记录、积累、传承、演进**。

## 快速开始

### 1. 初始化记忆系统

记忆系统已创建，文件结构如下：

```
.claude/memory/
├── SESSION.md          # 会话记忆（短期）
├── DECISIONS.md        # 架构决策记录（长期）
├── PITFALLS.md         # 踩坑记录（长期）
├── PATTERNS.md         # 最佳实践模式（长期）
└── GLOSSARY.md         # 项目术语表（长期）
```

### 2. 安装 Git Hook（自动化记录）

```bash
# 复制 hook 到 .git/hooks/
cp .claude/hooks/post-commit .git/hooks/post-commit

# Windows (Git Bash)
chmod +x .git/hooks/post-commit
```

安装后，每次 `git commit` 会自动记录重要提交到 `SESSION.md`。

### 3. 开发前必读

在开始新功能开发前，请先阅读：

1. **[DECISIONS.md](memory/DECISIONS.md)** - 了解架构决策背景
2. **[PITFALLS.md](memory/PITFALLS.md)** - 避免重复踩坑
3. **[PATTERNS.md](memory/PATTERNS.md)** - 参考最佳实践
4. **[GLOSSARY.md](memory/GLOSSARY.md)** - 统一术语表达

---

## 记忆系统详解

### SESSION.md - 会话记忆

**作用**：记录当前开发会话的改动总结，方便下次快速上下文切换。

**写入时机**：
- 每次 AI 完成重要功能后自动总结
- 每次 Git commit（通过 Hook 自动记录）
- 会话结束时人工补充"下次继续"

**清理策略**：
- 超过 7 天的会话自动归档
- 保留最近 5 次会话记录

**示例**：
```markdown
# Session: 2026-05-03

## 改动总结
- [frontend] 添加 SI 附件自动下载功能
- [backend] 优化 PDF 解析线程池配置

## 下次继续
- [ ] 实现 PDF 流式解析
- [ ] 添加单元测试
```

---

### DECISIONS.md - 架构决策记录

**作用**：记录重要的技术选型和架构决策，**重点记录"为什么"**。

**写入时机**：
- 做出重要技术选型时
- 放弃某个方案时
- 架构发生重大调整时

**格式**：采用 ADR (Architecture Decision Record) 风格

**示例**：
```markdown
## ADR-001: 选择 SSE 而非 WebSocket

### 背景
前端需要实时接收 PDF 解析进度...

### 决策
采用 SSE。

### 理由
1. 只需要服务端推送，不需要双向通信
2. 实现简单，自动重连
3. 兼容性好

### 后果
- ✅ 代码简洁
- ⚠️ 无法实现双向通信
```

**已记录的决策**：
- ADR-001: 选择 Tauri 而非 Electron
- ADR-002: 选择 SSE 而非 WebSocket
- ADR-003: 放弃 Redis/Celery，使用 ThreadPoolExecutor
- ADR-004: 选择 SQLite 而非 PostgreSQL
- ADR-005: 两阶段 AI Pipeline 设计

---

### PITFALLS.md - 踩坑记录

**作用**：记录开发中遇到的坑、错误、陷阱，**重点记录"如何避免"**。

**写入时机**：
- 遇到 Bug 并找到根本原因后
- 发现容易犯错的 API 或库使用方式
- 用户反馈的问题

**格式**：
```markdown
## PITFALL-001: SSE 连接未关闭导致内存泄漏

### 问题描述
组件卸载时未关闭 EventSource...

### 触发条件
用户在解析过程中点击"返回"按钮...

### 解决方案
```typescript
return () => { eventSource.close(); }
```

### 预防措施
1. 代码审查清单
2. Lint 规则
3. 文档约束
```

**已记录的踩坑**：
- PITFALL-001: SSE 连接未关闭导致内存泄漏
- PITFALL-002: SQLite 并发写入导致数据库锁定
- PITFALL-003: 钙钛矿组分识别错误
- PITFALL-004: 异步状态更新竞态条件
- PITFALL-005: 单位换算错误

---

### PATTERNS.md - 最佳实践模式

**作用**：记录成功的代码模式、设计模式，供后续开发复用。

**写入时机**：
- 发现一个可复用的成功模式
- 重构后提炼出最佳实践
- 解决 PITFALL 后形成的固定模式

**已记录的模式**：
- PATTERN-001: API 调用封装模式
- PATTERN-002: SSE 连接管理模式
- PATTERN-003: 线程安全的任务状态管理
- PATTERN-004: React 状态提升模式
- PATTERN-005: 数据验证与清洗模式

---

### GLOSSARY.md - 项目术语表

**作用**：统一项目中的专业术语、缩写、变量命名。

**内容**：
- 钙钛矿领域术语（PCE, Voc, Jsc, FF 等）
- 项目代码术语（doi, metrics, evidence 等）
- 技术栈术语（SSE, API, WAL 等）
- 变量命名约定
- 期刊缩写

---

## 使用指南

### 开发新功能时

1. **查阅 PATTERNS.md**：参考最佳实践模式
2. **查阅 PITFALLS.md**：避免重复踩坑
3. **查阅 DECISIONS.md**：了解现有架构决策
4. 开发完成后，考虑是否需要更新记忆文件

### 遇到问题时

1. **查阅 PITFALLS.md**：检查是否已有记录
2. 解决后，评估是否值得记录：
   - 是否可能反复出现？
   - 是否难以排查？
   - 如果是，记录到 PITFALLS.md

### 做出重要决策时

1. 在 DECISIONS.md 中记录：
   - 背景是什么？
   - 考虑了哪些方案？
   - 为什么选择这个方案？
   - 有什么后果？

---

## 维护指南

### 定期清理（每月）

```bash
# 查看 SESSION.md 大小
wc -l .claude/memory/SESSION.md

# 如果超过 500 行，手动归档
mkdir -p .claude/memory/archive
mv .claude/memory/SESSION.md .claude/memory/archive/SESSION_$(date +%Y%m).md
touch .claude/memory/SESSION.md
```

### 价值评估（每季度）

评估每个记忆条目的价值：
- **高频使用** → 保留
- **低频但有价值** → 保留
- **过时/低价值** → 删除或归档

### Code Review 时

检查以下问题：
- [ ] 是否需要更新 DECISIONS.md？
- [ ] 是否遇到新的踩坑需要记录？
- [ ] 是否发现了新的最佳实践模式？
- [ ] 是否使用了新的术语需要定义？

---

## 快速查询

### 查询所有踩坑记录
```bash
grep -n "PITFALL-" .claude/memory/PITFALLS.md
```

### 查询特定关键词
```bash
grep -rn "SSE" .claude/memory/
```

### 查看最近会话
```bash
head -100 .claude/memory/SESSION.md
```

### 查询架构决策
```bash
grep -n "ADR-" .claude/memory/DECISIONS.md
```

---

## 与 Git 的区别

| 维度 | Git Commit | 记忆系统 |
|------|-----------|----------|
| 记录内容 | 改了什么（What） | 为什么改（Why）+ 如何避免（How） |
| 查询目的 | 版本回溯 | 知识复用 |
| 信息密度 | 低（每次提交都记录） | 高（仅记录有价值的信息） |
| 时间跨度 | 短期（当前状态） | 长期（经验积累） |

---

## 进阶技巧

### 1. AI 助手集成

在 CLAUDE.md 中添加引用：

```markdown
## 开发前必读

在开始新功能开发前，请先阅读：
1. `memory/DECISIONS.md` - 了解架构决策背景
2. `memory/PITFALLS.md` - 避免重复踩坑
3. `memory/PATTERNS.md` - 参考最佳实践
```

### 2. VSCode 集成

创建 `.vscode/tasks.json`：

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "View Pitfalls",
      "type": "shell",
      "command": "code .claude/memory/PITFALLS.md"
    },
    {
      "label": "View Decisions",
      "type": "shell",
      "command": "code .claude/memory/DECISIONS.md"
    }
  ]
}
```

### 3. 自动化脚本

创建 `scripts/memory.sh`：

```bash
#!/bin/bash
# 快速查询记忆

case $1 in
    "pitfalls")
        cat .claude/memory/PITFALLS.md
        ;;
    "decisions")
        cat .claude/memory/DECISIONS.md
        ;;
    "search")
        grep -rn "$2" .claude/memory/
        ;;
    *)
        echo "Usage: ./memory.sh [pitfalls|decisions|search <term>]"
        ;;
esac
```

---

## 贡献指南

### 记录踩坑

1. 在 `PITFALLS.md` 中添加新条目
2. 按照模板填写
3. 提交时在 commit message 中标注：`docs(pitfall): 添加 XX 踩坑记录`

### 记录决策

1. 在 `DECISIONS.md` 中添加新条目
2. 编号递增（ADR-XXX）
3. 提交时在 commit message 中标注：`docs(decision): 添加 ADR-XXX`

### 记录模式

1. 在 `PATTERNS.md` 中添加新条目
2. 包含完整代码示例
3. 提交时在 commit message 中标注：`docs(pattern): 添加 XX 模式`

---

## 参考资料

- [Architecture Decision Records](https://adr.github.io/)
- [Hermes Engineering Philosophy](https://hermes.engineering/)
- [CLAUDE.md - 开发约束指令](../CLAUDE.md)
