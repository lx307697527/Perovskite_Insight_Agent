# SIA V2.1 重构方案

> 基于 PRD V2.1 与 System Architecture V2.1 的全面对齐重构计划
>
> **V2.1-a 修订**：根据 2026-05-11 审计结果，补充 5 项 Critical、8 项 Important、6 项 Minor 遗漏

---

## 一、现状差距分析（Gap Analysis）

### 1.1 现有代码现状（V1.x 实现）

| 维度 | 现状 | PRD V2.1 要求 | 差距等级 |
|------|------|--------------|---------|
| 路由系统 | `useState` 手动切换 4 个页面 | React Router + 6 个页面（P00~P05） | 🔴 P0 |
| 页面数量 | 4 个（Home/Results/Details/Compare） | 7 个（P00/P01/P01b/P02/P03/P04/P05） | 🔴 P0 |
| 项目管理 | 无 Project 实体 | 完整 Project CRUD + 文献归属 + 临时收集箱 | 🔴 P0 |
| 精准问答 | 无 RAG 引擎，无 Q&A 功能 | RAG+FAISS 精准问答（<5s，~$0.005/问） | 🔴 P0 |
| 数据库模型 | Paper + ExtractionResult（极简，SQLAlchemy ORM） | 6 实体（Project/Literature/ChatSession/ChatMessage/QuickQuestion/SIFile） | 🔴 P0 |
| AI 两阶段 | 单模型单次提取（主文+SI） | Stage1（轻量摘要筛选）+ Stage2（深度提取）两阶段 | 🟠 P1 |
| 进度反馈 | 粗粒度百分比 | 5 阶段式进度 + 预估剩余时间 | 🟠 P1 |
| Embedding | 无 | 本地内置 BGE-base-en-v1.5（~420MB，随安装包发行） | 🔴 P0 |
| 配置系统 | 单模型配置（apiKey/baseUrl/model） | Stage1/Stage2 模型分别配置 + 代理 + 领域 | 🟠 P1 |
| P00 首次引导 | 无 | 3 步引导（API Key → 代理 → 领域选择） | 🔴 P0 |
| 导出格式 | 仅 Excel | LaTeX + PNG/SVG + Excel + CSV | 🟡 P2 |
| Multi-Doc Chat | 无 | 跨项目多文档问答 | 🟡 P2 |
| API 端点 | ~10 个（单体 main.py ~550 行） | 分模块 35+ 个端点（6 功能域） | 🟠 P1 |
| 后端结构 | 单文件 main.py + 7 个 core 模块 | 分层模块（api/ + core/ 各子模块） | 🟠 P1 |
| 安全存储 | config.json 明文 | AES-256 加密 settings.enc | 🟡 P2 |
| 中文搜索翻译 | 有 `translator.py`（LLM 翻译） | Architecture 4.2 要求保留 | 🟠 P1 |
| SI 智能切片 | extractor 内简单字符串查找 | 独立 `smart_slicer.py` 模块 | 🟠 P1 |
| 品牌标识 | PIA (Perovskite Insight Agent) | SIA (Sci-Insight Agent) | 🟡 P2 |

### 1.2 可复用资产清单

| 资产 | 文件位置 | 复用策略 |
|------|---------|---------|
| PDF 处理引擎 | `core/pdf_engine.py` | 直接保留，迁移至新模块结构 |
| 爬虫引擎 | `core/crawler.py` | 保留，与 `core/search.py` 分离职责 |
| AI 提取核心逻辑 | `core/extractor.py::_ai_extract()` | 保留，改造为 Stage2 深度提取 |
| AI 提示词 | `core/prompts.py` | 保留并扩展（新增 Stage1/Q&A Prompt） |
| 数据导出 | `core/exporter.py` | 扩展（新增 LaTeX/PNG 格式） |
| 中文翻译 | `core/translator.py` | 保留，集成至 `core/search.py` |
| 前端 Tailwind 设计系统 | `src/index.css` + `tailwind.config.js` | 完整保留 |
| API 服务层 | `src/services/api.ts` | 大幅扩展，保留基础结构（超时/错误处理模式） |
| TypeScript 类型 | `src/types/index.ts` | 完整重写（与新实体模型对齐） |
| 错误边界 | `src/components/ErrorBoundary.tsx` | 直接保留 |
| PDF 预览 | `src/components/PdfViewer.tsx` | 保留基础渲染，扩展片段高亮能力 |
| 设置弹窗 | `src/components/SettingsModal.tsx` | 保留 UI 结构，重写为 P05 配置中心 |

### 1.3 需要重写/弃用的资产

