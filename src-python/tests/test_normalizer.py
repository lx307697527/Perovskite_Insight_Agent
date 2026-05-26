"""
Unit tests for core/normalizer.py

Covers: normalize_composition, convert_units, parse_metric_value,
evaluate_quality_flags, _latex_escape (from compare module).

Test cases: ALG-01 ~ ALG-09
"""

import pytest
from core.normalizer import (
    normalize_composition,
    parse_metric_value,
    evaluate_quality_flags,
    QualityWarning,
)
from api.compare import _latex_escape


# ============================================================
# ALG-01 ~ ALG-02: normalize_composition
# ============================================================

class TestNormalizeComposition:
    """ALG-01, ALG-02: Composition normalization."""

    def test_01_canonical_order(self):
        """ALG-01: Cations sorted by canonical order (Cs < FA < MA)."""
        result = normalize_composition("FA0.85MA0.1Cs0.05PbI3")
        assert result == "Cs0.05FA0.85MA0.1PbI3"

    def test_02_mixed_cation_text(self):
        """ALG-02: Mixed cation text pattern."""
        result = normalize_composition("Cs/FA/MA混合阳离子")
        assert "Cs" in result
        assert "FA" in result
        assert "MA" in result
        assert "mixed cation" in result

    def test_03_single_cation_fa(self):
        """Single cation FAPbBr3."""
        result = normalize_composition("FAPbBr3")
        assert "FA" in result
        assert "Pb" in result
        assert "Br" in result

    def test_04_single_cation_ma(self):
        """Single cation MAPbI3."""
        result = normalize_composition("MAPbI3")
        assert "MA" in result
        assert "Pb" in result
        assert "I" in result

    def test_05_empty_input(self):
        """Empty input returns as-is."""
        assert normalize_composition("") == ""
        assert normalize_composition(None) is None
        assert normalize_composition("   ") == ""

    def test_06_unknown_formula_fallback(self):
        """Unknown formula returns original string."""
        result = normalize_composition("some random text")
        assert result == "some random text"


# ============================================================
# ALG-03 ~ ALG-04: parse_metric_value
# ============================================================

class TestParseMetricValue:
    """ALG-03, ALG-04: Parse metric value strings."""

    def test_03_percentage(self):
        """ALG-03: Parse percentage value."""
        value, unit = parse_metric_value("24.9%")
        assert value == 24.9
        assert unit == "%"

    def test_04_volts(self):
        """Parse volts."""
        value, unit = parse_metric_value("1.12 V")
        assert value == 1.12
        assert unit == "V"

    def test_05_current_density(self):
        """Parse current density."""
        value, unit = parse_metric_value("22.3 mA/cm2")
        assert value == 22.3
        assert unit == "mA/cm2"

    def test_06_n_a_values(self):
        """N/A and equivalent values return (None, '')."""
        for val in ("N/A", "n/a", "null", "-", "—", "na"):
            parsed, unit = parse_metric_value(val)
            assert parsed is None, f"Expected None for '{val}', got {parsed}"
            assert unit == ""

    def test_07_non_numeric(self):
        """Non-numeric string returns (None, '')."""
        parsed, unit = parse_metric_value("not a number")
        assert parsed is None

    def test_08_scientific_notation(self):
        """Scientific notation parsing."""
        value, unit = parse_metric_value("1.5e-4 cm2")
        assert value == pytest.approx(1.5e-4)
        assert unit == "cm2"


# ============================================================
# ALG-05 ~ ALG-06: evaluate_quality_flags
# ============================================================

