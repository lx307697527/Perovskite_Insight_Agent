# PIA 开发流程快速参考卡

> 一页速查，开发时贴在旁边

---

## 🚀 启动会话 (每次必做)

```
□ 读取 TODO.md     → 了解当前任务
□ 读取 DECISIONS   → 了解架构背景
□ 读取 PITFALLS    → 避免已知陷阱
□ 读取 PATTERNS    → 参考最佳实践
```

---

## 📊 六阶段流程

```
┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐
│ 0.启动  │──▶│ 1.理解  │──▶│ 2.设计  │──▶│ 3.实现  │──▶│ 4.交付  │──▶│ 5.沉淀  │
└────────┘   └────────┘   └────────┘   └────────┘   └────────┘   └────────┘
    │            │            │            │            │            │
    ▼            ▼            ▼            ▼            ▼            ▼
 Memory      GitNexus     PlanMode     Impact      CodeReview   Update
 +TODO       Explore      +AskUser     +Patterns   +Simplify    Memory
```

---

## 🛠️ 场景速查

### 新功能开发
```
1. /read-todo → 确认任务
2. gitnexus_query → 找相关代码
3. gitnexus_impact → 评估影响
4. 实现 + /verify 验证
5. /code-review → /simplify → commit
6. 更新 Memory (如有新知识)
```

### Bug 修复
```
1. /gitnexus-debug → 追踪根因
2. Read PITFALLS → 检查已知问题
3. gitnexus_impact → 评估修复影响
4. 修复 + /verify 验证
5. ⚠️ 写入 PITFALLS.md (重要!)
```

### 重构
```
1. gitnexus_impact → 全面评估
2. EnterPlanMode → 制定计划
3. 用户确认 (高风险必须)
4. /gitnexus-refactor → 安全重构
5. /verify → 验证无回归
```

---

## ⚠️ 风险门禁

| 风险 | 条件 | 动作 |
|------|------|------|
| 🟢 LOW | d=1 < 5, 非关键路径 | 直接实现 |
| 🟡 MEDIUM | d=1 5-15 或 2+ 执行流 | 谨慎实现 |
| 🟠 HIGH | d=1 > 15 或 3+ 执行流 | **必须确认** |
| 🔴 CRITICAL | 涉及 auth/data/extraction | **确认+完整测试** |

---

## 📝 提交前 Checklist

```markdown
□ TypeScript 编译通过
□ ESLint 无错误
□ 相关测试通过
□ gitnexus_detect_changes() 影响确认
□ API 调用已封装服务层
□ SSE 连接有 cleanup
□ 数据有 evidence 字段
□ 单位已标准化
```

---

## 🔧 常用命令

| 用途 | 命令 |
|------|------|
| 理解代码 | `/gitnexus-exploring` |
| 评估影响 | `/gitnexus-impact-analysis` |
| 追踪 Bug | `/gitnexus-debugging` |
| 代码审查 | `/code-review` |
| 简化重构 | `/simplify` |
| 运行验证 | `/verify` |
| 深度调研 | `/deep-research` |

---

## 💾 Memory 写入指南

| 场景 | 写入 | 内容 |
|------|------|------|
| 技术选型 | DECISIONS.md | ADR: 背景+方案+理由+后果 |
| 遇到坑 | PITFALLS.md | 问题+原因+方案+预防 |
| 发现模式 | PATTERNS.md | 场景+代码+优点 |
| 新术语 | GLOSSARY.md | 术语+含义+示例 |

---

## 🚫 禁止行为

```
❌ 瞎猜接口或凭记忆推断返回值
❌ 直接粘贴未审查的 AI 代码
❌ 在组件内直接写 fetch
❌ SSE 连接不写 cleanup
❌ 提取数据无 evidence 字段
❌ 高风险改动不确认直接实现
```

---

## 📞 求助路径

```
问题类型              求助方式
─────────────────────────────────────
代码不理解      →    /gitnexus-exploring
不知道改什么    →    gitnexus_impact
Bug 追踪       →    /gitnexus-debugging
方案选择困难    →    EnterPlanMode + AskUserQuestion
技术调研       →    /deep-research
```
