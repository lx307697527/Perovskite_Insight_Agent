# Hermes 工程化记忆系统

本文档定义了 PIA 项目的知识管理体系，遵循 Hermes 工程化思维：**记录、积累、传承、演进**。

## 记忆系统架构

### 文件结构

```
.claude/memory/
├── SESSION.md          # 当前会话记忆（自动生成，定期清理）
├── DECISIONS.md        # 架构决策记录 (Architecture Decision Records)
├── PITFALLS.md         # 踩坑记录与解决方案
├── PATTERNS.md         # 最佳实践模式库
└── GLOSSARY.md         # 项目术语表
```

### 各文件职责

| 文件 | 职责 | 生命周期 | 维护方式 |
|------|------|----------|----------|
| SESSION.md | 当前会话的改动总结、临时笔记 | 会话级（定期清理） | AI 自动写入 |
| DECISIONS.md | 重要的架构决策及原因 | 永久 | 人工审核后写入 |
| PITFALLS.md | 踩坑记录 + 解决方案 + 预防措施 | 永久 | 遇到坑时立即写入 |
| PATTERNS.md | 成功的代码模式、最佳实践 | 永久 | 提炼后写入 |
| GLOSSARY.md | 项目专有术语、缩写 | 永久 | 新术语出现时更新 |

---

## SESSION.md - 会话记忆

**作用**：记录本次开发会话中的关键改动，方便下次会话快速上下文切换。

**格式规范**：
```markdown
# Session: 2026-05-03

## 改动总结
- [frontend] 添加 SI 附件自动下载功能
- [backend] 优化 PDF 解析线程池配置
- [docs] 更新 CLAUDE.md 开发约束

## 关键代码位置
- `src/pages/ResultsPage.tsx:89` - SSE 连接重连逻辑
- `backend/extractor.py:156` - 线程安全的状态更新

## 临时笔记
- 待解决：大文件 PDF 内存溢出问题
- 思路：考虑流式处理，避免一次性加载

## 下次继续
- [ ] 实现 PDF 流式解析
- [ ] 添加单元测试
```

**写入时机**：
- 每次 AI 完成重要功能后自动总结
- 会话结束时人工补充"下次继续"

**清理策略**：
- 超过 7 天的会话自动归档到 `archive/` 目录
- 保留最近 5 次会话记录

---

## DECISIONS.md - 架构决策记录

**作用**：记录重要的技术选型和架构决策，**重点记录"为什么"**，而不是"做了什么"。

**格式规范**（ADR 风格）：
```markdown
# 架构决策记录

## ADR-001: 选择 SSE 而非 WebSocket 进行进度推送

**日期**：2026-05-03
**状态**：已采纳

### 背景
前端需要实时接收 PDF 解析进度，考虑两种方案：
1. WebSocket：双向通信，支持更复杂交互
2. SSE (Server-Sent Events)：单向推送，实现简单

### 决策
采用 SSE。

### 理由
1. **需求匹配**：只需要服务端推送进度，不需要客户端主动发消息
2. **实现成本**：SSE 原生支持断线重连，WebSocket 需要自己实现
3. **兼容性**：SSE 在所有现代浏览器中都支持良好
4. **资源消耗**：SSE 基于 HTTP，无需额外协议握手

### 后果
- ✅ 前端代码简洁，使用 EventSource API 即可
- ✅ 自动重连机制开箱即用
- ⚠️ 无法实现双向通信（如取消任务），需要额外 HTTP 接口

### 相关代码
- `src/pages/ResultsPage.tsx:89-119`
- `backend/api/extract.py`

---

## ADR-002: 放弃 Redis/Celery，使用 ThreadPoolExecutor

**日期**：2026-05-03
**状态**：已采纳

### 背景
需要异步处理 PDF 解析任务，常见方案：
1. Celery + Redis：功能强大，但需要额外依赖
2. ThreadPoolExecutor：Python 内置，轻量级

### 决策
采用 ThreadPoolExecutor。

### 理由
1. **部署简化**：桌面应用打包成 .exe，引入 Redis 会增加 100MB+ 体积
2. **用户友好**：用户无需安装 Redis
3. **性能足够**：单机场景下并发任务数不超过 CPU 核心数
4. **维护成本**：少一个外部依赖，少一个故障点

### 后果
- ✅ 打包体积小，部署简单
- ✅ 无需用户安装额外软件
- ⚠️ 任务状态存储在内存，重启后丢失（已通过 SQLite 持久化解决）
- ⚠️ 无法跨机器分布式处理（本项目不需要）

### 相关代码
- `backend/task_manager.py`
```