class TestEvaluateQualityFlags:
    """ALG-05, ALG-06: Quality flag evaluation rules."""

    def test_05_only_r_scan(self):
        """ALG-05: Only R-scan triggers warning."""
        metrics = {
            "metrics": [
                {"field": "PCE", "value": 25.1, "scan_direction": "R-scan", "has_spo": False},
                {"field": "Voc", "value": 1.21},
                {"field": "Jsc", "value": 25.3},
                {"field": "FF", "value": 82.1},
            ]
        }
        warnings = evaluate_quality_flags(metrics, {})
        reasons = [w.reason for w in warnings]
        assert any("仅 R-scan" in r for r in reasons)

    def test_06_both_scan_with_spo(self):
        """ALG-06: Both scan directions + SPO = no PCE warnings."""
        metrics = {
            "metrics": [
                {"field": "PCE", "value": 25.1, "scan_direction": "R-scan+F-scan", "has_spo": True},
                {"field": "Voc", "value": 1.21},
                {"field": "Jsc", "value": 25.3},
                {"field": "FF", "value": 82.1},
            ]
        }
        warnings = evaluate_quality_flags(metrics, {})
        pce_warnings = [w for w in warnings if w.field == "PCE"]
        assert len(pce_warnings) == 0

    def test_07_no_spo_warning(self):
        """No SPO triggers warning."""
        metrics = {
            "metrics": [
                {"field": "PCE", "value": 25.1, "scan_direction": "R-scan", "has_spo": False},
                {"field": "Voc", "value": 1.21},
                {"field": "Jsc", "value": 25.3},
                {"field": "FF", "value": 82.1},
            ]
        }
        warnings = evaluate_quality_flags(metrics, {})
        reasons = [w.reason for w in warnings]
        assert any("SPO" in r for r in reasons)

    def test_08_small_active_area(self):
        """Active area < 0.1 cm2 triggers warning."""
        metrics = {
            "metrics": [
                {"field": "PCE", "value": 25.1, "scan_direction": "R-scan", "has_spo": False},
                {"field": "Voc", "value": 1.21},
                {"field": "Jsc", "value": 25.3},
                {"field": "FF", "value": 82.1},
                {"field": "active_area", "value": 0.05},
            ]
        }
        warnings = evaluate_quality_flags(metrics, {})
        area_warnings = [w for w in warnings if w.field == "active_area"]
        assert len(area_warnings) > 0

    def test_09_missing_key_metrics(self):
        """Missing PCE/Voc/Jsc/FF triggers missing warnings."""
        metrics = {"metrics": [{"field": "PCE", "value": 25.1}]}
        warnings = evaluate_quality_flags(metrics, {})
        fields = [w.field for w in warnings if w.severity == "missing"]
        assert "Voc" in fields
        assert "Jsc" in fields
        assert "FF" in fields

    def test_10_stability_no_isos(self):
        """Stability data without ISOS protocol triggers warning."""
        metrics = {
            "metrics": [
                {"field": "PCE", "value": 25.1, "scan_direction": "R-scan", "has_spo": False},
                {"field": "Voc", "value": 1.21},
                {"field": "Jsc", "value": 25.3},
                {"field": "FF", "value": 82.1},
            ]
        }
        stability = {"t80": ">1000", "protocol": ""}
        warnings = evaluate_quality_flags(metrics, {}, stability)
        stab_warnings = [w for w in warnings if w.field == "stability"]
        assert len(stab_warnings) > 0
        assert "ISOS" in stab_warnings[0].reason

    def test_11_flat_metrics_format(self):
        """Flat metrics format (pce/voc/jsc/ff keys) also works."""
        metrics = {
            "pce": {"value": 25.1, "scan_direction": "R-scan", "has_spo": False},
            "voc": {"value": 1.21},
            "jsc": {"value": 25.3},
            "ff": {"value": 82.1},
        }
        warnings = evaluate_quality_flags(metrics, {})
        reasons = [w.reason for w in warnings]
        assert any("仅 R-scan" in r for r in reasons)


# ============================================================
# ALG-08 ~ ALG-09: _latex_escape
# ============================================================

class TestLatexEscape:
    """ALG-08, ALG-09: LaTeX special character escaping."""

    def test_08_ampersand(self):
        """ALG-08: Ampersand escaped."""
        assert _latex_escape("Zhang & Li") == "Zhang \\& Li"

    def test_09_percent(self):
        """ALG-09: Percent sign escaped."""
        assert _latex_escape("100%") == "100\\%"

    def test_10_dollar_sign(self):
        """Dollar sign escaped."""
        assert _latex_escape("$24.9%") == "\\$24.9\\%"

    def test_11_underscore(self):
        """Underscore escaped."""
        assert _latex_escape("test_value") == "test\\_value"

    def test_12_hash(self):
        """Hash escaped."""
        assert _latex_escape("#1") == "\\#1"

    def test_13_no_special_chars(self):
        """String without special chars is unchanged."""
        assert _latex_escape("Normal text") == "Normal text"

    def test_14_multiple_special_chars(self):
        """Multiple special characters all escaped."""
        result = _latex_escape("Zhang & Li's 100% #1 test_value")
        assert "\\&" in result
        assert "\\%" in result
        assert "\\#" in result
        assert "\\_" in result
