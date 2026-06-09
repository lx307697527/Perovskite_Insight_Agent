# SIA 功能实现清单 (TODO)

> 基于 PRD V2.1 文档审查，最后更新：2026-06-09
>
> **📖 开发流程**: 开始开发前请先阅读 [开发流程设计](DEVELOPMENT_WORKFLOW.md) 和 [快速参考卡片](WORKFLOW_QUICK_REF.md)

## 状态说明

- ✅ 已完成
- ⚠️ 部分实现
- ❌ 未实现

---

## 一、P0 高优先级（影响核心体验）

### 1. P03 精准问答快捷问题按钮
- [x] 前端调用 `/api/qa/{doi}/suggestions` API
- [x] 在 DetailsPage/InsightLabPage 展示 3-5 个快捷问题按钮
- [x] 点击按钮触发精准问答
- **现状**: ✅ 已完成 - DetailsPage 已集成 QuickQuestionBox 组件
- **涉及文件**: `src/pages/DetailsPage.tsx`, `src/components/QuickQuestionBox.tsx`

### 2. P03 PDF 片段浮层集成
- [x] 在提取数据卡片中添加 📍 定位图标
- [x] 点击 📍 触发 PdfFragmentOverlay 浮层
- [ ] 浮层仅显示定位点前后 1 段内容（PRD 要求）
- [x] 支持"在 PDF 中打开完整页面"按钮
- **现状**: ✅ 已完成 - DetailsPage/InsightLabPage 均已集成 PdfFragmentOverlay + 📍 定位图标，新增 SI 数据 Tab
- **涉及文件**: `src/pages/DetailsPage.tsx`, `src/pages/InsightLabPage.tsx`, `src/components/PdfFragmentOverlay.tsx`

### 3. P03 见解实验室页面完善
- [x] 完善 `/insight/:doi` 路由的页面内容
- [x] 集成精准问答输入框 + 回答展示
- [x] 集成结构化提取卡片（性能指标/工艺参数/稳定性数据）
- [x] 添加 PDF 片段浮层支持
- **现状**: ✅ 已完成 - 修复 process_params 字段名 bug，结构化卡片添加 📍 定位，Stage1 筛选结果展示，空状态提示
- **涉及文件**: `src/pages/InsightLabPage.tsx`

### 4. P01b 快捷模式页面完善
- [x] 实现单篇文献的完整处理流程
- [x] 集成问答 + 提取 + 定位功能（路由至 Insight Lab）
- [x] 优化用户引导体验
- **现状**: ✅ 已完成 - 内联 Stage1 提取进度条，提取后显示摘要卡片并跳转至 /insight/，新增最近文献列表
- **涉及文件**: `src/pages/QuickModePage.tsx`

---

## 二、P1 中优先级（影响用户效率）

### 5. 检索结果"仅摘要 vs 有PDF"区分
- [x] 检索结果卡片添加状态标识（📋 摘要 / 📄 全文）
- [x] 仅摘要状态显示警告提示
- [x] 添加"下载 PDF"按钮（需机构权限时提示）
- [x] 添加"仅查看摘要详情"选项
- **现状**: ✅ 已完成 - 搜索结果卡片添加状态徽章（解析中/全文已提取/提取失败/仅摘要），按钮改为"获取全文 & 提取"
- **涉及文件**: `src/pages/ResultsPage.tsx`

### 6. SI 附件展示与下载
- [x] 详情页展示 SI 文件列表（SI_main.pdf, SI_data.xlsx 等）
- [x] 每个文件提供"打开"按钮
- [x] 显示文件大小信息
- [x] 支持单独下载 SI 文件
- **现状**: ✅ 已完成 - 详情页 SI 数据 Tab 展示附件文件列表（类型图标/状态徽章/下载按钮），后端新增 GET /api/si/{file_id}/download 端点
- **涉及文件**: `src/pages/DetailsPage.tsx`, `src-python/api/literature.py`

### 7. 稳定性数据卡片
- [x] 新增"稳定性数据"展示区域
- [x] 显示 ISOS 协议等级（ISOS-D-1, ISOS-L-1 等）
- [x] 显示 T80/T90 寿命指标
- [x] 显示测试条件（光强、温度、湿度）
- [x] 添加来源定位支持
- **现状**: ✅ 已完成 - 详情页新增"稳定性"Tab，显示协议徽章/T80/T90/保持率/测试条件，支持 PDF 证据定位
- **涉及文件**: `src/pages/DetailsPage.tsx`

