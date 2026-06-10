# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚡ 开发前必读

**在开始新功能开发前，请先阅读：**

1. **[.claude/memory/DECISIONS.md](.claude/memory/DECISIONS.md)** - 了解架构决策背景（为什么选择 Tauri/SSE/ThreadPoolExecutor）
2. **[.claude/memory/PITFALLS.md](.claude/memory/PITFALLS.md)** - 避免重复踩坑（SSE 连接泄漏、SQLite 并发、组分识别错误）
3. **[.claude/memory/PATTERNS.md](.claude/memory/PATTERNS.md)** - 参考最佳实践（API 封装、SSE 管理、任务状态管理）
4. **[.claude/memory/GLOSSARY.md](.claude/memory/GLOSSARY.md)** - 统一术语表达（PCE/Voc/Jsc/FF）

**记忆系统说明**：详见 [.claude/memory/README.md](.claude/memory/README.md)

---

## 项目概述

### 前端开发规范

**API 调用封装：**
- 禁止在组件内直接写 `fetch`，必须封装到独立的服务函数中
- 所有 API 调用必须有 try-catch 错误处理
- 用户友好的错误提示通过 toast 显示，不使用 alert
- 网络超时设置为 30 秒

```typescript
// ✅ 正确：封装 API 调用
export const searchPapers = async (query: string) => {
  try {
    const response = await fetch(`${API_BASE}/search?query=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Search failed');
    return await response.json();
  } catch (error) {
    console.error('Search error:', error);
    throw error; // 让调用者处理
  }
};

// ❌ 错误：在组件内直接调用
const handleSearch = () => {
  fetch('http://localhost:8000/api/search?query=' + query)
    .then(res => res.json())
    .then(data => setData(data));
};
```

**SSE 连接管理：**
- SSE 连接必须在组件卸载时关闭，避免内存泄漏
- 使用 `useEffect` 的 cleanup 函数关闭连接
- 断线重连：最多 3 次，间隔 2 秒

```typescript
useEffect(() => {
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    // 处理消息
  };

  // ✅ 必须清理
  return () => {
    eventSource.close();
  };
}, [url]);
```

**状态管理约束：**
- 使用函数式更新避免竞态条件：`setState(prev => ...)`
- 异步操作完成前组件可能已卸载，需要检查 `isMounted` 标志
- 列表状态更新：优先使用 `map/filter` 不可变操作，避免直接修改数组

**类型安全：**
- 所有 API 返回值必须定义 TypeScript 接口
- 禁止使用 `any`，至少使用 `unknown` 并进行类型守卫
- 组件 Props 必须定义接口

```typescript
// ✅ 定义清晰的接口
interface Literature {
  doi: string;
  title: string;
  journal?: string;
  year?: number;
  metrics?: DeviceMetrics | null;
}

// ❌ 避免 any
const processData = (data: any) => { ... }
```

### 后端开发规范

**线程安全与并发：**
- PDF 解析任务必须在独立线程执行，不阻塞主线程
- 使用 `concurrent.futures.ThreadPoolExecutor`，最大线程数不超过 CPU 核心数
- 共享状态必须加锁或使用线程安全的数据结构

```python
from concurrent.futures import ThreadPoolExecutor
import threading

# 全局任务状态（线程安全）
task_status = {}
task_lock = threading.Lock()

def update_task_status(doi: str, progress: int):
    with task_lock:
        task_status[doi] = progress
```

**数据库操作：**
- 所有写操作必须使用事务
- 批量插入时使用 `executemany` 而非循环插入
- 数据库路径：遵循 Windows 规范 `%APPDATA%/PIA/storage.db`

```python
import sqlite3
from pathlib import Path

DB_PATH = Path(os.getenv('APPDATA')) / 'PIA' / 'storage.db'

def save_extraction_result(doi: str, data: dict):
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute('BEGIN TRANSACTION')
        # 插入操作
        cursor.execute('COMMIT')
    except Exception as e:
        cursor.execute('ROLLBACK')
        raise e
    finally:
        conn.close()
```

**API 响应格式统一：**
- 成功：`{ "success": true, "data": {...} }`
- 失败：`{ "success": false, "error": "错误信息", "code": "ERROR_CODE" }`
- SSE 事件必须包含 `timestamp` 字段

```python
from datetime import datetime