**写入时机**：
- 做出重要技术选型时
- 放弃某个方案时（记录为何放弃，避免以后重复讨论）
- 架构发生重大调整时

---

## PITFALLS.md - 踩坑记录

**作用**：记录开发中遇到的坑、错误、陷阱，**重点记录"如何避免"**。

**格式规范**：
```markdown
# 踩坑记录

## PITFALL-001: SSE 连接未关闭导致内存泄漏

**发现日期**：2026-05-03
**严重程度**：高 ⚠️
**影响范围**：前端所有使用 SSE 的组件

### 问题描述
在 `ResultsPage` 中使用 `EventSource` 连接后端 SSE，但组件卸载时未关闭连接，导致：
1. 内存泄漏：已卸载组件的 EventSource 仍在运行
2. 错误日志：尝试更新已卸载组件的状态，报 React 警告
3. 连接浪费：多个无效连接占用后端资源

### 触发条件
用户在解析过程中点击"返回"按钮，组件卸载但 EventSource 未关闭。

### 错误表现
```
Warning: Can't perform a React state update on an unmounted component.
```

### 根本原因
`useEffect` 缺少 cleanup 函数。

### 解决方案
```typescript
useEffect(() => {
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    setData(JSON.parse(event.data));
  };

  // ✅ 关键：返回清理函数
  return () => {
    eventSource.close();
  };
}, [url]);
```

### 预防措施
1. **代码审查清单**：所有使用 EventSource 的地方必须检查 cleanup
2. **Lint 规则**：eslint-plugin-react-hooks 会自动警告
3. **文档约束**：在 CLAUDE.md 中明确要求

### 相关问题
- GitHub Issue #45
- Stack Overflow: [react-eventsource-memory-leak](https://stackoverflow.com/questions/...)

---

## PITFALL-002: SQLite 并发写入导致数据库锁定

**发现日期**：2026-05-03
**严重程度**：中 ⚠️

### 问题描述
多个线程同时向 SQLite 写入数据时，报错：
```
sqlite3.OperationalError: database is locked
```

### 根本原因
SQLite 默认串行化写入，并发写入需要：
1. 设置超时时间
2. 使用 WAL 模式
3. 正确管理连接

### 解决方案
```python
# 方案 1：设置超时
conn = sqlite3.connect(DB_PATH, timeout=30.0)

# 方案 2：启用 WAL 模式
conn.execute('PRAGMA journal_mode=WAL')

# 方案 3：使用连接池 + 锁
from threading import Lock
db_lock = Lock()

def write_data(data):
    with db_lock:
        conn = sqlite3.connect(DB_PATH)
        # 写入操作
        conn.close()
```

### 预防措施
1. 批量写入使用事务，减少锁竞争
2. 读操作使用 `WITH (NOLOCK)` 提示（SQLite 不支持，改用隔离级别）
3. 测试并发场景

---

## PITFALL-003: 钙钛矿组分识别错误

**发现日期**：2026-05-03
**严重程度**：高 ⚠️

### 问题描述
将 `Cs0.05FA0.85MA0.1PbI3` 识别为三个独立的化合物，而非一个混合阳离子钙钛矿。

### 错误逻辑
```python
# ❌ 错误：按空格分割
composition = formula.split()  # ['Cs0.05FA0.85MA0.1PbI3']
# 导致无法识别混合阳离子
```

### 正确逻辑
```python
# ✅ 正确：使用正则提取阳离子比例
import re

pattern = r'(Cs|FA|MA)(\d*\.?\d*)'
matches = re.findall(pattern, formula)
# [('Cs', '0.05'), ('FA', '0.85'), ('MA', '0.1')]
```

### 预防措施
1. 建立钙钛矿组分测试用例库
2. 包含各种变体写法：`CsFAMAPbI3`, `Cs0.05(FA0.85MA0.1)PbI3`
```

**写入时机**：
- 遇到 Bug 并找到根本原因后
- 发现容易犯错的 API 或库使用方式
- 用户反馈的问题

**价值评估标准**：
- 高价值：可能反复出现的问题、难以排查的问题
- 中价值：常见错误但有明确解决方案
- 低价值：一次性错误、显而易见的错误

---

## PATTERNS.md - 最佳实践模式

**作用**：记录成功的代码模式、设计模式，供后续开发复用。

**格式规范**：
```markdown
# 最佳实践模式库

## PATTERN-001: API 调用封装模式

### 适用场景
前端需要调用后端 API 时。

### 模式代码
```typescript
// services/api.ts
const API_BASE = 'http://localhost:8000';

export const api = {
  async search(query: string): Promise<SearchResult> {
    try {
      const response = await fetch(
        `${API_BASE}/api/search?query=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(30000) }
      );

      if (!response.ok) {
        throw new APIError(`Search failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new APIError('Request timeout');
      }
      throw error;
    }
  }
};

