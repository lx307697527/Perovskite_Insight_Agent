# 最佳实践模式库

本文档记录成功的代码模式、设计模式，供后续开发复用。

---

## PATTERN-001: API 调用封装模式

### 适用场景
前端需要调用后端 API 时。

### 模式代码

**服务层封装** (`src/services/api.ts`):
```typescript
const API_BASE = 'http://localhost:8000';

// 自定义错误类
export class APIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// API 服务对象
export const api = {
  /**
   * 检索文献
   */
  async search(query: string): Promise<SearchResult> {
    try {
      const response = await fetch(
        `${API_BASE}/api/search?query=${encodeURIComponent(query)}`,
        {
          signal: AbortSignal.timeout(30000), // 30秒超时
        }
      );

      if (!response.ok) {
        throw new APIError(
          `Search failed: ${response.statusText}`,
          response.status
        );
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new APIError('Request timeout', 0, 'TIMEOUT');
      }
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError('Network error', 0, 'NETWORK_ERROR');
    }
  },

  /**
   * 提取论文参数（SSE 流）
   */
  extractPaper(
    doi: string,
    onProgress: (progress: number) => void,
    onComplete: (data: any) => void,
    onError: (error: Error) => void
  ): () => void {
    const eventSource = new EventSource(`${API_BASE}/api/extract/${doi}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.status) {
        case 'extracting':
          onProgress(data.progress);
          break;
        case 'completed':
          onComplete(data.data);
          eventSource.close();
          break;
        case 'failed':
          onError(new APIError(data.error, 0, 'EXTRACTION_FAILED'));
          eventSource.close();
          break;
      }
    };

    eventSource.onerror = () => {
      onError(new APIError('SSE connection failed', 0, 'SSE_ERROR'));
      eventSource.close();
    };

    // 返回清理函数
    return () => {
      eventSource.close();
    };
  },
};

// 类型定义
interface SearchResult {
  results: Literature[];
  warning?: string;
}

interface Literature {
  doi: string;
  title: string;
  journal?: string;
  year?: number;
  authors?: string;
  relevance: number;
}
```

**组件使用** (`src/pages/HomePage.tsx`):
```typescript
import { api, APIError } from '../services/api';

const handleSearch = async () => {
  setLoading(true);
  try {
    const result = await api.search(query);
    setSearchResults(result.results);
    if (result.warning) {
      showToast(result.warning, 'info');
    }
  } catch (error) {
    if (error instanceof APIError) {
      showToast(error.message, 'error');
    } else {
      showToast('Unknown error', 'error');
    }
  } finally {
    setLoading(false);
  }
};
```

### 优点
1. **统一错误处理**：所有 API 错误通过自定义 Error 类
2. **超时控制**：避免请求无限等待
3. **类型安全**：返回值有明确类型定义
4. **可测试**：封装后易于 mock
5. **可维护**：所有 API 调用集中管理

### 适用场景判断
- ✅ 所有 API 调用都应该封装
- ✅ 需要统一错误处理
- ✅ 需要超时控制

---

## PATTERN-002: SSE 连接管理模式

### 适用场景
前端需要接收服务端实时推送的数据。

### 模式代码

**自定义 Hook** (`src/hooks/useSSE.ts`):
```typescript
import { useEffect, useState, useRef } from 'react';

interface SSEOptions<T> {
  url: string;
  onMessage: (data: T) => void;
  onError?: (error: Error) => void;
  maxRetries?: number;
  retryDelay?: number;
}

export function useSSE<T>(options: SSEOptions<T>) {
  const {
    url,
    onMessage,
    onError,
    maxRetries = 3,
    retryDelay = 2000
  } = options;

  const [retryCount, setRetryCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    let eventSource: EventSource;
    let retryTimeoutId: NodeJS.Timeout;

    const connect = () => {
      eventSource = new EventSource(url);
      setIsConnected(true);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (isMountedRef.current) {
            onMessage(data);
            setRetryCount(0); // 成功接收消息后重置重试计数
          }
        } catch (error) {
          console.error('Failed to parse SSE message:', error);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);

        if (retryCount < maxRetries && isMountedRef.current) {
          setRetryCount(prev => prev + 1);
          retryTimeoutId = setTimeout(() => {
            eventSource.close();
            connect(); // 重连
          }, retryDelay);
        } else {
          onError?.(new Error('Max retries exceeded'));
          eventSource.close();
        }
      };
    };

    connect();

    return () => {
      isMountedRef.current = false;
      eventSource?.close();
      clearTimeout(retryTimeoutId);
    };
  }, [url, retryCount]);

  return { retryCount, isConnected };
}
```

**组件使用**:
```typescript
import { useSSE } from '../hooks/useSSE';