| 资产 | 原因 | 处理方式 |
|------|------|---------|
| `App.tsx` 路由逻辑 | useState → React Router | 完全重写 |
| `core/database.py` ORM 模型 | 2 实体 → 6 实体 | 重写 Schema（保留 SQLAlchemy ORM，见 Section 2.8） |
| SSE 连接方式 | `new EventSource(...)` 分散在各页面 | 统一为 `useSSE` Hook |
| `main.py` 路由定义 | 单文件 → 模块化 | 拆分至 `api/` 子模块 |
| 配置存储 `config.json` | 明文 → AES-256 加密 | 迁移至 `settings.enc` |

---

## 二、重构架构设计

### 2.1 目标目录结构

#### 前端（`src/`）

```
src/
├── main.tsx                   # 入口（保持不变）
├── App.tsx                    # 接入 React Router
├── index.css                  # 保留设计系统
│
├── router/
│   └── index.tsx              # 路由配置（6个页面）
│
├── pages/
│   ├── OnboardingPage.tsx     # P00 首次启动引导
│   ├── HomePage.tsx           # P01 首页（统一入口 + 项目门户）✏️ 重写
│   ├── QuickModePage.tsx      # P01b 快捷模式（单篇处理）🆕
│   ├── ProjectHubPage.tsx     # P02 项目枢纽 🆕
│   ├── InsightLabPage.tsx     # P03 见解实验室（精准问答中心）✏️ 重写
│   ├── ComparePage.tsx        # P04 对比工作台 ✏️ 重写
│   └── SettingsModal.tsx      # P05 配置中心（Modal 形式保留）
│
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx            # 左侧导航
│   │   └── TopBar.tsx             # 顶部状态栏
│   ├── literature/
│   │   ├── LiteratureCard.tsx     # 文献卡片（状态+摘要）
│   │   ├── UnifiedInputBox.tsx    # 三合一统一输入框（P01核心）
│   │   ├── TempInbox.tsx          # 临时收集箱
│   │   └── StageProgress.tsx      # 阶段式进度组件
│   ├── project/
│   │   ├── ProjectCard.tsx        # 项目卡片
│   │   └── ProjectCreateModal.tsx # 新建项目弹窗
│   ├── qa/
│   │   ├── QuickQuestionBox.tsx   # 精准问答输入框
│   │   ├── AnswerCard.tsx         # 问答结果（含来源定位）
│   │   └── PdfFragmentOverlay.tsx # PDF 片段浮层（📍弹出）
│   ├── compare/
│   │   ├── ConditionFilter.tsx    # 条件分组筛选器
│   │   ├── CompareTable.tsx       # 对比表（含内联预警）
│   │   └── ExportPanel.tsx        # 导出面板
│   ├── chat/
│   │   └── MultiDocChat.tsx       # 多文档问答（P02右侧）
│   └── common/
│       ├── ErrorBoundary.tsx      # 保留
│       ├── SkeletonCard.tsx       # 骨架屏
│       ├── Toast.tsx              # 全局通知
│       └── StatusBadge.tsx        # 状态徽标
│
├── hooks/
│   ├── useSSE.ts                  # 通用 SSE Hook（基于 PATTERNS-002）
│   ├── useProject.ts              # 项目状态 Hook
│   └── useLiterature.ts           # 文献操作 Hook
│
├── store/
│   └── index.ts                   # Zustand 全局状态
│
├── services/
│   ├── api.ts                     # 基础 fetch 工具（重写）
│   ├── projectApi.ts              # 项目管理 API
│   ├── literatureApi.ts           # 文献操作 API
│   ├── extractApi.ts              # 提取 & SSE API
│   ├── qaApi.ts                   # 精准问答 API
│   ├── chatApi.ts                 # Multi-Doc Chat API
│   ├── compareApi.ts              # 对比 & 导出 API
│   └── configApi.ts               # 配置 & 引导 API
│
└── types/
    └── index.ts                   # 完整实体类型（重写）
```

#### 后端（`src-python/`）