// 自定义错误类
class APIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'APIError';
  }
}
```

### 优点
1. **统一错误处理**：所有 API 错误通过自定义 Error 类
2. **超时控制**：避免请求无限等待
3. **类型安全**：返回值有明确类型定义
4. **可测试**：封装后易于 mock

### 使用示例
```typescript
// components/HomePage.tsx
import { api } from '../services/api';

const handleSearch = async () => {
  try {
    const result = await api.search(query);
    setSearchResults(result.papers);
  } catch (error) {
    if (error instanceof APIError) {
      showToast(error.message, 'error');
    }
  }
};
```

---

## PATTERN-002: SSE 连接管理模式

### 适用场景
前端需要接收服务端实时推送的数据。

### 模式代码
```typescript
// hooks/useSSE.ts
import { useEffect, useState } from 'react';

interface SSEOptions<T> {
  url: string;
  onMessage: (data: T) => void;
  onError?: (error: Event) => void;
  maxRetries?: number;
  retryDelay?: number;
}

export function useSSE<T>(options: SSEOptions<T>) {
  const { url, onMessage, onError, maxRetries = 3, retryDelay = 2000 } = options;
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let eventSource: EventSource;
    let isMounted = true;

    const connect = () => {
      eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (isMounted) {
          onMessage(data);
          setRetryCount(0); // 成功接收消息后重置重试计数
        }
      };

      eventSource.onerror = () => {
        if (retryCount < maxRetries && isMounted) {
          setRetryCount(prev => prev + 1);
          setTimeout(() => {
            eventSource.close();
            connect(); // 重连
          }, retryDelay);
        } else {
          onError?.(new Event('Max retries exceeded'));
          eventSource.close();
        }
      };
    };

    connect();

    return () => {
      isMounted = false;
      eventSource?.close();
    };
  }, [url]);

  return { retryCount };
}
```

### 优点
1. **自动重连**：断线后自动重试
2. **资源清理**：组件卸载时自动关闭连接
3. **竞态安全**：使用 `isMounted` 标志避免更新已卸载组件
4. **可配置**：重试次数、延迟可配置

### 使用示例
```typescript
const { retryCount } = useSSE({
  url: `/api/extract/${doi}`,
  onMessage: (data) => {
    setProgress(data.progress);
    if (data.status === 'completed') {
      // 处理完成
    }
  },
  onError: () => {
    showToast('连接失败', 'error');
  }
});
```

---

## PATTERN-003: 线程安全的任务状态管理

### 适用场景
Python 后端需要管理多个并发任务的状态。

### 模式代码
```python
from threading import Lock
from typing import Dict
from dataclasses import dataclass
from datetime import datetime

@dataclass
class TaskStatus:
    status: str  # 'pending' | 'running' | 'completed' | 'failed'
    progress: int
    started_at: datetime
    error: str = None

class TaskManager:
    def __init__(self):
        self._tasks: Dict[str, TaskStatus] = {}
        self._lock = Lock()

    def update(self, task_id: str, **kwargs):
        """线程安全更新任务状态"""
        with self._lock:
            if task_id not in self._tasks:
                return

            task = self._tasks[task_id]
            for key, value in kwargs.items():
                if hasattr(task, key):
                    setattr(task, key, value)

    def get(self, task_id: str) -> TaskStatus:
        """线程安全读取任务状态"""
        with self._lock:
            return self._tasks.get(task_id)

    def create(self, task_id: str):
        """创建新任务"""
        with self._lock:
            self._tasks[task_id] = TaskStatus(
                status='pending',
                progress=0,
                started_at=datetime.now()
            )
```

### 优点
1. **线程安全**：所有操作加锁
2. **类型安全**：使用 dataclass 定义结构
3. **封装性**：外部无需关心锁的实现
```

**写入时机**：
- 发现一个可复用的成功模式
- 重构后提炼出最佳实践
- 解决 PITFALL 后形成的固定模式

---

## GLOSSARY.md - 术语表

**作用**：统一项目中的专业术语、缩写、变量命名。