const ResultsPage: React.FC = () => {
  const [progress, setProgress] = useState(0);
  const [data, setData] = useState(null);

  const { retryCount, isConnected } = useSSE({
    url: `/api/extract/${doi}`,
    onMessage: (message) => {
      if (message.status === 'extracting') {
        setProgress(message.progress);
      } else if (message.status === 'completed') {
        setData(message.data);
      }
    },
    onError: (error) => {
      showToast(`Connection failed: ${error.message}`, 'error');
    },
    maxRetries: 3,
  });

  return (
    <div>
      {isConnected ? (
        <p>Progress: {progress}%</p>
      ) : (
        <p>Reconnecting... (attempt {retryCount})</p>
      )}
    </div>
  );
};
```

### 优点
1. **自动重连**：断线后自动重试
2. **资源清理**：组件卸载时自动关闭连接
3. **竞态安全**：使用 `isMountedRef` 避免更新已卸载组件
4. **可配置**：重试次数、延迟可配置
5. **状态可见**：`isConnected` 和 `retryCount` 可用于 UI 反馈

### 适用场景判断
- ✅ 所有使用 EventSource 的地方
- ✅ 需要自动重连的场景
- ✅ 需要在组件卸载时清理资源

---

## PATTERN-003: 线程安全的任务状态管理

### 适用场景
Python 后端需要管理多个并发任务的状态。

### 模式代码

**任务管理器** (`backend/task_manager.py`):
```python
from threading import Lock
from typing import Dict, Optional
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

class TaskStatus(Enum):
    PENDING = 'pending'
    RUNNING = 'running'
    COMPLETED = 'completed'
    FAILED = 'failed'

@dataclass
class Task:
    """任务状态数据类"""
    task_id: str
    status: TaskStatus = TaskStatus.PENDING
    progress: int = 0
    started_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    result: Optional[dict] = None

class TaskManager:
    """线程安全的任务管理器"""

    def __init__(self):
        self._tasks: Dict[str, Task] = {}
        self._lock = Lock()

    def create(self, task_id: str) -> Task:
        """创建新任务"""
        with self._lock:
            task = Task(task_id=task_id)
            self._tasks[task_id] = task
            return task

    def update(self, task_id: str, **kwargs) -> Optional[Task]:
        """线程安全更新任务状态"""
        with self._lock:
            if task_id not in self._tasks:
                return None

            task = self._tasks[task_id]

            # 更新允许的字段
            for key, value in kwargs.items():
                if hasattr(task, key):
                    setattr(task, key, value)

            # 自动设置完成时间
            if kwargs.get('status') in [TaskStatus.COMPLETED, TaskStatus.FAILED]:
                task.completed_at = datetime.now()

            return task

    def get(self, task_id: str) -> Optional[Task]:
        """线程安全读取任务状态"""
        with self._lock:
            return self._tasks.get(task_id)

    def delete(self, task_id: str) -> bool:
        """删除任务"""
        with self._lock:
            if task_id in self._tasks:
                del self._tasks[task_id]
                return True
            return False

    def list_all(self) -> list[Task]:
        """获取所有任务"""
        with self._lock:
            return list(self._tasks.values())

    def cleanup_completed(self, max_age_hours: int = 24):
        """清理已完成的旧任务"""
        cutoff = datetime.now() - timedelta(hours=max_age_hours)

        with self._lock:
            to_delete = [
                task_id for task_id, task in self._tasks.items()
                if task.completed_at and task.completed_at < cutoff
            ]

            for task_id in to_delete:
                del self._tasks[task_id]
```

**FastAPI 集成**:
```python
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
import json

app = FastAPI()
task_manager = TaskManager()

@app.post('/api/extract/{doi}')
async def extract_paper(doi: str):
    """启动提取任务"""
    task_id = f"extract_{doi}"
    task_manager.create(task_id)

    # 在后台运行任务
    import threading
    thread = threading.Thread(
        target=run_extraction,
        args=(doi, task_id, task_manager)
    )
    thread.start()

    return {"task_id": task_id}

@app.get('/api/extract/{doi}/stream')
async def stream_extraction(doi: str):
    """SSE 流式返回进度"""
    task_id = f"extract_{doi}"

    def event_stream():
        while True:
            task = task_manager.get(task_id)
            if not task:
                yield f"data: {json.dumps({'error': 'Task not found'})}\n\n"
                break

            # 发送进度
            yield f"data: {json.dumps({
                'status': task.status.value,
                'progress': task.progress
            })}\n\n"

            # 任务完成或失败
            if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED]:
                yield f"data: {json.dumps({
                    'status': task.status.value,
                    'result': task.result,
                    'error': task.error
                })}\n\n"
                break

            time.sleep(1)

    return StreamingResponse(
        event_stream(),
        media_type='text/event-stream'
    )
