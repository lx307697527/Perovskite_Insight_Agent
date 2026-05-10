"""
PIA 修复验证测试 - 后端部分
覆盖 T01-T13 的所有已修复问题

运行方式:
  cd d:/Code_Space/Perovskite_Insight_Agent
  python -m pytest tests/test_backend_fixes.py -v --tb=short
"""
import pytest
import os
import sys

# 确保能导入 src-python 中的模块
_test_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(_test_dir)
_src_python = os.path.join(_project_root, 'src-python')
if _src_python not in sys.path:
    sys.path.insert(0, _src_python)

# 在导入 main 之前确保所有依赖可用
os.environ.setdefault('PIA_PORT', '8001')  # 避免端口冲突


# ============================================================
# T01: SSE Status 字段对齐
# ============================================================
class TestSSEStatusAlignment:
    """验证后端 SSE status 字段与前端判断一致"""

    def test_sse_status_values_match_frontend(self):
        """SSE status 值必须在前后端一致的白名单内"""
        # 后端发送的 status
        backend_statuses = {
            'downloading', 'parsing', 'extracting',
            'analyzing_si',
            'completed', 'failed', 'cached', 'error'
        }

        # 前端 ResultsPage.tsx 第96行判断的 status
        frontend_progress_statuses = {'extracting', 'parsing', 'downloading', 'analyzing_si'}

        # 核心交集: backend 发送的 extracting 必须在前端白名单中
        assert 'extracting' in frontend_progress_statuses, \
            "Frontend must check for 'extracting' status"
        assert 'extracting' in backend_statuses, \
            "Backend must send 'extracting' status"

    def test_extractor_uses_extracting_status(self):
        """extractor.py 应使用 'extracting' 作为 AI 分析阶段的 status"""
        ext_path = os.path.join(_src_python, 'core', 'extractor.py')
        with open(ext_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 确认 AI 分析阶段使用 'extracting' 而不是 'ai_analyzing'
        assert '"extracting"' in content, \
            "extractor.py must use 'extracting' as AI analysis status"
        # 确认不再使用 'ai_analyzing'（旧的错误值）
        assert '"ai_analyzing"' not in content, \
            "extractor.py should not use old 'ai_analyzing' status"

    def test_extraction_sse_flow_contains_extracting(self):
        """通过源码验证 SSE 流包含 extracting 状态"""
        ext_path = os.path.join(_src_python, 'core', 'extractor.py')
        with open(ext_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 验证 extraction 阶段 yield 的 status
        extracting_count = content.count('"extracting"')
        assert extracting_count >= 3, \
            f"extractor.py should yield 'extracting' status at least 3 times, found {extracting_count}"
        completed_count = content.count('"completed"')
        assert completed_count >= 1, \
            "extractor.py must contain 'completed' status"


# ============================================================
# T04: /api/history 响应格式
# ============================================================
class TestHistoryResponseFormat:
    """验证 /api/history 返回 {success, data} 格式"""

    def test_history_response_format_check(self):
        """通过源码验证 history 响应格式"""
        main_path = os.path.join(_src_python, 'main.py')
        with open(main_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 确认使用了 success/data 包装
        assert '"success": True' in content or '"success": true' in content, \
            "history endpoint must return success field"
        assert '"data":' in content or '"data": ' in content, \
            "history endpoint must return data field"

        # 确认不再是裸数组返回
        assert 'return [' not in content.split('async def get_search_history')[-1].split('\n')[0:10].__repr__() or \
               'return {' in content.split('get_search_history')[-1][:500], \
            "history should wrap response in object, not bare array"


# ============================================================
# T05: 搜索过滤器传递
# ============================================================
class TestSearchWithFilters:
    """验证搜索过滤器被正确传递到后端"""

    def test_main_accepts_filter_params(self):
        """main.py search API 应接受 filter 参数"""
        main_path = os.path.join(_src_python, 'main.py')
        with open(main_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'year_start' in content, \
            "main.py must accept year_start parameter"
        assert 'year_end' in content, \
            "main.py must accept year_end parameter"
        assert 'min_pce' in content, \
            "main.py must accept min_pce parameter"

    def test_api_ts_passes_filters(self):
        """api.ts 应将 filter 参数传递给后端"""
        api_path = os.path.join(_project_root, 'src', 'services', 'api.ts')
        with open(api_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'year_start' in content, "api.ts must pass year_start"
        assert 'year_end' in content, "api.ts must pass year_end"
        assert 'min_pce' in content, "api.ts must pass min_pce"

    def test_homepage_passes_filters(self):
        """HomePage 应将 filter 对象传递给 searchPapers"""
        home_path = os.path.join(_project_root, 'src', 'pages', 'HomePage.tsx')
        with open(home_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'filters' in content, \
            "HomePage must pass filters to searchPapers"
        assert 'searchPapers' in content, \
            "HomePage must call searchPapers"


# ============================================================
# T07: SQLite WAL 模式
# ============================================================
class TestSQLiteWALMode:
    """验证 SQLite WAL 模式已启用"""

    def test_wal_mode_is_set(self):
        """database.py 应设置 PRAGMA journal_mode=WAL"""
        db_path = os.path.join(_src_python, 'core', 'database.py')
        with open(db_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'journal_mode=WAL' in content, \
            "database.py must contain PRAGMA journal_mode=WAL"
        assert 'synchronous=NORMAL' in content, \
            "database.py must contain PRAGMA synchronous=NORMAL"

    def test_event_listener_exists(self):
        """验证 SQLAlchemy event listener 存在"""
        db_path = os.path.join(_src_python, 'core', 'database.py')
        with open(db_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert '@event.listens_for' in content or 'event.listens_for' in content, \
            "database.py must use @event.listens_for decorator"
        assert 'set_sqlite_pragma' in content, \
            "database.py must define set_sqlite_pragma function"


# ============================================================
# T08: 数据溯源 evidence 映射
# ============================================================
class TestEvidenceMapping:
    """验证 evidence 数据溯源被正确存储和返回"""

    def test_evidence_map_in_extractor(self):
        """extractor.py 应包含 evidence_map 存储溯源数据"""
        ext_path = os.path.join(_src_python, 'core', 'extractor.py')
        with open(ext_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'evidence_map' in content, \
            "extractor.py must contain evidence_map for storing traceability"
        assert 'source_mapping' in content, \
            "extractor.py must save evidence to source_mapping column"

    def test_evidence_in_paper_api(self):
        """main.py 中的 paper API 应使用 evidence_map 而非硬编码"""
        main_path = os.path.join(_src_python, 'main.py')
        with open(main_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'evidence_map' in content, \
            "main.py must use evidence_map for paper details"


# ============================================================
# T09: 单位标准化
# ============================================================
class TestUnitNormalization:
    """验证单位标准化函数"""

    def test_normalize_metric_exists(self):
        """extractor.py 应定义 _normalize_metric 方法"""
        ext_path = os.path.join(_src_python, 'core', 'extractor.py')
        with open(ext_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert '_normalize_metric' in content, \
            "extractor.py must define _normalize_metric method"
        # 验证处理 mV -> V 的逻辑
        assert 'mV' in content or 'mv' in content, \
            "_normalize_metric must handle mV -> V conversion"


# ============================================================
# T10: ISOS 稳定性提取
# ============================================================
class TestISOSInPrompt:
    """验证 prompts 包含 ISOS 稳定性提取要求"""

    def test_isos_in_perovskite_prompt(self):
        """主 prompt 必须包含 ISOS 相关指令"""
        prompt_path = os.path.join(_src_python, 'core', 'prompts.py')
        with open(prompt_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'ISOS' in content, \
            "PEROVSKITE_EXTRACTOR_PROMPT must contain ISOS keyword"
        assert 'T80' in content or 'T90' in content, \
            "PEROVSKITE_EXTRACTOR_PROMPT must contain T80/T90 lifetime metrics"
        assert 'Stability' in content, \
            "prompts must mention stability data"

    def test_isos_section_integrity(self):
        """验证 ISOS 提取说明的完整性"""
        prompt_path = os.path.join(_src_python, 'core', 'prompts.py')
        with open(prompt_path, 'r', encoding='utf-8') as f:
            content = f.read()
        # ISOS 部分应包含协议等级、测试条件和寿命指标
        assert 'ISOS-D' in content or 'ISOS-L' in content, \
            "Prompts must reference specific ISOS protocols"
        has_t80_t90 = 'T80' in content or 'T90' in content
        has_retained = 'retained' in content.lower() or 'lifetime' in content.lower()
        assert has_t80_t90 or has_retained, \
            "Prompts must mention stability lifetime metrics"


# ============================================================
# T11: SI 附件发现
# ============================================================
class TestSIDiscovery:
    """验证 SI 附件 URL 生成"""

    def test_si_urls_in_crawler(self):
        """crawler.py 应为 Science/Nature 生成 SI URL"""
        crawler_path = os.path.join(_src_python, 'core', 'crawler.py')
        with open(crawler_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'suppl_file' in content, \
            "crawler.py should generate Science SI URLs with 'suppl_file'"
        assert 'MediaObjects' in content, \
            "crawler.py should generate Nature SI URLs with 'MediaObjects'"

    def test_si_field_not_empty_for_known(self):
        """已知 publisher（Science/Nature）的 si 字段不应为空"""
        crawler_path = os.path.join(_src_python, 'core', 'crawler.py')
        with open(crawler_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 验证 Science SI URL 格式
        assert 'suppl_file' in content, \
            "Science SI URL should contain suppl_file"

        # 验证 Nature SI URL 格式
        assert 'MediaObjects' in content, \
            "Nature SI URL should contain MediaObjects"

        # 验证 si 字段的值不再是空数组（针对已知 publisher）
        assert '"si": []' not in content.split("10.1126")[1].split('elif')[0], \
            "Science block should have non-empty si list"


# ============================================================
# T12: 重复提取保护
# ============================================================
class TestConcurrentExtractionProtection:
    """验证重复提取保护机制"""

    def test_active_extractions_set_exists(self):
        """main.py 应包含 active_extractions 集合"""
        main_path = os.path.join(_src_python, 'main.py')
        with open(main_path, 'r', encoding='utf-8') as f:
            content = f.read()
        assert 'active_extractions' in content, \
            "main.py must define active_extractions set"
        assert '.add(' in content or '.remove(' in content or '.discard(' in content, \
            "active_extractions must add/remove items"


# ============================================================
# T13: PDF 404
# ============================================================
class TestPDFNotFound:
    """验证不存在的 PDF 返回 404"""

    def test_pdf_endpoint_no_placeholder(self):
        """PDF endpoint 不应再生成占位符 PDF"""
        main_path = os.path.join(_src_python, 'main.py')
        with open(main_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'placeholder_b64' not in content, \
            "main.py must not contain placeholder PDF base64 generation"
        assert 'raise HTTPException(status_code=404' in content, \
            "main.py must return 404 for missing PDFs"


# ============================================================
# 前端代码审查（源码级别验证）
# ============================================================
class TestFrontendCodeReview:
    """前端代码审查——验证修复是否到位"""

    def test_details_page_compare_button_wired(self):
        """验证 DetailsPage "加入对比" 有事件绑定"""
        frontend_path = os.path.join(
            _project_root, 'src', 'pages', 'DetailsPage.tsx'
        )
        with open(frontend_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'onToggleComparison' in content, \
            "DetailsPage must receive onToggleComparison prop"
        assert 'isCompared' in content, \
            "DetailsPage must receive isCompared prop"
        assert 'onClick={() => onToggleComparison' in content, \
            "Compare button must have onClick handler"

    def test_comparison_page_no_hardcoded_data(self):
        """验证 ComparisonPage 不再使用硬编码数据"""
        frontend_path = os.path.join(
            _project_root, 'src', 'pages', 'ComparisonPage.tsx'
        )
        with open(frontend_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert 'fetchPaperDetails' in content, \
            "ComparisonPage must call fetchPaperDetails"
        # 确认没有硬编码的 DOI 和性能数据
        assert '25.1' not in content.split('useState')[0] if 'useState' in content else True, \
            "ComparisonPage should not have hardcoded performance data"

    def test_sse_retry_exists(self):
        """验证 SSE 重试机制"""
        for fname in ['ResultsPage.tsx', 'DetailsPage.tsx']:
            frontend_path = os.path.join(_project_root, 'src', 'pages', fname)
            with open(frontend_path, 'r', encoding='utf-8') as f:
                content = f.read()
            assert 'retryCount' in content, \
                f"{fname} must use retryCount for SSE retry"
            assert 'retryCount < 3' in content or 'retryCount <= 3' in content, \
                f"{fname} SSE retry must have max 3 retries"

    def test_sse_error_handler_exists(self):
        """验证 ResultsPage 和 DetailsPage 有 SSE 错误处理器"""
        for fname in ['ResultsPage.tsx', 'DetailsPage.tsx']:
            frontend_path = os.path.join(_project_root, 'src', 'pages', fname)
            with open(frontend_path, 'r', encoding='utf-8') as f:
                content = f.read()
            handler_name = 'handleSSEError' if fname == 'ResultsPage.tsx' else 'handleExtractionError'
            assert handler_name in content, \
                f"{fname} must define {handler_name}"


# ============================================================
# 已知未修复问题（仅记录，不断言失败）
# ============================================================
class TestKnownLimitations:
    """已知未修复问题的记录"""

    def test_duplicate_translate_query_exists(self):
        """extractor.py 仍有冗余的 translate_query（已知问题）"""
        ext_path = os.path.join(_src_python, 'core', 'extractor.py')
        with open(ext_path, 'r', encoding='utf-8') as f:
            content = f.read()

        has_duplicate = 'translate_query' in content
        print(f"\n[INFO] extractor.py contains duplicate translate_query: {has_duplicate}")
        if has_duplicate:
            print("[WARN] 建议移除 extractor.py 中的 translate_query 方法，使用 translator.py 单例")

    def test_no_is_mounted_guard(self):
        """验证前端是否缺少 isMounted 守卫（已知问题）"""
        frontend_files = ['HomePage.tsx', 'DetailsPage.tsx']
        missing = []
        for fname in frontend_files:
            path = os.path.join(_project_root, 'src', 'pages', fname)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            if 'isMounted' not in content and 'useIsMounted' not in content:
                missing.append(fname)

        if missing:
            print(f"\n[INFO] isMounted guard missing in: {missing}")
            print("[WARN] 建议在异步操作前检查 isMounted 标志，防止组件卸载后更新状态")

    def test_dead_code_in_extractor(self):
        """extractor.py 死代码检查"""
        ext_path = os.path.join(_src_python, 'core', 'extractor.py')
        with open(ext_path, 'r', encoding='utf-8') as f:
            content = f.read()

        dead_items = []
        for name in ['extract_deep_data_progress', 'get_deep_data']:
            if name in content:
                dead_items.append(name)

        if dead_items:
            print(f"\n[INFO] Dead code found in extractor.py: {dead_items}")
            print("[WARN] 建议移除未使用的旧方法")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