```markdown
# 项目术语表

## 钙钛矿领域术语

| 术语 | 全称 | 含义 | 英文 |
|------|------|------|------|
| PCE | Power Conversion Efficiency | 光电转换效率 | Power Conversion Efficiency |
| Voc | Open-Circuit Voltage | 开路电压 | Open-Circuit Voltage |
| Jsc | Short-Circuit Current Density | 短路电流密度 | Short-Circuit Current Density |
| FF | Fill Factor | 填充因子 | Fill Factor |
| n-i-p | - | 正式结构（电子传输层在底） | Conventional structure |
| p-i-n | - | 反式结构（空穴传输层在底） | Inverted structure |
| SPO | Steady-State Power Output | 稳态功率输出 | Steady-State Power Output |
| SI | Supporting Information | 补充材料 | Supporting Information |

## 项目代码术语

| 术语 | 含义 | 示例 |
|------|------|------|
| `doi` | Digital Object Identifier，论文唯一标识符 | `10.1126/science.abc1234` |
| `metrics` | 性能指标数据 | PCE, Voc, Jsc, FF |
| `evidence` | 数据溯源证据 | 原文中的具体句子或表格 |
| `extraction` | 参数提取过程 | 从 PDF 中提取工艺参数 |

## 缩写约定

| 缩写 | 完整形式 | 使用场景 |
|------|----------|----------|
| API | Application Programming Interface | 前后端通信接口 |
| SSE | Server-Sent Events | 实时数据推送 |
| ADR | Architecture Decision Record | 架构决策记录 |
```

---

## 写入流程

### 自动写入（通过 Hook）

在 `.claude/hooks/` 中创建 Git Hook：

```bash
#!/bin/bash
# post-commit hook

# 提取 commit 信息
COMMIT_MSG=$(git log -1 --pretty=%B)
COMMIT_HASH=$(git rev-parse --short HEAD)

# 自动追加到 SESSION.md
echo "## Commit: $COMMIT_HASH" >> .claude/memory/SESSION.md
echo "$COMMIT_MSG" >> .claude/memory/SESSION.md
echo "" >> .claude/memory/SESSION.md
```

### 人工写入（需要判断价值）

**写入决策树：**
```
遇到问题/做出决策
    ├─ 是一次性问题？
    │   └─ 是 → 不写入
    │   └─ 否 → 写入 PITFALLS.md
    │
    ├─ 是重要技术选型？
    │   └─ 是 → 写入 DECISIONS.md
    │
    ├─ 是否可复用？
    │   └─ 是 → 写入 PATTERNS.md
    │
    └─ 是新术语？
        └─ 是 → 写入 GLOSSARY.md
```

---

## 查询与使用

### AI 如何使用记忆系统

在 CLAUDE.md 中添加引用：

```markdown
## 开发前必读

在开始新功能开发前，请先阅读：
1. `memory/DECISIONS.md` - 了解架构决策背景
2. `memory/PITFALLS.md` - 避免重复踩坑
3. `memory/PATTERNS.md` - 参考最佳实践
```

### 快速查询

```bash
# 查询所有踩坑记录
grep -n "PITFALL-" .claude/memory/PITFALLS.md

# 查询特定关键词
grep -n "SSE" .claude/memory/*.md

# 查询最近 5 次会话
head -100 .claude/memory/SESSION.md
```

---

## 维护策略

### 定期清理（每月）

1. **SESSION.md**：归档 7 天前的会话
2. **PITFALLS.md**：删除已过时的坑（如库已修复的 Bug）
3. **PATTERNS.md**：合并重复的模式

### 价值评估（每季度）

评估每个记忆条目的价值：
- **高频使用** → 保留
- **低频但有价值** → 保留
- **过时/低价值** → 删除或归档

---

## 与 Git 的区别

| 维度 | Git Commit | 记忆系统 |
|------|-----------|----------|
| 记录内容 | 改了什么（What） | 为什么改（Why）+ 如何避免（How） |
| 查询目的 | 版本回溯 | 知识复用 |
| 信息密度 | 低（每次提交都记录） | 高（仅记录有价值的信息） |
| 时间跨度 | 短期（当前状态） | 长期（经验积累） |
| 适用场景 | 代码管理 | 知识管理 |

**示例对比：**

**Git Commit：**
```
fix: 修复 SSE 连接未关闭导致的内存泄漏
```

**PITFALLS.md：**
```
## PITFALL-001: SSE 连接未关闭导致内存泄漏

### 根本原因
useEffect 缺少 cleanup 函数

### 解决方案
return () => { eventSource.close(); }

### 预防措施
1. 代码审查清单
2. Lint 规则
3. 文档约束
```

---

## 实施建议

### 第一阶段：基础建设
1. 创建记忆文件结构
2. 迁移现有的重要决策和踩坑记录
3. 在 CLAUDE.md 中添加引用

### 第二阶段：自动化
1. 配置 Git Hook 自动记录
2. 编写脚本定期清理 SESSION.md

### 第三阶段：文化建设
1. 每次 Code Review 检查是否需要更新记忆
2. 定期回顾记忆系统，评估价值
3. 将记忆系统融入开发流程