```
src-python/
├── main.py                    # FastAPI 入口（瘦身至 ~50 行）
├── requirements.txt           # 更新依赖
│
├── api/                       # 路由层（按功能域分模块）
│   ├── config.py              # /api/config/*
│   ├── projects.py            # /api/projects/*
│   ├── literature.py          # /api/literature/* + /api/inbox/*
│   ├── extract.py             # /api/extract/*
│   ├── qa.py                  # /api/qa/*
│   ├── chat.py                # /api/chat/*
│   ├── compare.py             # /api/compare/*
│   └── search.py              # /api/search/*
│
└── core/                      # 业务逻辑层（无 HTTP 依赖）
    ├── pdf_engine.py          # PDF → Markdown（保留）
    ├── crawler.py             # SI 下载路由（保留）
    ├── search.py              # 双引擎检索 + 中文翻译（从 crawler 分离）
    ├── translator.py          # 中文→英文翻译（保留，集成至 search.py）
    ├── extractor.py           # Stage2 深度提取（改造现有）
    ├── stage1.py              # Stage1 摘要筛选（新建）
    ├── smart_slicer.py        # SI 实验章节智能切片（从 extractor 分离）🆕
    ├── qa_engine.py           # 精准问答 RAG 引擎（新建）
    ├── rag_engine.py          # Multi-Doc Chat RAG（新建）
    ├── model_manager.py       # Embedding 模型加载与管理（新建）🆕
    ├── domain_engine.py       # 学科识别 + Schema 路由（新建）
    ├── normalizer.py          # 组分归一化 + 单位换算（新建）
    ├── exporter.py            # 多格式导出（扩展现有）
    ├── progress.py            # 阶段式进度引擎（新建）
    ├── security.py            # AES-256 配置加密（新建）
    ├── database.py            # 数据库模型（重写 6 实体）
    └── prompts.py             # AI 提示词（扩展）
```

### 2.2 数据库重构（6 实体）

> **决策**：保留 SQLAlchemy ORM（见 Section 2.8 决策说明）。以下为 ORM 模型定义。

```python
# === 索引与外键约束 ===
# SQLite 默认不启用外键约束，必须在每次连接时执行：
# PRAGMA foreign_keys = ON;

# === 项目 ===
class Project(Base):
    __tablename__ = "projects"
    id = Column(String, primary_key=True)          # UUID
    name = Column(String, nullable=False)
    description = Column(Text)
    domain = Column(String, default='perovskite')   # perovskite/semiconductor/custom
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

# === 文献（project_id=NULL → 临时收集箱）===
class Literature(Base):
    __tablename__ = "literature"
    # 索引定义
    __table_args__ = (
        Index('ix_literature_project_id', 'project_id'),
        Index('ix_literature_extraction_stage', 'extraction_stage'),
        Index('ix_literature_data_source', 'data_source'),
    )

    doi = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey('projects.id'), nullable=True)  # NULL=临时收集箱
    title = Column(String)
    journal = Column(String)
    year = Column(Integer)
    authors = Column(String)
    abstract = Column(Text)
    is_extracted = Column(Boolean, default=False)
    extraction_stage = Column(String, default='none')     # none/stage1/stage2/failed
    data_source = Column(String, default='abstract')      # abstract/fulltext
    relevance_score = Column(Float)
    quality_flag = Column(String)                          # OK/WARNING/ERROR
    local_pdf_path = Column(String)
    performance_data = Column(Text)                        # JSON (PerformanceMetric[])
    process_params = Column(Text)                          # JSON
    stability_data = Column(Text)                          # JSON
    source_mapping = Column(Text)                          # JSON (溯源信息)
    cache_meta = Column(Text)                              # JSON (缓存元数据)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

# === SI 附件（独立实体，追踪下载状态）===
class SIFile(Base):
    __tablename__ = "si_files"
    __table_args__ = (
        Index('ix_sifile_literature_doi', 'literature_doi'),
    )
    id = Column(String, primary_key=True)                  # UUID
    literature_doi = Column(String, ForeignKey('literature.doi'))
    url = Column(String)                                   # 下载 URL
    type = Column(String)                                  # pdf/docx/zip
    status = Column(String, default='pending')             # pending/downloading/ready/failed
    local_path = Column(String)                            # 本地存储路径

# === 多文档问答会话 ===
class ChatSession(Base):
    __tablename__ = "chat_sessions"
    __table_args__ = (
        Index('ix_chatsession_project_id', 'project_id'),
    )
    id = Column(String, primary_key=True)                  # UUID
    project_id = Column(String, ForeignKey('projects.id'))
    query = Column(Text)                                   # 对话主题/首个问题
    context_dois = Column(Text)                            # JSON array of DOIs
    created_at = Column(DateTime, default=utcnow)

# === 会话消息 ===
class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index('ix_chatmessage_session_id', 'session_id'),
    )
    id = Column(String, primary_key=True)                  # UUID
    session_id = Column(String, ForeignKey('chat_sessions.id'))
    role = Column(String)                                  # user/assistant
    content = Column(Text)
    source_refs = Column(Text)                             # JSON [{doi, page, excerpt}]
    created_at = Column(DateTime, default=utcnow)

# === 精准问答记录 ===
class QuickQuestion(Base):
    __tablename__ = "quick_questions"
    __table_args__ = (
        Index('ix_quickquestion_doi', 'literature_doi'),
    )
    id = Column(String, primary_key=True)                  # UUID
    literature_doi = Column(String, ForeignKey('literature.doi'))
    question = Column(Text)
    answer = Column(Text)
    source = Column(Text)                                  # JSON {page, paragraph, excerpt}
    cost = Column(Float)                                   # USD
    tokens_used = Column(Integer)                          # Token 消耗
    created_at = Column(DateTime, default=utcnow)
```

