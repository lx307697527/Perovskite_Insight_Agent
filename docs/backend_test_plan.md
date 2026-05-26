# 后端接口测试计划

**项目名称**：Sci-Insight Agent (SIA) Backend Sidecar
**文档版本**：V1.0
**日期**：2026-05-18
**依据**：PRD V2.1 + System Architecture V2.1

---

## 1. 测试范围

### 1.1 覆盖模块

| 模块 | 文件 | 路由前缀 | 端点数 |
|------|------|---------|--------|
| 健康检查 | `main.py` | `/` | 1 |
| 配置与引导 | `api/config.py` | `/api/config/*` | 8 |
| 项目管理 | `api/projects.py` | `/api/projects/*` | 6 |
| 文献管理 | `api/literature.py` | `/api/literature/*`, `/api/inbox/*`, `/api/paper/*` | 10 |
| 检索 | `api/search.py` | `/api/search` | 1 |
| 参数提取 | `api/extract.py` | `/api/extract/*` | 7 |
| 精准问答 | `api/qa.py` | `/api/qa/*` | 3 |
| 多文档问答 | `api/chat.py` | `/api/chat/*` | 3 |
| 对比与导出 | `api/compare.py` | `/api/project/*/compare*` | 2 |
| V1 兼容路由 | 分散在各模块 | `/api/settings`, `/api/extract/v1/*` 等 | 6 |

**总计**：约 47 个端点

### 1.2 不覆盖范围

- 前端 UI 交互测试（属前端测试计划）
- Tauri 壳体集成测试
- PyInstaller 打包测试
- 性能压测（另出专项性能测试计划）

---

## 2. 测试环境

| 环境 | 说明 |
|------|------|
| 开发环境 | Windows 11, Python 3.12+, FastAPI + uvicorn `--reload` |
| 数据库 | SQLite (WAL 模式), 路径 `%APPDATA%/SIA/storage.db` |
| 外部依赖 | Semantic Scholar API, OpenAlex API, OpenAI 兼容 LLM API |
| 测试框架 | pytest + httpx (ASGI test client) |
| 并发测试 | pytest-xdist (可选) |

---

## 3. 测试策略

### 3.1 测试分层

