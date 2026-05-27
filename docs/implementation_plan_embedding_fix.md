# 解决嵌入模型缓存损坏加载失败的实现计划

本项目在启动时会尝试在后台加载嵌入模型（BGE-base-en-v1.5）。如果本地缓存目录 `C:\Users\星\AppData\Roaming\SIA\embedding_model` 存在，系统会直接加载缓存。但是，如果缓存不完整或其中的 `config.json` 损坏（如缺少 `model_type` 等关键字段），`SentenceTransformer` 的加载将报错，从而导致嵌入服务永久不可用。

本计划旨在引入自动容错与自我修复机制：若本地缓存加载失败，则清理损坏的缓存目录并重新从线上下载模型。

## 用户审核要求

> [!IMPORTANT]
> - 本次修复仅修改嵌入模型的加载策略，即在本地缓存失效时自动清除并从线上（Hugging Face）重新下载。
> - 在国内网络环境下，首次由于缓存损坏触发重新下载时，可能需要连接 Hugging Face，这在没有良好网络或镜像配置时可能会面临下载缓慢的问题。

## 影响面分析 (Impact Analysis)

使用 `npx gitnexus impact` 对 `_load_model` 函数分析的结果如下：
- **风险等级 (Risk Level)**: `LOW`
- **影响范围 (Blast Radius)**: 
  - 直接调用方 (Depth 1): `_delayed_load` 和 `get_model`
  - 间接影响 (Depth 2/3): `embed_texts` (Depth 2), `embed_single` (Depth 3)
- 所有影响均在 `src-python/core/model_manager.py` 内部，对外无破坏性影响，无架构破坏风险。

## 提议的变更

### Core 模块

---

#### [MODIFY] [model_manager.py](file:///d:/Code_Space/Perovskite_Insight_Agent/src-python/core/model_manager.py)

修改 `_load_model` 函数的本地缓存加载逻辑：
1. 使用 `try...except` 块包裹本地缓存的加载操作。
2. 若捕获加载异常，输出日志警告并执行清理操作（使用 `shutil.rmtree` 删除 `_MODEL_DIR`）。
3. 清理后，自动调用远程拉取 `SentenceTransformer(model_name)` 重新下载。
4. 下载成功后，自动执行 `_model.save(_MODEL_DIR)` 保存一份正确的本地缓存。

## 验证计划

### 自动化与手动测试

1. **构造损坏的缓存进行测试**：
   - 手动在 `C:\Users\星\AppData\Roaming\SIA\embedding_model` 目录下创建一个假的/损坏的 `config.json`。
   - 启动服务或调用嵌入接口。
   - 观察控制台日志，确认是否有类似 `Failed to load embedding model from local cache. Re-downloading from remote...` 的提示。
   - 检查缓存目录中的文件是否被成功替换并可以正常加载。

2. **验证最终加载状态**：
   - 确认最终状态变更为 `ready`。
   - 测试 Q&A 嵌入接口以验证功能。

## 文档变更记录

| 日期 | 变更类型 | 变更内容 | 关联提交 |
|------|---------|---------|---------|
| 2026-05-27 | 新增 | 新增嵌入模型加载故障自动修复实现计划 | - |
