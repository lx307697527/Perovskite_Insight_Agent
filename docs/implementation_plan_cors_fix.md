# Implementation Plan - 修复设置界面测试连接 CORS 问题

## 问题分析
在 `SettingsModal.tsx` 中，"测试连通性"功能直接使用浏览器（WebView）的 `fetch` API 请求外部 LLM 接口。由于浏览器安全策略（CORS），如果 API 服务器未配置允许 `localhost:1420` 的跨域头，请求会被拦截并报错：
`Access to fetch at ... from origin 'http://localhost:1420' has been blocked by CORS policy.`

## 解决方案
将测试连通性的逻辑从前端移至后端（Python Sidecar）。由于后端（Python）不受浏览器跨域限制，它可以作为代理请求外部 API。

## 任务列表
- [x] **后端修改**: 在 `src-python/api/config.py` 中新增 `POST /api/config/test-connectivity` 接口。
- [x] **前端 Service 修改**: 在 `src/services/configApi.ts` 中新增 `testConnectivity` 方法。
- [x] **前端组件修改**: 更新 `src/components/SettingsModal.tsx`，将 `handleTestConnectivity` 中的 `fetch` 改为调用 `configApi.testConnectivity`。

## 思考
- 遵循 KISS 原则，复用已有的 `AIEngineConfig` 模型。
- 后端使用 `httpx` 进行异步请求，与现有的 `save_ai_engine` 保持一致。
- 这种方式不仅解决了跨域问题，还方便后续统一处理网络代理设置。

## 文档变更记录
| 日期 | 变更类型 | 变更内容 | 关联提交 |
|------|---------|---------|---------|
| 2026-05-16 | 修订 | 修复设置界面测试连接 CORS 问题，将逻辑移至后端代理 | - |