# SSE 事件格式
{
    "status": "extracting",
    "progress": 45,
    "timestamp": datetime.now().isoformat()
}
```

**错误处理：**
- 所有 API 端点必须有异常捕获
- PDF 下载失败：标记任务状态为 `failed`，记录错误日志
- 解析超时：设置 5 分钟超时限制
- 错误日志保存到 SQLite `error_logs` 表

### 业务逻辑约束

**钙钛矿领域规则：**

**组分识别与标准化：**
- 混合阳离子必须识别：Cs (铯), FA (甲脒), MA (甲胺)
- 组分表示：标准化为化学式，如 `Cs0.05FA0.85MA0.1PbI3`
- 阴离子识别：I (碘), Br (溴), Cl (氯)

```typescript
// ✅ 组分验证逻辑
const validateComposition = (formula: string): boolean => {
  // 必须包含 Pb 和至少一种阳离子
  const hasCation = /[CsFAMA]/.test(formula);
  const hasLead = /Pb/.test(formula);
  return hasCation && hasLead;
};
```

**器件结构命名：**
- 统一使用 `n-i-p` (正式) 或 `p-i-n` (反式)
- 必须提取 ETL (电子传输层) 和 HTL (空穴传输层) 材料

**性能指标标注要求：**
- PCE、Voc、Jsc、FF 必须标注测试条件
- 测试方向：`R-scan` (反向扫描) 或 `F-scan` (正向扫描)
- 稳态输出：必须标注是否有 `SPO` (Steady-State Power Output)

```typescript
interface DeviceMetrics {
  pce: {
    value: number;
    unit: '%';
    scanDirection: 'R-scan' | 'F-scan';
    hasSPO: boolean;
  };
  voc: { value: number; unit: 'V'; };
  jsc: { value: number; unit: 'mA/cm²'; };
  ff: { value: number; unit: '%'; };
}
```

**单位标准化规则：**
- PCE: 百分比 (%)
- Voc: 伏特 (V)，禁止使用 mV
- Jsc: 毫安每平方厘米 (mA/cm²)
- FF: 百分比 (%)
- 换算错误率必须为 0

**数据溯源要求：**
- 提取的每个数据必须有 `evidence` 字段
- 指向原文具体位置：页码 + 段落或表格编号
- 支持点击跳转到 PDF 高亮位置

```typescript
interface ExtractedMetric {
  label: string;
  value: number;
  unit: string;
  evidence: {
    text: string;  // 原文句子
    page: number;
    paragraph?: number;
    tableId?: string;
  };
}
```

**SI 附件处理：**
- 自动识别并下载 SI 文件（PDF/Docx/ZIP）
- 工艺参数优先从 SI 提取
- 标注数据来源：`source: 'main' | 'si'`

**稳定性协议识别：**
- 必须识别 ISOS 协议等级 (ISOS-D-1, ISOS-L-1, 等)
- 提取测试条件：光强、温度、湿度
- 标注 T80/T90 寿命指标

### API 契约约束

**检索接口：**
```
GET /api/search?query={query}

Response:
{
  "results": [
    {
      "doi": "10.1126/science.abc1234",
      "title": "...",
      "journal": "Science",
      "year": 2024,
      "authors": "Zhang et al.",
      "relevance": 95,
      "cached": false
    }
  ],
  "warning": "可选：检索提示信息"
}
```

**参数提取接口（SSE）：**
```
GET /api/extract/{doi}

EventStream:
data: {"status": "downloading", "progress": 10, "timestamp": "..."}
data: {"status": "parsing", "progress": 30, "timestamp": "..."}
data: {"status": "extracting", "progress": 60, "timestamp": "..."}
data: {"status": "completed", "progress": 100, "data": {...}, "timestamp": "..."}
data: {"status": "failed", "error": "错误信息", "timestamp": "..."}
```

**论文详情接口：**
```
GET /api/paper/{doi}

Response:
{
  "doi": "...",
  "title": "...",
  "abstract": "...",
  "is_extracted": true,
  "metrics": [
    {
      "label": "PCE",
      "value": "24.9",
      "unit": "%",
      "evidence": "表S2显示最佳器件在反向扫描下达到24.9%的效率"
    }
  ],
  "process": [
    {
      "field": "退火温度",
      "value": "100°C",
      "source": "si"
    }
  ]
}
```

### 错误处理与边界情况

**前端错误处理：**
```typescript
// 网络错误
catch (error) {
  showToast('网络请求失败，请检查服务器连接 (localhost:8000)', 'error');
  console.error('API Error:', { url, error });
}

// SSE 断线重连
let retryCount = 0;
const maxRetries = 3;

eventSource.onerror = () => {
  retryCount++;
  if (retryCount <= maxRetries) {
    setTimeout(() => reconnect(), 2000);
  } else {
    showToast('连接失败，请检查网络', 'error');
  }
};
```

**后端错误处理：**
```python
# PDF 下载失败
try:
    pdf_content = download_pdf(doi)
except Exception as e:
    logger.error(f"PDF download failed for {doi}: {str(e)}")
    update_task_status(doi, {
        "status": "failed",
        "error": "PDF_DOWNLOAD_FAILED",
        "message": str(e)
    })
    return

# 解析超时
@timeout(300)  # 5 分钟超时
def extract_metrics(pdf_path: str):
    # 解析逻辑
    pass
