# Claude Code 自动化重构执行方案 (Refactor Execution via `loop`)

> 本文档旨在指导如何利用 Claude Code CLI 的 `loop` 指令，按照 `docs/Refactor_Plan.md` 自动化执行重构任务。

## 一、核心原理

Claude Code 的 `loop` 指令是一种**自治代理（Autonomous Agent）**模式。当你运行 `claude loop "指令"` 时，Claude 会进入一个循环：
1. **感知**：分析当前代码库状态和你的指令。
2. **决策**：规划实现步骤。
3. **执行**：使用工具（读写文件、运行终端命令、搜索）。
4. **验证**：检查执行结果是否符合预期。
5. **迭代**：如果未完成，继续下一步。

## 二、执行策略建议

对于 `Refactor_Plan.md` 这种跨度长、逻辑复杂的重构，**强烈建议不要尝试一次性完成全部 Phase**。

### 1. 分阶段执行 (Phase-by-Phase)
每次针对一个 Phase 开启一个 `loop`。这样可以确保上下文的准确性，并让你在每个阶段结束时进行人工审核（Human-in-the-loop）。

### 2. 上下文先行
在指令中明确指定参考 `docs/Refactor_Plan.md` 和 `CLAUDE.md`，这样 Claude 就能获取全局的设计约束。

### 3. 自动化测试闭环
在 `loop` 中加入 "运行测试并根据报错修复" 的要求。

---

## 三、具体操作指令清单

### Phase 0: 基础设施重构
这是重构的第一步，涉及品牌迁移、路由架构调整和数据库 Schema 更新。

**运行指令：**
```bash
claude loop "参考 docs/Refactor_Plan.md 中的 Phase 0 计划，执行基础设施重构。
要求：
1. 执行 PIA -> SIA 的品牌迁移。
2. 在前端引入 react-router-dom 并重构路由架构。
3. 引入 zustand 状态管理。
4. 重写 src-python/core/database.py 以支持 6 实体 ORM 模型。
5. 确保重构后执行 npm run dev 和后端基础测试不报错，不破坏 V1 现有功能。"
```

### Phase 1: 核心 P0 功能
涉及引导流程、项目系统和统一文献入口。

**运行指令：**
```bash
claude loop "参考 docs/Refactor_Plan.md 中的 Phase 1，实现核心 P0 功能。
要求：
1. 实现 OnboardingPage 首次启动引导流程。
2. 完成项目系统（Project API + ProjectHubPage）。
3. 实现三合一文献统一输入框（UnifiedInputBox）。
4. 集成本地 Embedding 模型加载逻辑。
5. 每次修改后运行 src-python/ 下的测试确保 API 端点正常。"
```

### Phase 2: 核心体验优化 (Q&A 引擎)
这是技术难度最高的一步，涉及 RAG 引擎。

**运行指令：**
```bash
claude loop "参考 docs/Refactor_Plan.md 中的 Phase 2，实现精准问答引擎和两阶段 AI 提取。
要求：
1. 创建 core/qa_engine.py 实现基于 FAISS 的 RAG。
2. 实现 /api/qa/ 及其 SSE 流式响应。
3. 改造 extractor.py 支持 Stage1/Stage2 两阶段提取。
4. 实现 PDF 页码定位跳转功能。
5. 请在完成后运行集成测试验证问答准确性。"
```

---

## 四、进阶使用技巧

### 1. 交互式调整
如果在 `loop` 过程中你发现 Claude 的方向偏了，可以随时 `Ctrl+C` 暂停，然后在对话框中补充要求，例如：
> "不要删除旧的 API 端点，保留它们作为兼容层。"
然后再重新输入 `loop` 或让它继续。

### 2. 批量验证
你可以要求 Claude 在完成每一小项任务后运行特定的命令：
```bash
claude loop "按照计划重构数据库，每修改完一个 Model 都要运行 pytest tests/test_db.py 验证。"
```

### 3. 处理大规模冲突
如果 Claude 提示文件冲突或需要你决策，它会停下来。这时你可以直接在终端输入你的偏好。

## 五、风险提示

1. **Token 消耗**：大规模重构会消耗较多 Token，建议在 `loop` 之前先用 `view_file` 确认 Claude 已经读过了最核心的几个文件。
2. **代码风格**：虽然 `loop` 很智能，但建议在 `CLAUDE.md` 中预先写好编码规范（Style Guide），Claude 会自动遵守。
3. **备份**：在开始 `loop` 前，确保 Git 仓库是 Clean 的，方便随时 `git reset --hard` 回滚。

---

## 文档变更记录

| 日期 | 变更类型 | 变更内容 | 关联提交 |
|------|---------|---------|---------|
| 2026-05-11 | 新增 | 创建 Claude Code loop 重构执行指南 | - |