```
┌─────────────────────────────────────────────────────────────┐
│ E2E 测试 (可选)                                             │
│ 启动完整 uvicorn 服务，用 curl/Postman 验证端到端流程        │
├─────────────────────────────────────────────────────────────┤
│ 集成测试 (httpx TestClient)                                 │
│ 连接真实 SQLite，验证 DB 读写 + 业务逻辑                     │
│ 外部 API 调用使用 pytest-mock 模拟                           │
├────────────────────────  ───────────────────────────────────┤
│ 单元测试                                                    │
│ 纯函数测试：normalizer, progress tracker, _latex_escape 等   │
│ 不依赖 FastAPI, 不依赖 DB                                   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 测试优先级

| 优先级 | 标准 | 覆盖范围 |
|--------|------|---------|
| P0 — 阻塞 | 核心业务流程，失败则阻断开发 | 配置引导、文献添加、Stage1/Stage2 提取、精准问答 |
| P1 — 高 | 主要功能，影响用户体验 | 项目管理、对比看板、导出、Multi-Doc Chat |
| P2 — 中 | 辅助功能，不影响主流程 | V1 兼容路由、搜索历史、缓存管理 |
| P3 — 低 | 边界情况、防御性测试 | 路径遍历防护、并发竞态、大文件处理 |

---

## 4. 详细测试用例

### 4.1 健康检查

| 编号 | 端点 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| HC-01 | `GET /` | 正常启动 | 200, `{"status": "ok"}` | P0 |
| HC-02 | — | 数据库未初始化 | 启动时 `init_db()` 不崩溃 | P0 |
| HC-03 | — | V1 数据迁移 | `migrate_v1_data()` 不报错 | P2 |

### 4.2 配置与引导 (`/api/config/*`)

| 编号 | 端点 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| CFG-01 | `GET /api/config/status` | 无配置（首次启动） | `needs_onboarding: true` | P0 |
| CFG-02 | `GET /api/config/status` | 有配置 | `needs_onboarding: false`, 返回缓存统计 | P0 |
| CFG-03 | `POST /api/config/ai-engine` | 有效配置 + 连通成功 | 200, 配置持久化到加密存储 | P0 |
| CFG-04 | `POST /api/config/ai-engine` | API Key 无效 (401) | 400, 中文错误提示 | P0 |
| CFG-05 | `POST /api/config/ai-engine` | Base URL 不可达 | 400, 连接错误提示 | P1 |
| CFG-06 | `POST /api/config/ai-engine` | Base URL 超时 | 408, 超时提示 | P1 |
| CFG-07 | `POST /api/config/ai-engine` | API Key 为空 | 422, 字段校验失败 | P0 |
| CFG-08 | `POST /api/config/test-connectivity` | 连通性测试 | 200 或具体错误码 | P1 |
| CFG-09 | `POST /api/config/proxy` | 保存代理配置 | 200, 配置持久化 | P1 |
| CFG-10 | `POST /api/config/proxy` | 保存 Cookie Header | 200, cookieHeader 持久化 | P1 |
| CFG-11 | `PUT /api/config/domains` | 有效 domain (perovskite) | 200 | P0 |
| CFG-12 | `PUT /api/config/domains` | 无效 domain | 400 | P1 |
| CFG-13 | `POST /api/config/embedding/verify` | 模型已就绪 | `status: "ready"` | P1 |
| CFG-14 | `POST /api/config/embedding/verify` | 模型未安装 | `status: "not_installed"` | P2 |
| CFG-15 | `GET /api/config/cache` | 获取缓存统计 | 返回论文数、提取数、缓存大小 | P2 |
| CFG-16 | `DELETE /api/config/cache` | 清理缓存 | 删除 downloads 目录，DB 记录保留 | P2 |

### 4.3 项目管理 (`/api/projects/*`)

| 编号 | 端点 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| PRJ-01 | `POST /api/projects` | 创建项目（有效名称） | 200, 返回 project_id | P0 |
| PRJ-02 | `POST /api/projects` | 创建项目（空名称） | 422, 字段校验失败 | P0 |
| PRJ-03 | `GET /api/projects` | 无项目 | 200, `data: []` | P0 |
| PRJ-04 | `GET /api/projects` | 有项目 | 返回项目列表 + 文献计数 | P0 |
| PRJ-05 | `GET /api/projects/{id}` | 项目存在 | 返回项目详情 + 文献列表 | P0 |
| PRJ-06 | `GET /api/projects/{id}` | 项目不存在 | 404 | P0 |
| PRJ-07 | `PUT /api/projects/{id}` | 更新项目名 | 200, 名称已更新 | P1 |
| PRJ-08 | `DELETE /api/projects/{id}` | 删除项目 | 文献 project_id 置 NULL（移入收集箱） | P0 |
| PRJ-09 | `POST /api/projects/{id}/literature` | 分配文献到项目 | 返回 updated_count | P0 |
| PRJ-10 | `POST /api/projects/{id}/literature` | DOI 不存在 | updated_count = 0 | P1 |

### 4.4 文献管理 (`/api/literature/*`, `/api/inbox/*`)

| 编号 | 端点 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| LIT-01 | `POST /api/literature/add` | 输入 DOI | 自动识别为 DOI 类型，入库 | P0 |
| LIT-02 | `POST /api/literature/add` | 输入关键词 | 自动识别为 keyword，返回搜索结果 | P0 |
| LIT-03 | `POST /api/literature/add` | DOI 已存在（缓存命中） | 返回 `cached: true` | P0 |
| LIT-04 | `POST /api/literature/upload` | 上传 PDF 文件 | 200, 生成 upload_id | P0 |
| LIT-05 | `POST /api/literature/upload` | 上传非 PDF 文件 | 400, "Only PDF files are allowed" | P0 |
| LIT-06 | `POST /api/literature/doi` | 有效 DOI | 解析元数据，入库 | P1 |
| LIT-07 | `POST /api/literature/doi` | 无效 DOI 格式 | 400, "Invalid DOI format" | P0 |
| LIT-08 | `GET /api/literature/{doi}` | 文献存在 | 返回完整详情（含提取结果） | P0 |
| LIT-09 | `GET /api/literature/{doi}` | 文献不存在 | 404 | P0 |
| LIT-10 | `DELETE /api/literature/{doi}` | 删除文献 | 200, 文献已删除 | P1 |
| LIT-11 | `GET /api/inbox` | 有收集箱文献 | 返回 project_id=NULL 的文献列表 | P0 |
| LIT-12 | `POST /api/inbox/{doi}/move` | 移入项目 | 200, project_id 已更新 | P0 |
| LIT-13 | `POST /api/inbox/{doi}/move` | 项目不存在 | 404 | P1 |
| LIT-14 | `GET /api/paper/{doi}` | V1 兼容：已提取文献 | 返回 metrics + process 格式化数据 | P1 |
| LIT-15 | `GET /api/paper/{doi}` | V1 兼容：upload_ 前缀 | 从 upload_manager 获取结果 | P2 |
| LIT-16 | `GET /api/paper/{doi}` | V1 兼容：占位标题 | 自动从 Semantic Scholar 刷新元数据 | P2 |

### 4.5 检索 (`/api/search`)

| 编号 | 端点 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| SRCH-01 | `GET /api/search?query=perovskite` | 正常检索 | 200, 返回双引擎合并结果 | P0 |
| SRCH-02 | `GET /api/search?query=` | 空查询 | 200, 返回空列表（或 400） | P1 |
| SRCH-03 | `GET /api/search?query=<500字符` | 超长查询 | 400, "Query too long" | P1 |
| SRCH-04 | `GET /api/search?year_start=2024&year_end=2026` | 年份过滤 | 结果年份在范围内 | P1 |
| SRCH-05 | — | 双引擎去重 | 同一 DOI 只出现一次 | P1 |

### 4.6 参数提取 (`/api/extract/*`) — SSE 端点

> SSE 端点测试需使用 httpx 的 `ASGIAsyncClient` 或启动真实服务用 `curl -N` 验证。

| 编号 | 端点 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| EXT-01 | `POST /api/extract/{doi}/stage1` | 正常 Stage1 | SSE 流：screening → completed, 含 relevance_score | P0 |
| EXT-02 | `POST /api/extract/{doi}/stage1` | DOI 不存在 | SSE 流：failed 事件 | P0 |
| EXT-03 | `POST /api/extract/{doi}/deep` | 正常 Stage2 | SSE 流：5 阶段进度 → completed | P0 |
| EXT-04 | `POST /api/extract/{doi}/deep` | 缓存命中 | SSE 流：`status: "cached"` | P1 |
| EXT-05 | `POST /api/extract/{doi}/deep` | 提取失败 | SSE 流：`status: "failed"`, 含 error 信息 | P0 |
| EXT-06 | `GET /api/extract/{doi}/status` | 提取中 | 返回当前 stage + progress + eta | P0 |
| EXT-07 | `GET /api/extract/{doi}/status` | 未提取 | `stage: "none", progress: 0` | P1 |
| EXT-08 | `POST /api/extract/{doi}/cancel` | 取消提取 | 200, tracker 已移除 | P1 |
| EXT-09 | `GET /api/extract/v1/{doi}` | V1 兼容 SSE | SSE 流（GET 方法） | P2 |
| EXT-10 | `POST /api/extract/local` | 本地 PDF 提取 | SSE 流，路径验证通过 | P1 |
| EXT-11 | `POST /api/extract/local` | 路径遍历攻击 | 403, "Access denied" | P3 |
| EXT-12 | `POST /api/extract/upload` | 上传 PDF 并提取 | SSE 流，120s 超时 | P1 |

### 4.7 精准问答 (`/api/qa/*`)

| 编号 | 端点 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| QA-01 | `POST /api/qa/{doi}` | 正常问答 | SSE 流：content → source → done | P0 |
| QA-02 | `POST /api/qa/{doi}` | 空问题 | 400, "Question cannot be empty" | P0 |
| QA-03 | `POST /api/qa/{doi}` | 问题超长 (>1000 字符) | 400, "Question too long" | P1 |
| QA-04 | `POST /api/qa/{doi}` | Embedding 模型加载中 | 503, "still loading" | P1 |
| QA-05 | `POST /api/qa/{doi}` | Embedding 模型未就绪 | 503, "not available" | P1 |
| QA-06 | `POST /api/qa/{doi}` | DOI 不存在 | 404 | P0 |
| QA-07 | `POST /api/qa/{doi}` | 无效 DOI 格式 | 400 | P0 |
| QA-08 | `GET /api/qa/{doi}/history` | 有问答历史 | 返回历史记录列表 | P1 |
| QA-09 | `GET /api/qa/{doi}/suggestions` | 获取快捷问题 | 返回 3-5 个建议问题 | P1 |

### 4.8 多文档问答 (`/api/chat/*`)

| 编号 | 端点 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| CHAT-01 | `POST /api/chat` | 正常 Multi-Doc 问答 | SSE 流：content → source → done | P0 |
| CHAT-02 | `POST /api/chat` | 空问题 | 400 | P0 |
| CHAT-03 | `POST /api/chat` | 问题超长 (>2000 字符) | 400 | P1 |
| CHAT-04 | `POST /api/chat` | 项目不存在 | 404 | P0 |
| CHAT-05 | `POST /api/chat` | Embedding 模型未就绪 | 503 | P1 |
| CHAT-06 | `POST /api/chat` | 带 context_dois 参数 | 仅使用指定文献 | P1 |
| CHAT-07 | `GET /api/chat/sessions?project_id=x` | 列出会话 | 返回会话列表 | P2 |
| CHAT-08 | `GET /api/chat/sessions/{id}` | 获取会话详情 | 返回消息历史 | P2 |

### 4.9 对比与导出 (`/api/project/*/compare*`)

| 编号 | 端点 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| CMP-01 | `GET /api/project/{id}/compare` | 正常对比 | 返回 columns + rows + warnings | P0 |
| CMP-02 | `GET /api/project/{id}/compare` | 扫描方向过滤 (R-scan) | 仅返回 R-scan 数据 | P0 |
| CMP-03 | `GET /api/project/{id}/compare` | SPO 过滤 | 仅返回有/无 SPO 数据 | P0 |
| CMP-04 | `GET /api/project/{id}/compare` | 年份范围过滤 | 结果年份在范围内 | P1 |
| CMP-05 | `GET /api/project/{id}/compare` | ISOS 协议过滤 | 按协议等级过滤 | P1 |
| CMP-06 | `GET /api/project/{id}/compare` | view_mode=literature | 文献作为列，指标作为行 | P1 |
| CMP-07 | `GET /api/project/{id}/compare` | 项目不存在 | `success: false` | P0 |
| CMP-08 | `GET /api/project/{id}/compare` | 无提取文献 | 返回空 rows，total=0 | P1 |
| CMP-09 | `POST /api/project/{id}/compare/export` | 导出 Excel | application/vnd.openxmlformats... | P0 |
| CMP-10 | `POST /api/project/{id}/compare/export` | 导出 CSV | text/csv, UTF-8 BOM | P0 |
| CMP-11 | `POST /api/project/{id}/compare/export` | 导出 LaTeX | text/x-tex, 含 tablenotes | P0 |
| CMP-12 | `POST /api/project/{id}/compare/export` | 导出 PNG | image/png, 含质量警告着色 | P1 |
| CMP-13 | `POST /api/project/{id}/compare/export` | 导出 SVG | image/svg+xml | P1 |
| CMP-14 | `POST /api/project/{id}/compare/export` | 不支持的格式 | 400, "Unsupported export format" | P1 |
| CMP-15 | `GET /api/export/excel` | V1 兼容导出 | 返回 Excel 文件 | P2 |

### 4.10 V1 兼容路由

| 编号 | 端点 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| V1-01 | `POST /api/settings` | V1 配置更新 | 200, 配置持久化 | P2 |
| V1-02 | `GET /api/extract/{doi}` (main.py) | V1 SSE 提取代理 | 200, SSE 流 | P2 |
| V1-03 | `POST /api/translate` | V1 文本翻译 | 200, 返回翻译结果 | P2 |
| V1-04 | `GET /api/history` | V1 搜索历史 | 200, 返回最近 20 条 | P2 |
| V1-05 | `DELETE /api/history/clear` | V1 清空历史 | 200, 清空 QuickQuestion/SIFile/Literature | P2 |
| V1-06 | `GET /api/pdf/{doi}` | V1 PDF 下载 | 200, application/pdf | P2 |

### 4.11 核心算法单元测试

| 编号 | 模块 | 场景 | 预期 | 优先级 |
|------|------|------|------|--------|
| ALG-01 | `normalizer.normalize_composition` | "5% Cs Triple Cation" | `Cs0.05FA0.85MA0.1PbI3` | P0 |
| ALG-02 | `normalizer.normalize_composition` | "Cs/FA/MA Pb I/Br" | `Cs0.05FA0.85MA0.1Pb(I0.85Br0.15)3` | P0 |
| ALG-03 | `normalizer.parse_metric_value` | "25.1%" | (25.1, "%") | P0 |
| ALG-04 | `normalizer.parse_metric_value` | "1.21 V" | (1.21, "V") | P0 |
| ALG-05 | `normalizer.evaluate_quality_flags` | 仅 R-scan | WARNING: "仅 R-scan" | P0 |
| ALG-06 | `normalizer.evaluate_quality_flags` | 双向+SPO | OK | P0 |
| ALG-07 | `progress` | 阶段式进度跟踪 | 正确计算 ETA | P1 |
| ALG-08 | `compare._latex_escape` | "Zhang & Li" | "Zhang \\& Li" | P1 |
| ALG-09 | `compare._latex_escape` | "100%" | "100\\%" | P1 |

---

## 5. 非功能性测试

### 5.1 错误处理

| 编号 | 场景 | 预期 | 优先级 |
|------|------|------|--------|
| ERR-01 | 所有端点未捕获异常 | 返回 500 + 结构化错误信息 | P0 |
| ERR-02 | SQLite 并发写入 | WAL 模式下不崩溃，不报 "database is locked" | P1 |
| ERR-03 | LLM API 返回非 JSON | 优雅降级，不崩溃 | P1 |
| ERR-04 | PDF 文件损坏 | 标记提取失败，记录错误日志 | P1 |
| ERR-05 | DOI 格式错误 | 400 + 中文错误提示 | P0 |

### 5.2 安全性

| 编号 | 场景 | 预期 | 优先级 |
|------|------|------|--------|
| SEC-01 | API Key 记录到日志 | 不出现明文 Key | P0 |
| SEC-02 | 路径遍历攻击 (`../../etc/passwd`) | 403 拒绝 | P0 |
| SEC-03 | XSS 输入（文献标题含 `<script>`） | 入库时转义 | P1 |
| SEC-04 | SQL 注入（DOI 含 `' OR 1=1`） | 参数化查询，不执行注入 | P0 |
| SEC-05 | CORS 配置 | 仅允许 `*`（桌面端无跨域问题） | P2 |