### 2.3 API 端点重设计（完整契约，对齐 Architecture V2.1 Section 6）

**引导与配置（`api/config.py`）**
```
GET  /api/config/status              → 是否需要 onboarding
POST /api/config/ai-engine           → 保存模型配置（带连通性测试）
POST /api/config/proxy               → 保存代理配置（含 Cookie 注入支持）
PUT  /api/config/domains             → 更新领域选择
POST /api/config/embedding/verify  → 校验 Embedding 模型完整性
GET  /api/config/cache               → 缓存统计信息
DELETE /api/config/cache              → 清理缓存
```

**项目管理（`api/projects.py`）**
```
GET    /api/projects                  → 项目列表
POST   /api/projects                  → 新建项目
GET    /api/projects/{id}             → 项目详情
PUT    /api/projects/{id}             → 更新项目
DELETE /api/projects/{id}             → 删除项目（级联清理文献？需确认）
POST   /api/projects/{id}/literature  → 将文献归入项目
```

**文献操作（`api/literature.py`）** — 对齐 Architecture 6.3 & 6.10
```
POST   /api/literature/add            → 三合一统一添加（DOI/PDF/关键词自动识别）
POST   /api/literature/upload         → 上传 PDF（返回 doi）
POST   /api/literature/doi            → DOI 解析（下载+元数据）
DELETE /api/literature/{doi}          → 删除文献
GET    /api/literature/{doi}          → 文献详情（含提取结果）
GET    /api/inbox                     → 临时收集箱列表
POST   /api/inbox/{doi}/move          → 将文献从收集箱归档到项目
```

**提取（`api/extract.py`）**
```
POST /api/extract/{doi}/stage1        → SSE: Stage1 摘要筛选
POST /api/extract/{doi}/deep          → SSE: Stage2 深度提取（5 阶段进度）
GET  /api/extract/{doi}/status        → 当前提取状态
POST /api/extract/{doi}/cancel        → 取消提取
```

**精准问答（`api/qa.py`）** — 对齐 Architecture 6.6
```
POST /api/qa/{doi}                    → SSE: 精准问答（RAG+LLM，<5s）
GET  /api/qa/{doi}/history            → 历史问答记录
GET  /api/qa/{doi}/suggestions        → 自动生成快捷问题（3-5个）
```

**Multi-Doc Chat（`api/chat.py`）** — 对齐 Architecture 6.7
```
POST /api/chat                        → SSE: 多文档问答（支持跨项目选文献）
GET  /api/chat/sessions               → 对话历史列表
GET  /api/chat/sessions/{id}          → 对话详情
```

**对比与导出（`api/compare.py`）** — 对齐 Architecture 6.8
```
GET  /api/project/{id}/compare        → 对比数据（支持条件筛选，URL query params）
POST /api/project/{id}/compare/export → 统一导出入口（format 参数指定格式）
```

**检索（`api/search.py`）**
```
GET  /api/search?query=...            → 双引擎检索（SS + OpenAlex）
```

### 2.4 Q&A SSE 事件格式（对齐 Architecture 6.6）

```
POST /api/qa/{doi}
Body: { "question": "退火温度是多少？" }
Response: SSE 流式

data: {"type": "content", "text": "退火温度为 100°C", "timestamp": "..."}
data: {"type": "source", "page": 4, "paragraph": 2, "excerpt": "...annealed at 100°C...", "file": "SI_main.pdf", "timestamp": "..."}
data: {"type": "done", "cost": 0.005, "tokens": 1200, "timestamp": "..."}
data: {"type": "error", "message": "无法定位相关段落", "timestamp": "..."}
```

### 2.5 Embedding 模型加载策略

BGE-base-en-v1.5 (~420MB) 的加载时机：

| 策略 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| 应用启动时预加载 | 首次问答无延迟 | 启动时间增加 ~10-30s | |
| 首次使用时懒加载 | 启动快 | 首次问答延迟高（~15s 加载模型） | |
| 后台异步加载 | 兼顾启动速度和问答延迟 | 实现复杂 | ✅ 采用 |

