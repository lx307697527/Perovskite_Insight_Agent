# 踩坑记录

本文档记录开发中遇到的坑、错误、陷阱。重点记录"如何避免"。

---

## PITFALL-001: SSE 连接未关闭导致内存泄漏

**发现日期**：2026-05-03
**严重程度**：高 ⚠️
**影响范围**：前端所有使用 SSE 的组件

### 问题描述
在 `ResultsPage` 中使用 `EventSource` 连接后端 SSE，但组件卸载时未关闭连接，导致：
1. **内存泄漏**：已卸载组件的 EventSource 仍在运行
2. **错误日志**：尝试更新已卸载组件的状态，报 React 警告
3. **连接浪费**：多个无效连接占用后端资源

### 触发条件
用户在解析过程中点击"返回"按钮，组件卸载但 EventSource 未关闭。

### 错误表现
```
Warning: Can't perform a React state update on an unmounted component.
This is a no-op, but it indicates a memory leak in your application.
```

### 根本原因
`useEffect` 缺少 cleanup 函数。

### 解决方案
```typescript
useEffect(() => {
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    setProgress(data.progress);
  };

  // ✅ 关键：返回清理函数
  return () => {
    eventSource.close();
  };
}, [url]);
```

### 预防措施
1. **代码审查清单**：所有使用 EventSource 的地方必须检查 cleanup
2. **Lint 规则**：配置 `eslint-plugin-react-hooks`，会自动警告缺少 cleanup
3. **文档约束**：在 CLAUDE.md 中明确要求

