# 嵌入模型加载故障自动修复交付报告 (Walkthrough)

## 变更概述
在系统后台加载嵌入模型（BGE-base-en-v1.5）时，如果本地缓存目录中残留了损坏或不完整的文件（例如先前下载被异常中断导致 `config.json` 缺少 `model_type` 等关键字段），`SentenceTransformer` 在加载时会抛出异常。原本的逻辑没有处理此异常，导致系统每次重启都会尝试读取损坏缓存，造成模型永久不可用。

我们为 `_load_model` 添加了**自动容错与静默自我修复机制**：
1. **本地缓存加载容错**：在尝试从本地缓存 `_MODEL_DIR` 加载模型时，使用 `try...except` 块包裹。
2. **清理故障缓存**：若加载抛出任何异常，自动记录警告日志并使用 `shutil.rmtree` 彻底清空损坏的缓存文件夹。
3. **重新下载与保存**：在清理后，自动从远程源重新下载模型，并将其保存到 `_MODEL_DIR` 下作为健康的缓存，确保下一次启动可快速从本地恢复。

## 涉及的代码变更

```diff
-            _model = SentenceTransformer(_MODEL_DIR)
+            try:
+                _model = SentenceTransformer(_MODEL_DIR)
+            except Exception as cache_err:
+                logger.warning(
+                    f"Failed to load embedding model from local cache ({cache_err}). "
+                    "Clearing broken cache and re-downloading from remote..."
+                )
+                import shutil
+                try:
+                    if os.path.exists(_MODEL_DIR):
+                        shutil.rmtree(_MODEL_DIR)
+                    os.makedirs(_MODEL_DIR, exist_ok=True)
+                except Exception as clean_err:
+                    logger.error(f"Failed to clean broken cache directory: {clean_err}")
+                
+                logger.info(f"Downloading embedding model: {model_name}")
+                _model = SentenceTransformer(model_name)
+                # Cache for future use
+                _model.save(_MODEL_DIR)
```

## 测试与验证结果

### 自动化/手动验证方案
我们通过在 `C:\Users\星\.gemini\antigravity\brain\c41c9fb2-e747-4291-a4cd-2d530c52e7c6\scratch\test_self_healing.py` 编写测试脚本来模拟损坏缓存场景。
- **模拟步骤**：
  1. 彻底清空 `_MODEL_DIR` 目录。
  2. 在 `_MODEL_DIR` 中写入一个损坏的 `config.json`（内容为 `{"invalid_key": "no model_type"}`）以及一个假的 `.ready` 标识文件。
  3. 执行 `_load_model()` 并验证是否成功清除并自动从远程下载、重新初始化状态为 `ready`。

- **验证结果**：
  测试脚本成功运行。系统在检测到本地缓存损坏（`Unrecognized model... Should have a model_type key`）后：
  1. 成功捕获异常。
  2. 输出 `Clearing broken cache and re-downloading from remote...` 日志并清除了损坏的目录。
  3. 从 Hugging Face 顺利重新拉取了模型文件，并使用 `_model.save(_MODEL_DIR)` 保存了健康的缓存。
  4. 最终状态变更为 `ready`，自动修复机制工作正常。

## 文档变更记录

| 日期 | 变更类型 | 变更内容 | 关联提交 |
|------|---------|---------|---------|
| 2026-05-27 | 新增 | 新增嵌入模型加载故障自动修复交付报告 | - |