**实现方案**：
1. 应用启动后 2s 开始后台加载模型（`threading.Thread`）
2. 加载期间 `/api/config/embedding` 返回 `status: "loading"`
3. 加载完成后切换为 `status: "ready"`
4. 加载期间发起的 Q&A 请求返回 `503 Service Unavailable` + 提示"Embedding 模型正在加载，请稍后"

### 2.6 FAISS 索引持久化策略

| 场景 | 策略 |
|------|------|
| 首次添加文献 | 为项目创建新 FAISS 索引，存至 `%APPDATA%/SIA/cache/faiss/{project_id}/index.faiss` |
| 新增文献 | 增量 `add_embeddings()`，定期 `faiss.write_index()` 写盘 |
| 应用退出 | 确保所有索引已写盘（Tauri `on_window_event(close)` 触发） |
| 应用启动 | 懒加载：首次访问某项目时从磁盘读取索引 |
| 单篇精准问答 | 独立索引，存至 `%APPDATA%/SIA/cache/faiss/literature/{doi}.faiss`，首次提问时构建 |

### 2.7 PIA → SIA 品牌迁移

**需要更新的位置：**

| 位置 | 当前 | 目标 |
|------|------|------|
| `src/App.tsx` 页脚 | `PIA v1.1` | `SIA v2.1` |
| `src-python/main.py` 标题 | `Perovskite Insight Agent API` | `Sci-Insight Agent API` |
| 数据库目录 | `%APPDATA%/PIA_Agent/` | `%APPDATA%/SIA/` |
| 配置文件 | `config.json` | `settings.enc`（加密） |
| 临时上传目录 | `%TEMP%/pia_uploads/` | `%TEMP%/sia_uploads/` |

**迁移策略（Phase 0 执行）：**
1. 启动时检测 `%APPDATA%/PIA_Agent/` 是否存在
2. 如存在：弹出提示"检测到 V1.x 数据，是否迁移？"
3. 用户确认后：复制数据库文件到新路径，执行 Schema 迁移
4. 迁移完成后：旧目录保留（不删除），重命名为 `PIA_Agent.migrated`

### 2.8 ORM 迁移决策：保留 SQLAlchemy

**决策**：保留 SQLAlchemy ORM，不切换到 Raw SQL。

**理由：**
1. 当前代码库已使用 ORM（`declarative_base`, `Column`, `relationship`），重写成本高
2. ORM 提供 Python 层级的类型安全和数据验证
3. Schema 迁移可使用 Alembic 管理（未来需要）
4. 6 实体之间的关系（外键、级联）用 ORM 表达更清晰

**实施方式：**
- 重写 `core/database.py` 中的 ORM 模型（从 2 实体扩展到 6 实体）
- 添加 `__table_args__` 定义索引
- 连接时执行 `PRAGMA foreign_keys = ON;`
- 保留 WAL 模式和连接池配置

---

## 三、分阶段实施计划

> 采用**渐进式重构**策略：保持现有 V1 功能可运行，逐步迁移。
>
> **时间估算说明**：每 Phase 标注"方案估算"和"审计修正"两个数字。方案估算为原方案估计；审计修正考虑了实际复杂度、联调和测试时间。

### Phase 0 — 基础设施准备（方案 ~1天 / 审计修正 3-4天）

> 目标：建立新骨架，不破坏现有功能

- [ ] **品牌迁移**：执行 PIA → SIA 品牌更新（App.tsx、main.py、目录名）
- [ ] **数据迁移**：实现 V1 数据自动检测和迁移逻辑（见 Section 2.7）
- [ ] **前端**：引入 `react-router-dom`，将 `useState` 路由迁移为 Router
- [ ] **前端**：引入 `zustand` 作为全局状态管理
- [ ] **后端**：重构 `main.py`，拆分为 `api/` 子模块（先空壳，逐步迁移端点）
- [ ] **后端**：重写 `core/database.py`（6 实体 ORM 模型 + 索引 + 外键约束）
- [ ] **前端**：重写 `src/types/index.ts`（与新实体模型对齐）
- [ ] **后端**：新建 `core/security.py`（AES-256 配置加密）
- [ ] **后端**：确保 `PRAGMA foreign_keys = ON;` 在每次连接时执行

**关键决策**：现有 4 个页面过渡期保留，新路由优先接管；数据库仅 ALTER TABLE 新增字段（不删除现有数据）

**验收标准**：
- 现有 V1 功能正常运行（搜索、提取、详情、对比）
- 新路由框架就绪（可访问 `/onboarding`、`/quick` 等空页面）
- 新数据库 schema 已创建，旧数据已迁移