```

### 优点
1. **线程安全**：所有操作加锁
2. **类型安全**：使用 dataclass 和 Enum
3. **封装性**：外部无需关心锁的实现
4. **自动清理**：避免内存泄漏
5. **可扩展**：易于添加新字段和方法

### 适用场景判断
- ✅ 多线程环境下管理共享状态
- ✅ 需要并发安全的任务队列
- ✅ 需要追踪任务进度

---

## PATTERN-004: React 状态提升模式

### 适用场景
多个组件需要共享状态，但不需要全局状态管理。

### 模式代码

```typescript
// App.tsx - 状态提升到共同父组件
const App: React.FC = () => {
  // 共享状态
  const [searchResults, setSearchResults] = useState<Literature[]>([]);
  const [selectedDoi, setSelectedDoi] = useState<string | null>(null);
  const [comparisonList, setComparisonList] = useState<string[]>([]);

  // 共享方法
  const handleSearch = async (query: string) => {
    const results = await api.search(query);
    setSearchResults(results);
  };

  const handleSelectForComparison = (doi: string) => {
    setComparisonList(prev =>
      prev.includes(doi)
        ? prev.filter(d => d !== doi)
        : [...prev, doi]
    );
  };

  return (
    <>
      <HomePage onSearch={handleSearch} />
      <ResultsPage
        results={searchResults}
        onSelect={handleSelectForComparison}
        comparisonList={comparisonList}
      />
      <ComparisonPage dois={comparisonList} />
    </>
  );
};
```

### 优点
1. **简单**：无需引入额外库
2. **清晰**：状态流向明确
3. **易调试**：所有状态在父组件可见

### 局限性
- Props 传递层级超过 3 层时，考虑使用 Context 或 Zustand
- 需要跨多层组件共享状态时，考虑全局状态管理

### 适用场景判断
- ✅ 状态在 2-3 个组件间共享
- ✅ 组件层级不深（< 3 层）
- ✅ 状态逻辑简单

---

## PATTERN-005: 数据验证与清洗模式

### 适用场景
从 AI 提取的数据需要验证和清洗。

### 模式代码

```python
from dataclasses import dataclass
from typing import Optional
import re

@dataclass
class DeviceMetrics:
    """器件性能指标"""
    pce: float  # %
    voc: float  # V
    jsc: float  # mA/cm²
    ff: float   # %

    # 条件标注
    scan_direction: str  # 'R-scan' | 'F-scan'
    has_spo: bool

    # 证据溯源
    evidence: str

def validate_metrics(data: dict) -> DeviceMetrics:
    """验证并清洗提取的数据"""

    # 1. 提取数值
    pce = extract_float(data.get('pce'))
    voc = extract_float(data.get('voc'))
    jsc = extract_float(data.get('jsc'))
    ff = extract_float(data.get('ff'))

    # 2. 范围验证
    if not (0 < pce <= 30):
        raise ValueError(f"PCE out of range: {pce}%")

    if not (0 < voc <= 2):
        raise ValueError(f"Voc out of range: {voc}V")

    if not (0 < jsc <= 30):
        raise ValueError(f"Jsc out of range: {jsc} mA/cm²")

    if not (0 < ff <= 100):
        raise ValueError(f"FF out of range: {ff}%")

    # 3. 扫描方向标准化
    scan_direction = data.get('scan_direction', 'unknown')
    if scan_direction.lower() in ['reverse', 'r-scan', '反向']:
        scan_direction = 'R-scan'
    elif scan_direction.lower() in ['forward', 'f-scan', '正向']:
        scan_direction = 'F-scan'
    else:
        scan_direction = 'Unknown'

    # 4. 必须有证据
    evidence = data.get('evidence', '')
    if not evidence:
        raise ValueError("Missing evidence for metrics")

    return DeviceMetrics(
        pce=pce,
        voc=voc,
        jsc=jsc,
        ff=ff,
        scan_direction=scan_direction,
        has_spo=bool(data.get('has_spo', False)),
        evidence=evidence
    )

def extract_float(value: any) -> float:
    """从各种格式提取浮点数"""
    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        # 提取数字部分
        match = re.search(r'(\d+\.?\d*)', value)
        if match:
            return float(match.group(1))

    raise ValueError(f"Cannot extract number from: {value}")
```

### 优点
1. **数据质量保证**：验证逻辑集中
2. **标准化**：统一处理变体写法
3. **错误友好**：清晰的错误信息
4. **可测试**：验证逻辑独立，易于测试

### 适用场景判断
- ✅ AI 提取的数据需要验证
- ✅ 数据有明确的范围约束
- ✅ 需要标准化处理变体格式

---

## 模式索引

| 编号 | 模式名称 | 适用场景 | 优势 |
|------|----------|----------|------|
| PATTERN-001 | API 调用封装 | 前端 API 调用 | 统一错误处理、类型安全 |
| PATTERN-002 | SSE 连接管理 | 实时数据推送 | 自动重连、资源清理 |
| PATTERN-003 | 任务状态管理 | 并发任务管理 | 线程安全、可扩展 |
| PATTERN-004 | React 状态提升 | 组件间共享状态 | 简单、易调试 |
| PATTERN-005 | 数据验证与清洗 | AI 提取数据 | 质量保证、标准化 |