```

**必须处理的边界情况：**
- DOI 不存在或格式错误
- PDF 文件损坏或加密
- SI 附件缺失或格式不支持
- 网络断开时的离线模式
- 并发提取同一 DOI 的竞态条件
- 大文件 PDF (>50MB) 的内存溢出

### 性能约束

**前端性能：**
- 首屏加载时间 < 3 秒
- 列表超过 50 条必须使用虚拟滚动
- 图片懒加载
- 组件懒加载：使用 `React.lazy` 和 `Suspense`

**后端性能：**
- 单篇 PDF + SI 解析总时间 < 45 秒
- 缓存命中时响应时间 < 500ms
- 数据库查询必须使用索引
- 批量插入使用事务，禁止循环单条插入

**内存管理：**
- PDF 解析后立即释放内存
- 大文件流式处理，禁止一次性加载到内存
- 前端状态避免存储大对象（如 PDF 二进制数据）

### 安全约束

**敏感信息保护：**
- API Key 存储在 localStorage，禁止明文打印到日志
- 禁止在前端代码中硬编码 API Key
- 错误日志中脱敏敏感信息

```typescript
// ❌ 禁止
console.log('API Key:', apiKey);

// ✅ 正确
console.log('API configured:', !!apiKey);
```

**合规性要求：**
- PDF 下载遵循机构订阅权限，不绕过付费墙
- 优先使用 OA (Open Access) 资源
- 本地数据加密存储敏感信息
- 不分发受版权保护的原文内容

**输入验证：**
- DOI 格式验证：`/^10\.\d{4,9}/[-._;()/:A-Z0-9]+$/i`
- 用户输入转义，防止 XSS
- SQL 参数化查询，防止注入

### 测试要求

**必须测试的场景：**
1. SSE 连接中断后的自动重连
2. 并发提取多个 DOI 的线程安全
3. 大文件 PDF (50MB+) 的内存管理
4. 网络断开时的离线模式
5. 组分识别的准确率（Cs/FA/MA 混合阳离子）
6. 单位换算的正确性（V/mV, mA/cm²）
7. 缓存命中与未命中的响应时间

**测试数据：**
- 准备至少 10 个真实 PDF 样本（含 SI）
- 包含不同器件结构（n-i-p, p-i-n）
- 包含不同组分（单阳离子、双阳离子、三阳离子）

### Git 提交规范

**提交消息格式：**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型 (type)：**
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `refactor`: 重构（不改变功能）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具链相关

**范围 (scope)：**
- `frontend`: 前端相关
- `backend`: 后端相关
- `api`: API 接口
- `extract`: 数据提取逻辑

**示例：**
```
feat(extract): 添加 SI 附件自动下载功能

- 支持 PDF/Docx/ZIP 格式
- 自动路由至出版社下载接口
- 添加下载失败重试机制

Closes #123
```

### 开发流程

**功能开发流程：**
1. 新功能开发前，先更新本文档的相关约束
2. 修改 API 契约时，必须同步更新前后端代码
3. 编写代码前先写测试用例（TDD）
4. 提交前运行：`npm run lint` + `npm run type-check`
5. 涉及数据提取逻辑的修改，必须用真实 PDF 测试

**代码审查清单：**
- [ ] API 调用是否有错误处理
- [ ] SSE 连接是否在组件卸载时关闭
- [ ] 数据提取是否有 evidence 字段
- [ ] 单位是否标准化
- [ ] 是否有 TypeScript 类型定义
- [ ] 是否有日志记录关键操作
- [ ] 是否处理了边界情况

### 技术债务标记

使用 `// TODO: [constraint]` 标记需要遵循约束的代码：

```typescript
// TODO: [constraint] SSE 连接需要在组件卸载时关闭
// TODO: [constraint] 提取的数据必须有 evidence 字段指向原文
// TODO: [constraint] 所有 API 调用需要封装到服务层
// TODO: [constraint] 单位换算需要验证边界值
```

### 已知限制

- **平台限制**：仅支持 Windows，暂不支持 macOS/Linux
- **打包限制**：Python Sidecar 需要手动编译，尚未集成到 CI/CD
- **浏览器限制**：PDF 预览功能依赖浏览器 iframe 支持
- **并发限制**：同时解析的 PDF 数量不应超过 CPU 核心数
- **存储限制**：本地缓存无上限，需手动清理

### 调试技巧

**前端调试：**
```bash
# 开启 React DevTools
npm run dev

# 查看 Tauri 日志（详细模式）
npm run tauri dev -- --verbose

# 查看网络请求
# 浏览器 DevTools → Network → 筛选 localhost:8000
```

**后端调试：**
```bash
# 单独启动后端（开发模式，热重载）
cd src-python
uvicorn main:app --reload --port 8000

# 测试 SSE 端点
curl -N http://localhost:8000/api/extract/10.1126/science.abc1234

# 查看数据库
sqlite3 %APPDATA%/PIA/storage.db
sqlite> SELECT * FROM papers WHERE doi = '...';
```

**日志查看：**
- 前端日志：浏览器控制台
- 后端日志：`%APPDATA%/PIA/logs/`
- Tauri 日志：`%APPDATA%/com.pia.app/logs/`

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Perovskite_Insight_Agent** (2538 symbols, 4578 relationships, 166 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Perovskite_Insight_Agent/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Perovskite_Insight_Agent/clusters` | All functional areas |
| `gitnexus://repo/Perovskite_Insight_Agent/processes` | All execution flows |
| `gitnexus://repo/Perovskite_Insight_Agent/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