---

### Phase 1 — 核心 P0 功能（方案 ~3天 / 审计修正 5-6天）

> 目标：实现 PRD 中所有 P0 优先级功能

**1.1 P00 首次启动引导**
- [ ] 新建 `OnboardingPage.tsx`（3 步向导组件）
- [ ] 后端：`GET /api/config/status` + `POST /api/config/ai-engine`（连通性测试）
- [ ] App.tsx：检测 onboarding 状态，自动重定向

**1.2 项目系统**
- [ ] 后端：完整 `api/projects.py` CRUD
- [ ] 前端：`ProjectHubPage.tsx`（P02） + `ProjectCard.tsx` + `ProjectCreateModal.tsx`
- [ ] 前端：`TempInbox.tsx`（临时收集箱）
- [ ] 后端：`GET /api/inbox` + `POST /api/inbox/{doi}/move`

**1.3 统一添加文献入口**
- [ ] 前端：`UnifiedInputBox.tsx`（三合一：PDF/DOI/关键词自动识别）
- [ ] 后端：`POST /api/literature/add`（统一入口，自动识别类型）
- [ ] 后端：`POST /api/literature/upload` + `POST /api/literature/doi`（具体操作端点）
- [ ] 重写 `HomePage.tsx`（P01） + 新建 `QuickModePage.tsx`（P01b）
- [ ] 后端：将 `core/search.py` 从 `crawler.py` 分离（双引擎检索逻辑）
- [ ] 后端：保留 `core/translator.py`，集成至 `core/search.py`（中文查询翻译）

**1.4 本地 Embedding 模型**
- [ ] 后端：`core/model_manager.py`（BGE-base-en-v1.5 加载/管理）
- [ ] 采用后台异步加载策略（见 Section 2.5）
- [ ] 后端：`GET /api/config/embedding` + `POST /api/config/embedding/verify`
- [ ] 前端：P00 Step1 中显示 Embedding 加载状态（不再显示下载）

**1.5 SI 智能切片**
- [ ] 后端：`core/smart_slicer.py`（从 `extractor.py` 的简单切片逻辑独立出来）
- [ ] 定位 "Experimental Section" / "Methods" 锚点，截取核心章节

**验收标准**：
- P00 引导流程可完整走通（API Key → 代理 → 领域）
- 项目 CRUD 正常，文献可归档到项目
- 统一输入框正确识别 DOI/PDF/关键词
- Embedding 模型已就绪并成功加载
- 旧数据已迁移到新 Schema

---

### Phase 2 — 核心体验优化（方案 ~3天 / 审计修正 6-8天）

> 目标：实现 PRD 中所有 P1 优先级功能

**2.1 精准问答引擎（V2.1 最重要新功能）**
- [ ] 后端：`core/qa_engine.py`（FAISS + sentence-transformers，段落切片 512 tokens）
- [ ] 后端：`POST /api/qa/{doi}`（SSE 流式回答 + 来源定位，按 Section 2.4 格式）
- [ ] 后端：`GET /api/qa/{doi}/suggestions`（自动生成快捷问题）
- [ ] 后端：`GET /api/qa/{doi}/history`（历史问答记录）
- [ ] 前端：`QuickQuestionBox.tsx` + `AnswerCard.tsx`
- [ ] 重写 `InsightLabPage.tsx`（P03：精准问答为中心）
- [ ] FAISS 索引持久化（按 Section 2.6 策略）

**2.2 PDF 片段浮层**（评估为独立子任务，复杂度较高）
- [ ] 前端：`PdfFragmentOverlay.tsx`（基于 PdfViewer 扩展）
- [ ] 需实现：PDF.js 页面渲染 → 文本定位（char offset → 坐标）→ 浮层定位
- [ ] **MVP 范围**：先实现"页码定位"（跳转到指定页），段落级高亮作为后续迭代

**2.3 两阶段 AI 提取**
- [ ] 后端：`core/stage1.py`（Stage1 摘要筛选，~$0.001/篇，~2s）
- [ ] 后端：`core/extractor.py` 改造为 Stage2（深度提取，配置独立高推理模型）
- [ ] 后端：`prompts.py` 拆分 Stage1/Stage2 Prompt
- [ ] 前端：`StageProgress.tsx`（5 阶段进度 + 预估剩余时间）

**2.4 阶段式进度引擎**
- [ ] 后端：`core/progress.py`（阶段追踪 + 动态耗时预估）
- [ ] SSE 事件格式升级：携带 `stages[]` 数组（而非单一 `progress`）