### 5.3 SSE 连接管理

| 编号 | 场景 | 预期 | 优先级 |
|------|------|------|--------|
| SSE-01 | SSE 连接中断后重连 | 服务端不泄漏资源 | P1 |
| SSE-02 | 多个客户端同时请求同一 DOI 提取 | 不重复执行，返回已有 tracker | P1 |
| SSE-03 | SSE 超时（>5 分钟） | 自动终止，清理 tracker | P0 |
| SSE-04 | SSE finally 块执行 | remove_tracker 始终调用 | P1 |

---

## 6. 测试数据

### 6.1 测试用 DOI

| DOI | 用途 | 备注 |
|-----|------|------|
| `10.1021/jacs.3c12345` | 正常提取测试 | 模拟真实 DOI |
| `10.9999/nonexistent.test` | 不存在文献测试 | 预期 404 |
| `not-a-doi` | 格式校验测试 | 预期 400 |
| `local_test_pdf` | 本地 PDF 测试 | 伪 DOI |

### 6.2 测试用配置

```json
{
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "sk-test-key-for-testing-only",
  "model": "gpt-4o-mini",
  "stage1Model": "gpt-4o-mini",
  "stage2Model": "gpt-4o",
  "domain": "perovskite"
}
```

> 测试时通过 `pytest-mock` 模拟 httpx 和 openai 客户端调用，不实际发送网络请求。