### 8. 数据质量标注增强
- [x] 完善 quality_flag 的展示逻辑
- [x] ⚠ 图标 hover 显示具体原因（如"仅 R-scan，无 F-scan 对照"）
- [x] 单元格背景色区分（绿色=最优、橙色=警告、灰色=缺失）
- [x] 支持用户手动补充条件（触发"标记异议"弹窗）
- **现状**: ✅ 已完成 - ComparisonPage: hover popover 显示警告详情+颜色左边框区分；DetailsPage: 质量横幅+指标卡条件角标
- **涉及文件**: `src/pages/ComparisonPage.tsx`, `src/pages/DetailsPage.tsx`

### 9. 数值条件后缀标注
- [x] 性能数值旁显示扫描方向标签 [R-scan] / [F-scan]
- [x] SPO 数据显示 ✅ 标识
- [x] 缺少条件标注的数值显示 ⚠ 警告图标
- **现状**: ✅ 已完成 - 详情页核心性能 Tab 每个 metric 卡片显示 scan_direction 徽章、SPO 徽章、质量角标（✓/⚠）
- **涉及文件**: `src/pages/DetailsPage.tsx`

---

## 三、P2 低优先级（锦上添花）

### 10. LaTeX 表格一键复制
- [ ] 导出下拉菜单添加"复制 LaTeX"选项
- [ ] 生成符合论文写作规范的 LaTeX 代码
- [ ] 包含 table notes（条件标注脚注）
- [ ] 复制成功显示 Toast 提示
- **现状**: 可导出 .tex 文件，无一键复制
- **涉及文件**: `src/pages/ComparisonPage.tsx`, `src/services/compareApi.ts`

### 11. 图表预览功能
- [ ] 对比看板底部添加"生成条形图"按钮
- [ ] 添加"生成散点图"按钮
- [ ] 使用 Chart.js 或 Recharts 实现
- [ ] 支持导出图片
- **现状**: 未实现
- **涉及文件**: `src/pages/ComparisonPage.tsx`

### 12. 预计剩余时间 (ETA) 显示
- [ ] 后端 SSE 事件返回 eta_seconds 字段
- [ ] StageProgress 组件显示剩余时间
- [ ] 优化 ETA 计算算法
- **现状**: 前端组件支持，后端未返回 ETA
- **涉及文件**: `src-python/core/progress.py`, `src/components/StageProgress.tsx`

### 13. 缓存管理增强
- [ ] 添加"清理 30 天前缓存"选项
- [ ] 显示缓存详情（PDF 文件数、向量索引大小等）
- [ ] 支持选择性清理（按项目/按时间范围）
- **现状**: 只有"清理全部"
- **涉及文件**: `src/components/SettingsModal.tsx`, `src-python/api/config.py`

### 14. 研究领域多选
- [ ] 领域选择改为多选模式
- [ ] 更新后端 API 支持多领域配置
- [ ] 非核心领域显示"实验性支持"警告
- **现状**: 只能单选
- **涉及文件**: `src/pages/OnboardingPage.tsx`, `src/components/SettingsModal.tsx`

---

## 四、技术债务与优化

### 15. 类型安全增强
- [ ] 消除 `any` 类型使用
- [ ] 为所有 API 返回值定义 TypeScript 接口
- [ ] 添加运行时类型验证（zod）
- **涉及文件**: `src/types/index.ts`, 各 API service 文件

### 16. 错误处理统一
- [ ] 统一使用 Toast 显示用户友好错误
- [ ] 网络错误自动重试机制
- [ ] 离线模式支持
- **涉及文件**: `src/store/index.ts`, `src/services/*.ts`

### 17. 性能优化
- [ ] 列表虚拟滚动（超过 50 条时）
- [ ] 图片懒加载
- [ ] 组件懒加载（React.lazy）
- **涉及文件**: `src/pages/ResultsPage.tsx`, `src/pages/ProjectHubPage.tsx`

---

## 五、进度追踪

| 优先级 | 总数 | 已完成 | 进行中 | 未开始 |
|--------|------|--------|--------|--------|
| P0 | 4 | 4 | 0 | 0 |
| P1 | 5 | 5 | 0 | 0 |
| P2 | 5 | 0 | 0 | 5 |
| 技术债务 | 3 | 0 | 0 | 3 |
| **合计** | **17** | **9** | **0** | **8** |

---

## 六、变更日志

| 日期 | 变更内容 |
|------|----------|
| 2026-06-10 | 完成 P1 全部 5 项：检索状态区分 + SI附件展示 + 稳定性卡片 + 质量标注增强 + 条件后缀 |
| 2026-06-10 | 完成 P0 全部 3 项待办：PDF 片段浮层集成 + 见解实验室完善 + 快捷模式升级 |
| 2026-06-09 | 完成 P03 精准问答快捷问题按钮功能 |
| 2026-06-09 | 初始创建，基于 PRD V2.1 审查 |