**验收标准**：
- 精准问答 <5s 响应，返回答案 + 来源定位
- 快捷问题自动生成 3-5 个
- Stage1 筛选 ~2s/篇，Stage2 深度提取有 5 阶段进度
- PDF 片段至少可跳转到指定页码

---

### Phase 3 — P2 功能完善（方案 ~2天 / 审计修正 4-5天）

> 目标：实现 PRD 中所有 P2 优先级功能

**3.1 对比看板重构**
- [ ] 后端：`core/normalizer.py`（组分归一化 + pint 单位换算）
- [ ] 后端：可比性规则引擎（扫描方向/活性面积/SPO/ISOS 4 维度预警）
- [ ] 后端：`GET /api/project/{id}/compare`（支持 filter query params）
- [ ] 前端：`ConditionFilter.tsx` + `CompareTable.tsx`（内联预警） + 重写 `ComparePage.tsx`

**3.2 多格式导出**
- [ ] 后端：扩展 `core/exporter.py`（新增 LaTeX + matplotlib PNG）
- [ ] 后端：`POST /api/project/{id}/compare/export`（统一导出入口，format 参数）
- [ ] 前端：`ExportPanel.tsx`（LaTeX/PNG/Excel/CSV 四格导出）

**3.3 Multi-Doc Chat**
- [ ] 后端：`core/rag_engine.py`（项目级 FAISS 索引，增量更新）
- [ ] 后端：`POST /api/chat`（支持跨项目选文献）
- [ ] 后端：`GET /api/chat/sessions` + `GET /api/chat/sessions/{id}`
- [ ] 前端：`MultiDocChat.tsx`（P02 右侧面板，支持跨项目选文献）

**验收标准**：
- 对比看板支持按条件筛选，预警内联到单元格
- 导出 LaTeX 可直接粘贴到论文，格式正确
- Multi-Doc Chat 支持跨项目选文献，响应 <8s

---

### Phase 4 — 质量加固（方案 ~1天 / 审计修正 2-3天）

> 目标：补全 P3 功能，全面测试与文档更新

**4.1 领域引擎**
- [ ] 后端：`core/domain_engine.py`（学科识别 + Schema 路由 + 实验性标注）

**4.2 安全加固**
- [ ] 后端：完善安全加密 + 全局异常处理（401/403/404/429/500）
- [ ] 后端：Cookie 注入功能（用于下载付费文献 SI）

**4.3 离线模式**
- [ ] 后端：离线模式（AI 不可用时手动编辑参数）
- [ ] 前端：离线状态提示和参数手动编辑表单

**4.4 测试策略**
- [ ] 单元测试：`core/normalizer.py`（组分归一化 + 单位换算）
- [ ] 单元测试：`core/smart_slicer.py`（切片定位精度）
- [ ] 集成测试：两阶段 Pipeline（Stage1 → Stage2 完整流程）
- [ ] 集成测试：RAG 引擎（问答准确性，至少 10 个真实问题）
- [ ] SSE 稳定性测试：并发 5 个提取任务，验证进度推送正确
- [ ] 性能基准：精准问答 <5s、Stage1 <30s、Stage2 <45s、缓存命中 <500ms
- [ ] 端到端：上传 PDF → 精准问答 → 对比 → 导出 LaTeX

**4.5 文档更新**
- [ ] 更新 `docs/System_Architecture.md`
- [ ] 更新 `.claude/memory/DECISIONS.md`（补充 ADR-008 ~ ADR-012）
- [ ] 更新 `.claude/memory/PATTERNS.md`（新增 RAG、Zustand 等新模式）

**验收标准**：
- 核心模块单元测试覆盖率 >60%
- 所有性能指标满足 PRD 要求
- 端到端流程测试通过

---

## 四、技术风险与缓解措施

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| BGE 模型文件损坏/缺失 | 低 | P1 | P00 提供"校验/重新解压"；或引导用户手动下载修复 |
| **PyTorch 打包体积爆炸（~2GB）** | **高** | **P0** | **备选方案：(1) 使用 ONNX Runtime 替代 PyTorch 推理，体积降至 ~200MB；(2) 使用 `optimum[onnxruntime]` 加载 BGE 模型；(3) 打包时排除 torch CUDA 相关文件。Phase 0 需先验证 ONNX 推理精度。** |
| FAISS 在 Windows PyInstaller 打包后崩溃 | 中 | P0 | 优先 Windows 本地验证；备选：`chromadb`（纯 Python） |
| Stage1/Stage2 双模型配置门槛过高 | 中 | P1 | P00 允许 Stage1=Stage2 同一模型，提供推荐预设 |
| 数据库迁移破坏现有数据 | 低 | P1 | 迁移前备份；只 ALTER TABLE 添加字段，不删除；旧目录保留 |
| PDF 片段定位精度（段落级） | 中 | P1 | MVP 先实现"页码定位"，段落级定位列为后续迭代 |
| **ORM 重写导致查询性能回退** | 中 | **P1** | **关键查询路径（文献列表、项目详情）保留 raw SQL 选项；使用 `EXPLAIN QUERY PLAN` 验证索引命中** |
| **PDF 片段浮层实现复杂度超预期** | **中** | **P1** | **拆分为两步：Phase 2 只做页码跳转定位；段落级高亮和浮层放到后续迭代。避免成为 Phase 2 的 blocker** |
| V1 → V2 数据迁移失败 | 低 | P1 | 旧目录不删除（重命名为 `.migrated`）；提供回退说明 |

