# 会话记忆

**当前会话**：2026-05-03
**状态**：已完成

---

## 改动总结

### 本次会话完成

**[docs] 创建 Hermes 工程化记忆系统**
- 创建 `.claude/memory/` 目录结构
- 实现 5 个记忆文件：SESSION.md, DECISIONS.md, PITFALLS.md, PATTERNS.md, GLOSSARY.md
- 编写记忆系统说明文档 HERMES_SYSTEM.md 和 README.md
- 创建 Git Hook 自动化记录脚本
- 初始化 7 个架构决策记录（ADR-001 ~ ADR-007）
- 初始化 5 个踩坑记录（PITFALL-001 ~ PITFALL-005）
- 初始化 5 个最佳实践模式（PATTERN-001 ~ PATTERN-005）

**[docs] 完善 CLAUDE.md 开发约束**
- 从"项目介绍"改为"开发约束指令"
- 添加前端/后端开发规范
- 添加业务逻辑约束（钙钛矿领域规则）
- 添加 API 契约、错误处理、性能、安全、测试约束
- 添加 Git 提交规范和开发流程

### 关键文件位置
- `.claude/memory/SESSION.md` - 当前会话记忆
- `.claude/memory/DECISIONS.md:12` - ADR-001: 选择 Tauri 而非 Electron
- `.claude/memory/PITFALLS.md:12` - PITFALL-001: SSE 连接未关闭导致内存泄漏
- `.claude/memory/PATTERNS.md:12` - PATTERN-001: API 调用封装模式
- `CLAUDE.md:1-13` - 开发前必读引用

### 关键决策
1. ✅ 采用多层记忆系统而非单一记忆文件（SESSION + DECISIONS + PITFALLS + PATTERNS + GLOSSARY）
2. ✅ 记忆按生命周期分类：短期（SESSION）vs 长期（DECISIONS/PITFALLS/PATTERNS）
3. ✅ 重点记录"为什么"和"如何避免"，而非"做了什么"（与 Git 互补）
4. ✅ 自动化记录：通过 Git Hook 自动记录重要提交

### 临时笔记
- **思考**：记忆系统的价值在于"查询效率"，需要避免信息过载
- **已验证**：Git Hook 可以根据 commit 类型自动判断是否记录
- **优化方向**：考虑添加标签系统，方便按类别查询（如 `#frontend` `#performance` `#ai`）

---

## 下次继续

### 待办事项
- [ ] 实现后端 Python Sidecar
- [ ] 完成 PDF 解析和参数提取功能
- [ ] 测试 Git Hook 自动记录是否生效
- [ ] 在实际开发中验证记忆系统的价值
- [ ] 考虑添加记忆查询脚本或 VSCode 集成

### 遗留问题
- 记忆文件过大时的查询效率？（当前方案：grep + 文件分割）
- 如何提醒 AI 在开发前查阅记忆？（当前方案：CLAUDE.md 开头引用）
- 是否需要记忆文件的版本控制？（建议：纳入 Git 管理）

---

## 历史会话归档

### 2026-05-03 早期 - 项目初始化
**完成事项**：
- 初始化 Tauri + React 项目结构
- 完成前端页面框架（Home/Results/Details/Comparison）
- 定义后端 API 契约
- 创建 BRD 和系统架构文档

**关键文件**：
- `docs/BRD.md` - 业务需求文档
- `docs/System_Architecture.md` - 系统架构设计
- `CLAUDE.md` - 开发约束指令

**下次继续**：
- 实现后端 Python Sidecar
- 完成 PDF 解析和参数提取功能
