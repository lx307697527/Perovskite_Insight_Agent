# PIA 修复验证测试方案

## 测试范围概览

| 编号 | 问题描述 | 修复状态 | 测试类型 | 测试方法 |
|------|---------|---------|---------|---------|
| T01 | SSE status 字段不匹配 | ✅ 已修复 | 单元测试 | mock extractor 验证 SSE 状态 |
| T02 | ComparisonPage Mock 数据 | ✅ 已修复 | 集成测试 | 验证 API 调用和数据绑定 |
| T03 | "加入对比"按钮无事件 | ✅ 已修复 | 前端测试 | 验证 onClick 触发 |
| T04 | `/api/history` 响应格式 | ✅ 已修复 | 单元测试 | 验证 success/data 包装 |
| T05 | 前端筛选器未传入后端 | ✅ 已修复 | 集成测试 | 验证 filter 参数传递 |
| T06 | SSE 断线重连 | ✅ 已修复 | 单元测试 | 验证 retry 逻辑 |
| T07 | SQLite WAL 模式 | ✅ 已修复 | 单元测试 | 验证 PRAGMA 配置 |
| T08 | 数据溯源 evidence | ✅ 已修复 | 集成测试 | 验证 evidence_map 存储 |
| T09 | 单位标准化 | ✅ 已修复 | 单元测试 | 验证 _normalize_metric |
| T10 | ISOS 稳定性提取 | ✅ 已修复 | 单元测试 | 验证 prompt 内容 |
| T11 | SI 附件发现 | ✅ 已修复 | 集成测试 | 验证 SI URL 生成 |
| T12 | 重复提取保护 | ✅ 已修复 | 单元测试 | 验证 active_extractions |
| T13 | PDF 占位符污染 | ✅ 已修复 | 单元测试 | 验证 404 返回 |
| T14 | translate_query 冗余 | ❌ 未修复 | 代码审查 | 代码审查标注 |
| T15 | DeviceMetrics 类型 | ❌ 未修复 | 架构审查 | 架构审查标注 |
| T16 | isMounted 检查 | ❌ 未修复 | 代码审查 | 代码审查标注 |
| T17 | 虚拟滚动 | ❌ 未修复 | 代码审查 | 代码审查标注 |
| T18 | 组分验证函数 | ❌ 未修复 | 代码审查 | 代码审查标注 |

---

## 测试用例详解

### T01: SSE Status 字段对齐

**测试目标**: 确保后端发送的 SSE status 值与前端判断逻辑一致

**后端测试** (`test_sse_status_alignment`):
1. Mock `PaperExtractor.process_full_paper` yield 各种 status 值
2. 启动 SSE StreamingResponse
3. 读取所有 SSE event，验证 status 字段在 `['extracting', 'parsing', 'downloading', 'analyzing_si', 'completed', 'failed', 'cached']` 范围内
4. 验证 `extracting` status 正确出现在提取阶段

**前端测试** (`test_sse_status_mapping`):
1. 模拟后端 SSE 事件（含 `extracting`, `parsing`, `downloading`, `analyzing_si`）
2. 验证 `ResultsPage` 的 `onmessage` 正确处理这些状态
3. 验证 `data.status === 'extracting'` 分支被触发更新 progress

---

### T02: ComparisonPage 真实数据

**测试目标**: 确保 ComparisonPage 从后端获取真实数据而非硬编码

**后端测试** (`test_comparison_data_flow`):
1. 在数据库中插入测试论文和提取结果
2. 调用 `GET /api/paper/{doi}` 获取详情
3. 验证返回的结构包含 `metrics`, `process`, `is_extracted`

**前端测试** (`test_comparison_page_fetch`):
1. Mock `api.fetchPaperDetails` 返回结构化数据
2. 渲染 `ComparisonPage` 传入 `selectedDois`
3. 验证表格渲染了正确的字段（composition, structure, pce, voc, jsc, ff, solvent, additive）

---

### T03: "加入对比" 按钮

**测试目标**: 验证按钮触发正确的状态变更

**前端测试** (`test_compare_button_toggle`):
1. 渲染 `DetailsPage` 并传入 `onToggleComparison` mock 函数
2. 点击"加入对比"按钮
3. 验证回调被调用，且传入正确的 DOI
4. 验证按钮文字在点击后变为"已加入对比"

---

### T04: `/api/history` 响应格式

**测试目标**: 确保返回 `{"success": true, "data": [...]}`

**后端测试** (`test_history_response_format`):
1. 在数据库中插入若干测试论文
2. 调用 `GET /api/history`
3. 验证 JSON 包含 `success: true`
4. 验证 `data` 是数组且包含论文信息