---

## 7. 测试执行计划

### 7.1 执行顺序

```
1. 单元测试 (ALG-01 ~ ALG-09)       — 最快，无外部依赖
2. 集成测试 (CFG/LIT/PRJ/HC)         — 需要 SQLite
3. SSE 集成测试 (EXT/QA/CHAT)         — 需要模拟 LLM 响应
4. 导出测试 (CMP-09 ~ CMP-14)        — 需要模拟 matplotlib
5. 安全测试 (SEC-01 ~ SEC-05)        — 可并行
6. 错误处理测试 (ERR-01 ~ ERR-05)     — 可并行
7. V1 兼容测试 (V1-01 ~ V1-06)       — 最后，确保不破坏兼容
```

### 7.2 自动化与 CI

| 阶段 | 触发 | 覆盖 |
|------|------|------|
| 本地运行 | `pytest` | 全部单元测试 + 集成测试 |
| PR 检查 | GitHub Actions | 单元测试 + 核心集成测试 (P0) |
|  nightly | GitHub Actions | 全量测试 + SSE 测试 |

### 7.3 覆盖率目标

| 层级 | 行覆盖率 | 分支覆盖率 |
|------|---------|-----------|
| `api/` 路由层 | ≥ 80% | ≥ 70% |
| `core/` 业务层 | ≥ 90% | ≥ 80% |
| 整体 | ≥ 85% | ≥ 75% |

---

## 8. 已知测试难点与应对

| 难点 | 原因 | 应对方案 |
|------|------|---------|
| SSE 流测试 | httpx TestClient 对 StreamingResponse 支持有限 | 使用 `httpx.AsyncClient` + 启动真实 uvicorn 服务，或自定义 SSE 解析器 |
| LLM API 调用 | 需要真实 API Key，成本高 | 全部使用 `pytest-mock` 模拟 `openai.AsyncOpenAI` 和 `httpx.AsyncClient` |
| Embedding 模型 | ~420MB，加载慢 | 测试时 mock `model_manager.get_status()` 返回 `"ready"` |
| 双引擎检索 | 依赖 Semantic Scholar + OpenAlex 可用性 | mock `crawler.search_papers_dual_engine()` 返回固定测试数据 |
| matplotlib 导出 | PNG/SVG 导出依赖图形后端 | 测试时 mock `plt.savefig()`，仅验证返回的 MIME type 和 headers |
| 并发竞态 | ThreadPoolExecutor 并发提取 | 使用 `pytest-xdist` 或手动构造多线程场景 |