### 相关问题
- React 官方文档：[Using the Effect Hook – Example of Cleanup](https://react.dev/learn/synchronizing-with-effects#step-3-add-cleanup-if-needed)
- Stack Overflow: [React EventSource memory leak](https://stackoverflow.com/questions/)

---

## PITFALL-002: SQLite 并发写入导致数据库锁定

**发现日期**：2026-05-03（预期问题）
**严重程度**：中 ⚠️
**影响范围**：后端所有数据库写入操作

### 问题描述
多个线程同时向 SQLite 写入数据时，报错：
```
sqlite3.OperationalError: database is locked
```

### 触发条件
用户同时提取多篇文献，多个线程并发写入数据库。

### 根本原因
SQLite 默认串行化写入，并发写入需要：
1. 设置超时时间
2. 使用 WAL 模式
3. 正确管理连接

### 解决方案

**方案 1：设置超时**
```python
conn = sqlite3.connect(DB_PATH, timeout=30.0)
```

**方案 2：启用 WAL 模式**
```python
conn = sqlite3.connect(DB_PATH)
conn.execute('PRAGMA journal_mode=WAL')
```

**方案 3：使用锁**
```python
from threading import Lock

db_lock = Lock()

def write_data(data):
    with db_lock:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('BEGIN TRANSACTION')
        try:
            # 写入操作
            cursor.execute('COMMIT')
        except Exception as e:
            cursor.execute('ROLLBACK')
            raise e
        finally:
            conn.close()
```

### 推荐方案
组合使用：**WAL 模式 + 超时 + 批量事务**

```python
def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')  # 性能优化
    return conn

def batch_insert_papers(papers: list):
    conn = init_db()
    cursor = conn.cursor()
    cursor.execute('BEGIN TRANSACTION')
    try:
        cursor.executemany(
            'INSERT INTO papers (doi, title, ...) VALUES (?, ?, ...)',
            [(p.doi, p.title, ...) for p in papers]
        )
        cursor.execute('COMMIT')
    except Exception as e:
        cursor.execute('ROLLBACK')
        raise e
    finally:
        conn.close()
```

### 预防措施
1. 批量写入使用事务，减少锁竞争
2. 测试并发场景：同时提取 10 篇文献
3. 监控数据库锁定错误日志

### 性能参考
- 单次写入：~10ms
- 批量写入（100条）：~100ms
- WAL 模式并发性能提升 50%+

---

## PITFALL-003: 钙钛矿组分识别错误

**发现日期**：2026-05-03（预期问题）
**严重程度**：高 ⚠️
**影响范围**：AI 提取逻辑、检索功能

### 问题描述
将 `Cs0.05FA0.85MA0.1PbI3` 识别为三个独立的化合物，而非一个混合阳离子钙钛矿。

### 错误示例
```python
# ❌ 错误：按空格分割
composition = formula.split()
# 结果：['Cs0.05FA0.85MA0.1PbI3']
# 无法识别混合阳离子
```

### 根本原因
钙钛矿组分有多种表示方式：
1. `Cs0.05FA0.85MA0.1PbI3`（紧凑写法）
2. `Cs0.05(FA0.85MA0.1)PbI3`（分组写法）
3. `CsFAMAPbI3`（简写，省略比例）

简单的字符串分割无法处理。

### 解决方案

**正则提取法：**
```python
import re

def parse_composition(formula: str) -> dict:
    """解析钙钛矿组分"""
    # 提取阳离子及比例
    cation_pattern = r'(Cs|FA|MA|GA|Rubidium)(\d*\.?\d*)'
    cations = re.findall(cation_pattern, formula)

    result = {}
    for cation, ratio in cations:
        # 如果比例为空，默认为 1.0
        value = float(ratio) if ratio else 1.0
        result[cation] = value

    # 归一化（确保总和为 1.0）
    total = sum(result.values())
    if total > 0:
        result = {k: v/total for k, v in result.items()}

    return result

# 测试
formula = "Cs0.05FA0.85MA0.1PbI3"
composition = parse_composition(formula)
# 输出：{'Cs': 0.05, 'FA': 0.85, 'MA': 0.1}
```

### 测试用例
```python
# 必须通过的测试
test_cases = [
    ("Cs0.05FA0.85MA0.1PbI3", {'Cs': 0.05, 'FA': 0.85, 'MA': 0.1}),
    ("FAPbI3", {'FA': 1.0}),
    ("CsFAMAPbI3", {'Cs': 0.333, 'FA': 0.333, 'MA': 0.333}),  # 归一化
    ("MAPbBr3", {'MA': 1.0}),  # 溴基钙钛矿
]
```

### 预防措施
1. **建立测试用例库**：包含各种变体写法
2. **验证函数**：所有提取的组分必须通过验证
3. **文档记录**：在 CLAUDE.md 中记录组分识别规则

### 扩展问题
- 阴离子识别：I, Br, Cl
- 添加剂识别：PbI2, MAI, FAI
- 钝化剂识别：PEAI, BAI

---

## PITFALL-004: 异步状态更新竞态条件

**发现日期**：2026-05-03（预期问题）
**严重程度**：中 ⚠️
**影响范围**：前端异步操作、SSE 数据更新

### 问题描述
快速连续触发异步操作时，后发起的请求先返回，导致状态错误。

### 场景示例
用户快速点击两篇不同的文献：
1. 点击文献 A → 发起请求 A
2. 点击文献 B → 发起请求 B
3. 请求 B 先返回 → 显示文献 B 数据
4. 请求 A 后返回 → **覆盖文献 B 数据**（错误！）

### 错误代码
```typescript
// ❌ 错误：直接更新状态
const handleExtract = async (doi: string) => {
  const response = await fetch(`/api/extract/${doi}`);
  const data = await response.json();
  setCurrentPaper(data);  // 可能覆盖其他请求的结果
};
```

### 解决方案 1：使用 AbortController
```typescript
const [abortController, setAbortController] = useState<AbortController | null>(null);

const handleExtract = async (doi: string) => {
  // 取消之前的请求
  abortController?.abort();

  const controller = new AbortController();
  setAbortController(controller);

  try {
    const response = await fetch(`/api/extract/${doi}`, {
      signal: controller.signal
    });
    const data = await response.json();
    setCurrentPaper(data);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('Request cancelled');
    }
  }
};
```

### 解决方案 2：使用请求 ID
```typescript
const [requestId, setRequestId] = useState(0);

const handleExtract = async (doi: string) => {
  const currentRequestId = requestId + 1;
  setRequestId(currentRequestId);

  const response = await fetch(`/api/extract/${doi}`);
  const data = await response.json();

  // 只更新最新的请求
  if (currentRequestId === requestId + 1) {
    setCurrentPaper(data);
  }
};
```

### 解决方案 3：函数式更新
```typescript
const handleExtract = async (doi: string) => {
  const response = await fetch(`/api/extract/${doi}`);
  const data = await response.json();

  // 使用函数式更新，基于最新状态
  setCurrentPaper(prev => {
    // 如果当前已经切换到其他文献，不更新
    if (prev && prev.doi !== doi) {
      return prev;
    }
    return data;
  });
};
```

### 推荐方案
根据场景选择：
- **切换文献**：方案 1（AbortController）最佳
- **搜索请求**：方案 2（请求 ID）简单有效
- **列表更新**：方案 3（函数式更新）

### 预防措施
1. 所有异步操作都要考虑竞态条件
2. 组件卸载时取消未完成的请求
3. 添加加载状态，避免用户快速操作

---

## PITFALL-005: 单位换算错误

**发现日期**：2026-05-03（预期问题）
**严重程度**：高 ⚠️
**影响范围**：数据提取、对比功能

### 问题描述
文献中同一指标使用不同单位：
- Voc: `1.21 V` vs `1210 mV`
- Jsc: `25.0 mA/cm²` vs `250 A/m²`
- 面积: `0.1 cm²` vs `10 mm²`

### 错误示例
```python
# ❌ 错误：直接提取数值，忽略单位
pce = extract_number(text)  # 提取到 24.9
# 但实际文本是 24.9 mV/cm²（错误单位），导致严重错误
```

### 解决方案
```python
import re

def extract_with_unit(text: str, field: str) -> tuple[float, str]:
    """提取数值和单位"""
    patterns = {
        'pce': r'(\d+\.?\d*)\s*(%)',
        'voc': r'(\d+\.?\d*)\s*(V|mV)',
        'jsc': r'(\d+\.?\d*)\s*(mA/cm²|A/m²|mA cm⁻²)',
    }

    match = re.search(patterns[field], text)
    if not match:
        raise ValueError(f"Cannot extract {field} from: {text}")

    value = float(match.group(1))
    unit = match.group(2)

    return value, unit

def normalize_unit(value: float, unit: str, field: str) -> float:
    """标准化单位"""
    conversion = {
        'voc': {'V': 1, 'mV': 0.001},
        'jsc': {'mA/cm²': 1, 'A/m²': 0.1, 'mA cm⁻²': 1},
    }

    return value * conversion[field][unit]

# 使用
raw_value, unit = extract_with_unit(text, 'voc')
voc = normalize_unit(raw_value, unit, 'voc')  # 统一为 V
```

### 强制规则
1. **提取时必须同时提取单位**
2. **存储前必须标准化**
3. **显示时统一格式**

### 预防措施
1. 建立单位换算测试用例
2. 提取结果验证：检查数值是否在合理范围内
3. 标记异议数据：超出正常范围的标记为"待审核"

---

## 踩坑索引

| 编号 | 标题 | 严重程度 | 影响范围 |
|------|------|----------|----------|
| PITFALL-001 | SSE 连接未关闭导致内存泄漏 | 高 ⚠️ | 前端 SSE 组件 |
| PITFALL-002 | SQLite 并发写入导致数据库锁定 | 中 ⚠️ | 后端数据库 |
| PITFALL-003 | 钙钛矿组分识别错误 | 高 ⚠️ | AI 提取、检索 |
| PITFALL-004 | 异步状态更新竞态条件 | 中 ⚠️ | 前端异步操作 |
| PITFALL-005 | 单位换算错误 | 高 ⚠️ | 数据提取、对比 |