---

### T05: 搜索过滤器传递

**测试目标**: 确保过滤器正确传递到后端并生效

**后端测试** (`test_search_with_filters`):
1. 调用 `GET /api/search?query=test&year_start=2020&year_end=2025&min_pce=20`
2. 验证后端接收并处理了 `year_start`, `year_end`, `min_pce`
3. 验证 `crawler.search_papers_dual_engine` 被调用了增强的 query

**前端测试** (`test_search_filter_passing`):
1. Mock `api.searchPapers` 验证调用参数
2. 模拟 `HomePage` 高级筛选面板输入年份和 PCE 值
3. 验证 `searchPapers` 被调用时包含了 filter 参数

---

### T06: SSE 断线重连

**测试目标**: 确保 SSE 连接断开后最多重试 3 次

**后端测试**: 不适用（重连全部在前端实现）

**前端测试** (`test_sse_retry_mechanism`):
1. 模拟 `EventSource` onerror 触发
2. 验证 `handleSSEError` 被调用
3. 验证 3 次以内重试（`setTimeout` 2000ms），超过 3 次停止

---

### T07: SQLite WAL 模式

**测试目标**: 确保数据库启用 WAL 模式

**后端测试** (`test_sqlite_wal_mode`):
1. 创建内存 SQLite 引擎
2. 应用 `set_sqlite_pragma` listener
3. 连接后执行 `PRAGMA journal_mode` 验证为 `wal`

---

### T08: 数据溯源 evidence 映射

**测试目标**: 确保 AI 提取的证据文本被保存到 source_mapping 并正确返回

**后端测试** (`test_evidence_mapping`):
1. Mock AI 返回含 evidence 的结构化数据
2. 运行 `process_full_paper` 提取流程
3. 验证 `source_mapping` 存储了 evidence JSON
4. 验证 `GET /api/paper/{doi}` 返回的 evidence 字段指向真实 AI 输出

---

### T09: 单位标准化

**测试目标**: 确保单位被正确标准化（mV → V, 小数 → 百分比）

**后端测试** (`test_unit_normalization`):
1. 直接调用 `extractor._normalize_metric('Voc', '1210 mV')`
2. 验证返回 `"1.210"`
3. 调用 `_normalize_metric('PCE', '0.251')`
4. 验证返回 `"25.1"`
5. 调用 `_normalize_metric('FF', '82.3')`
6. 验证返回 `"82.3"`

---

### T10: ISOS 稳定性提取

**测试目标**: 确保 prompts 中包含 ISOS 提取指令

**后端测试** (`test_isos_in_prompt`):
1. 读取 `PEROVSKITE_EXTRACTOR_PROMPT`
2. 验证包含 `ISOS`、`T80`、`T90` 关键字
3. 验证包含 `stability` 或相关词汇

---

### T11: SI 附件发现

**测试目标**: 确保 SI URL 被正确生成

**后端测试** (`test_si_url_discovery`):
1. 调用 `crawler.get_pdf_links('10.1126/science.abc1234')`
2. 验证 `si` 字段不为空
3. 验证 Science 的 SI URL 包含 `suppl_file`
4. 调用 `crawler.get_pdf_links('10.1038/s41586-023-00000-0')`
5. 验证 Nature 的 SI URL 包含 `MediaObjects`

---

### T12: 重复提取保护

**测试目标**: 确保同一 DOI 并发提取被阻止

**后端测试** (`test_concurrent_extraction_protection`):
1. 模拟两次同时调用 `GET /api/extract/{doi}`
2. 第一次调用启动正常提取
3. 第二次调用应收到非 completed 事件（`extracting` 或 `wait` 消息）
4. 验证第二次请求不会执行实际提取

---

### T13: PDF 占位符污染

**测试目标**: 确保不存在的 PDF 返回 404 而非生成文件

**后端测试** (`test_pdf_not_found`):
1. 调用 `GET /api/pdf/10.xxxx/notexist`
2. 验证返回 404
3. 验证文件系统未生成新文件

---

### T14-T18: 未修复问题

这些标注为"待代码审查"的问题不在此次自动测试范围内，但需要在代码审查清单中记录。

---

## 测试执行流程

```bash
# 1. 后端测试
cd src-python
pytest ../tests/test_api.py -v  # 已有测试
pytest ../tests/test_backend_fixes.py -v  # 新增修复验证

# 2. 前端测试（如需）
cd ..
npx vitest run  # 新增前端测试
```

## 失败判定标准

- 断言失败 = 修复未完成
- 测试异常（ImportError 等）= 测试脚本需要调整
- 关键测试（T01, T03, T06）必须通过；次要测试允许因外部依赖失败
