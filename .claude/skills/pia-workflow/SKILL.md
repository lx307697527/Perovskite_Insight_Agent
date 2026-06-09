---
name: pia-workflow
description: "PIA 项目开发流程助手。在开始开发任务前调用，自动加载上下文、引导流程、提醒约束。"
---

# PIA 开发流程助手

## 触发时机

- 开始新的开发会话时
- 接到新功能开发任务时
- 需要修复 Bug 时
- 需要进行重构时
- 用户说"开始开发"、"我要实现 xxx"时
- 用户调用 `/pia-workflow` 时

## 自动执行动作

当此 Skill 被调用时，**必须按顺序执行以下动作**：

### 1. 读取 Memory 文件

使用 Read 工具依次读取：
1. `docs/TODO.md` - 待办任务
2. `.claude/memory/DECISIONS.md` - 架构决策
3. `.claude/memory/PITFALLS.md` - 已知陷阱
4. `.claude/memory/PATTERNS.md` - 最佳实践

### 2. 检查 GitNexus 索引

读取 `gitnexus://repo/Perovskite_Insight_Agent/context` 检查索引状态。

如果索引过期，提示用户运行：
```bash
npx gitnexus analyze
```

### 3. 输出上下文摘要

使用下方模板输出摘要，然后询问用户本次会话目标。

## 工作流程

### Step 1: 加载上下文 (必须)

```
1. Read TODO.md → 展示待办任务列表
2. Read DECISIONS.md → 了解架构决策背景
3. Read PITFALLS.md → 了解已知陷阱
4. Read PATTERNS.md → 了解可复用模式
5. 输出上下文摘要给用户
```

### Step 2: 明确任务

询问用户：
- 本次会话的目标是什么？
- 是新功能、Bug修复、还是重构？
- 有没有时间约束或优先级要求？

### Step 3: 引导流程

根据任务类型引导：

**新功能开发**：
```
1. 使用 gitnexus_query 搜索相关代码
2. 使用 gitnexus_context 理解依赖关系
3. 如需设计，使用 EnterPlanMode
4. 实现前运行 gitnexus_impact 评估影响
5. 参考 PATTERNS.md 编写代码
6. 使用 /verify 验证效果
7. 使用 /code-review 审查
8. 提交并更新 Memory
```

**Bug 修复**：
```
1. 使用 /gitnexus-debugging 追踪根因
2. 检查 PITFALLS.md 是否已知问题
3. 运行 gitnexus_impact 评估修复影响
4. 实现修复
5. 使用 /verify 验证
6. ⚠️ 必须更新 PITFALLS.md 记录新坑
```

**重构**：
```
1. 运行 gitnexus_impact 全面评估
2. 高风险必须 EnterPlanMode + 用户确认
3. 使用 /gitnexus-refactor 安全重构
4. /verify 验证无回归
5. 更新 PATTERNS.md 如有新模式
```

### Step 4: 约束提醒

根据任务涉及的文件，提醒相关约束：

**前端任务**：
```
- API 调用必须封装到 services/
- SSE 连接必须有 cleanup 函数
- 使用函数式更新避免竞态
- 禁止使用 any
```

**后端任务**：
```
- PDF 解析必须在线程池执行
- 数据库写操作使用事务
- 错误标记任务状态为 failed
- SSE 事件包含 timestamp
```

**数据提取任务**：
```
- 每个数据必须有 evidence 字段
- 单位必须标准化
- 组分识别要处理混合阳离子
```

### Step 5: 完成确认

任务完成时确认：
```
□ 代码编译通过
□ 测试通过 (如有)
□ /verify 验证效果
□ /code-review 审查
□ Memory 更新 (如有新知识)
□ 提交信息符合规范
```

## 风险门禁

在任何代码修改前，**必须执行影响分析**：

| 风险等级 | 条件 | 必须动作 |
|----------|------|----------|
| 🟢 LOW | d=1 < 5, 非关键路径 | 可直接实现 |
| 🟡 MEDIUM | d=1 5-15 或 2+ 执行流 | 谨慎实现，逐步验证 |
| 🟠 HIGH | d=1 > 15 或 3+ 执行流 | **必须用户确认** |
| 🔴 CRITICAL | 涉及 auth/data/extraction | **必须用户确认 + 完整测试** |

### 影响分析命令

```javascript
gitnexus_impact({
  target: "要修改的符号名",
  direction: "upstream",
  minConfidence: 0.8,
  maxDepth: 3
})
```

## 提交前检查清单

在执行 git commit 前，确认以下项目：

```markdown
## 提交前 Checklist

### 代码质量
- [ ] TypeScript 编译通过 (npm run type-check)
- [ ] ESLint 无错误 (npm run lint)
- [ ] 相关测试通过 (如有)

### 约束遵守
- [ ] API 调用已封装到 services/
- [ ] SSE 连接有 cleanup 函数
- [ ] 数据有 evidence 字段
- [ ] 单位已标准化

### 影响确认
- [ ] gitnexus_detect_changes() 已运行
- [ ] 影响范围符合预期
- [ ] 高风险改动已用户确认

### 文档更新
- [ ] CLAUDE.md 约束已更新 (如有新约束)
- [ ] Memory 文件已更新 (如有新知识)
```

## Memory 写入指南

| 场景 | 写入文件 | 内容格式 |
|------|----------|----------|
| 技术选型 | DECISIONS.md | ADR: 背景+方案+理由+后果 |
| 遇到坑 | PITFALLS.md | 问题+原因+方案+预防 |
| 发现模式 | PATTERNS.md | 场景+代码+优点 |
| 新术语 | GLOSSARY.md | 术语+含义+示例 |

### 写入触发词

当提交信息包含以下关键词时，**提醒更新 Memory**：
- `fix` / `bug` → 可能需要写 PITFALLS.md
- `refactor` / `pattern` → 可能需要写 PATTERNS.md
- `decision` / `architecture` → 可能需要写 DECISIONS.md
- `feat` (重大功能) → 可能需要写 DECISIONS.md

## 输出模板

### 会话启动摘要

```markdown
## 📋 会话启动摘要

### 待办任务 (TODO.md)
| 优先级 | 任务 | 状态 |
|--------|------|------|
| P0 | xxx | ❌ |
| P1 | xxx | ❌ |

### 架构背景 (DECISIONS.md)
- ADR-001: Tauri vs Electron → 已采纳 Tauri
- ADR-002: SSE vs WebSocket → 已采纳 SSE
- ...

### 已知陷阱 (PITFALLS.md)
- PITFALL-001: SSE 连接未关闭
- PITFALL-002: SQLite 并发写入
- ...

### 可用模式 (PATTERNS.md)
- PATTERN-001: API 调用封装
- PATTERN-002: SSE 连接管理
- ...

---
请告诉我本次会话的目标？
```

## 示例对话

**用户**: 我要实现 P03 快捷问题按钮功能

**助手**:
```markdown
## 📋 任务确认

**任务类型**: 新功能开发
**涉及文件**: DetailsPage.tsx, QuickQuestionBox.tsx

### 相关上下文
- TODO.md: P03 精准问答快捷问题按钮 (未实现)
- PATTERNS.md: PATTERN-001 API 调用封装模式

### 执行步骤
1. 使用 gitnexus_query 搜索 QuickQuestionBox 相关代码
2. 使用 gitnexus_context 理解 DetailsPage 结构
3. 参考 PATTERN-001 封装 API 调用
4. 实现功能
5. /verify 验证效果

### 约束提醒
- API 调用封装到 services/api.ts
- 添加错误处理 Toast
- 类型定义到 types/index.ts

---
是否开始执行？
```