---

## 五、依赖变更清单

### 新增前端依赖

```bash
npm install react-router-dom zustand
```

### 后端依赖变更（`requirements.txt`）

**新增：**
```
faiss-cpu>=1.7.4
sentence-transformers>=2.6.0    # 注意：会拉取 PyTorch (~2GB)，见风险表
huggingface-hub>=0.22.0
pint>=0.23
cryptography>=42.0.0
```

**已有但需确认保留：**
```
fastapi>=0.104.0
uvicorn>=0.24.0
sqlalchemy>=2.0.0               # 保留 ORM
openai>=1.0.0                   # 统一 OpenAI 兼容接口
sse-starlette>=1.8.0            # SSE 流式响应
httpx>=0.25.0                   # 异步 HTTP（检索 + 下载）
openpyxl>=3.1.0                 # Excel 导出
```

**打包依赖（PyInstaller 需包含）：**
```
marker-pdf                      # PDF → Markdown（或 docling）
# 如果采用 ONNX 方案替代 PyTorch：
# optimum[onnxruntime]>=1.16.0
```

### 体积影响评估

| 依赖 | 原始大小 | PyInstaller 打包后（预估） | 备注 |
|------|---------|--------------------------|------|
| 当前总包 | ~80MB | ~120MB | 不含 AI 模型 |
| + PyTorch | ~2.2GB | ~1.5GB | 需要精简或替代 |
| + ONNX Runtime | ~200MB | ~150MB | 推荐备选 |
| + BGE 模型文件 | ~420MB | **已包含在包内** | 存于安装目录或 %APPDATA% |
| + FAISS | ~50MB | ~30MB | faiss-cpu 即可 |

---

## 六、实施优先级总览

```
Phase 0（基础设施）  ████████░░  必须首先完成，其他全依赖         ~3-4天
Phase 1（P0 功能）   ████████░░  项目系统 + 统一入口 + 引导 + Embedding  ~5-6天
Phase 2（P1 功能）   ███████░░░  精准问答 + 两阶段提取 + 阶段进度    ~6-8天
Phase 3（P2 功能）   ██████░░░░  对比看板 + 导出 + Multi-Doc Chat     ~4-5天
Phase 4（P3 功能）   █████░░░░░  领域引擎 + 安全加固 + 测试           ~2-3天
                                                      总计 ~20-26天
```

---

## 七、审计遗留追踪

以下问题需在实施过程中确认：

| 编号 | 问题 | 状态 | 负责阶段 |
|------|------|------|---------|
| AUDIT-001 | ONNX vs PyTorch 推理方案验证 | 待验证 | Phase 0 |
| AUDIT-002 | V1 数据迁移脚本（PIA_Agent → SIA） | 待实现 | Phase 0 |
| AUDIT-003 | DECISIONS.md 补充 ADR-008 ~ ADR-012 | 待更新 | Phase 4 |
| AUDIT-004 | PDF 段落级定位实现方案 | 待评估 | Phase 2+ |
| AUDIT-005 | `sentence-transformers` 打包体积最终方案 | 待决策 | Phase 0 |

---

## 文档变更记录

| 日期 | 变更类型 | 变更内容 | 关联提交 |
|------|---------|---------|---------|
| 2026-05-11 | 新增 | 基于 PRD V2.1 和系统架构 V2.1 设计完整重构方案 | - |
| 2026-05-11 | 修订-a | 审计修正：补充 5 项 Critical 遗漏（torch 体积、缺失 API、smart_slicer、SQLAlchemy 决策、数据迁移）；修正 8 项 Important 遗漏（时间估算、translator、API 一致性、SIFile、索引、品牌迁移等）；补充 6 项 Minor 遗漏（依赖清单、SSE 格式、加载策略等） | - |
