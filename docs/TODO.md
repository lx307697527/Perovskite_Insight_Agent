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
- [ ] 在提取数据卡片中添加 📍 定位图标
- [ ] 点击 📍 触发 PdfFragmentOverlay 浮层
- [ ] 浮层仅显示定位点前后 1 段内容（PRD 要求）
- [ ] 支持"在 PDF 中打开完整页面"按钮
- **现状**: PdfFragmentOverlay 组件已存在，但未在 DetailsPage 中使用
- **涉及文件**: `src/pages/DetailsPage.tsx`, `src/components/PdfFragmentOverlay.tsx`

### 3. P03 见解实验室页面完善
- [ ] 完善 `/insight/:doi` 路由的页面内容
- [ ] 集成精准问答输入框 + 回答展示
- [ ] 集成结构化提取卡片（性能指标/工艺参数/稳定性数据）
- [ ] 添加 PDF 片段浮层支持
- **现状**: InsightLabPage.tsx 存在但功能不完整
- **涉及文件**: `src/pages/InsightLabPage.tsx`

### 4. P01b 快捷模式页面完善
- [ ] 实现单篇文献的完整处理流程
- [ ] 集成问答 + 提取 + 定位功能
- [ ] 优化用户引导体验
- **现状**: QuickModePage.tsx 存在但功能简陋
- **涉及文件**: `src/pages/QuickModePage.tsx`

---

## 二、P1 中优先级（影响用户效率）

### 5. 检索结果"仅摘要 vs 有PDF"区分
- [ ] 检索结果卡片添加状态标识（📋 摘要 / 📄 全文）
- [ ] 仅摘要状态显示警告提示
- [ ] 添加"下载 PDF"按钮（需机构权限时提示）
- [ ] 添加"仅查看摘要详情"选项
- **现状**: 未实现状态区分
- **涉及文件**: `src/pages/ResultsPage.tsx`, `src/services/api.ts`

### 6. SI 附件展示与下载
- [ ] 详情页展示 SI 文件列表（SI_main.pdf, SI_data.xlsx 等）
- [ ] 每个文件提供"打开"按钮
- [ ] 显示文件大小信息
- [ ] 支持单独下载 SI 文件
- **现状**: 后端有 SI 解析逻辑，前端未展示
- **涉及文件**: `src/pages/DetailsPage.tsx`, `src-python/api/extract.py`

### 7. 稳定性数据卡片
- [ ] 新增"稳定性数据"展示区域
- [ ] 显示 ISOS 协议等级（ISOS-D-1, ISOS-L-1 等）
- [ ] 显示 T80/T90 寿命指标
- [ ] 显示测试条件（光强、温度、湿度）
- [ ] 添加来源定位支持
- **现状**: 未实现
- **涉及文件**: `src/pages/DetailsPage.tsx`, `src/types/index.ts`

### 8. 数据质量标注增强
- [ ] 完善 quality_flag 的展示逻辑
- [ ] ⚠ 图标 hover 显示具体原因（如"仅 R-scan，无 F-scan 对照"）
- [ ] 单元格背景色区分（绿色=最优、橙色=警告、灰色=缺失）
- [ ] 支持用户手动补充条件（触发"标记异议"弹窗）
- **现状**: 部分实现，hover 详情未完成
- **涉及文件**: `src/pages/ComparisonPage.tsx`, `src/pages/DetailsPage.tsx`

### 9. 数值条件后缀标注
- [ ] 性能数值旁显示扫描方向标签 [R-scan] / [F-scan]
- [ ] SPO 数据显示 ✅ 标识
- [ ] 缺少条件标注的数值显示 ⚠ 警告图标
- **现状**: 后端有数据，前端未展示
- **涉及文件**: `src/pages/DetailsPage.tsx`, `src/components/MetricCard.tsx`（待创建）

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
| P0 | 4 | 1 | 0 | 3 |
| P1 | 5 | 0 | 0 | 5 |
| P2 | 5 | 0 | 0 | 5 |
| 技术债务 | 3 | 0 | 0 | 3 |
| **合计** | **17** | **1** | **0** | **16** |

---

## 六、变更日志

| 日期 | 变更内容 |
|------|----------|
| 2026-06-09 | 完成 P03 精准问答快捷问题按钮功能 |
| 2026-06-09 | 初始创建，基于 PRD V2.1 审查 |
