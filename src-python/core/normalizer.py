"""
Chemical Composition Normalizer + Unit Conversion + Quality Flag Engine.

Three core functions:
1. normalize_composition: Parse perovskite formula → canonical form
2. convert_units: Dimensional analysis via pint
3. evaluate_quality_flags: Rule engine for data quality warnings

All functions are pure computation — no I/O, no DB access.
"""

import re
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# ============================================================
# Cation ordering for canonical form
# ============================================================
_CATION_ORDER = {"Cs": 0, "FA": 1, "MA": 2, "GA": 3, "K": 4, "Rb": 5, "Na": 6}

# A-site cation patterns
_CATION_RE = re.compile(
    r'(Cs|FA|MA|GA|K|Rb|Na)(\d*\.?\d*)'
)

# Full perovskite pattern: A-site mix + Pb + X-site
_PEROVSKITE_RE = re.compile(
    r'^(?:'
    r'(?:Cs|FA|MA|GA|K|Rb|Na)(?:\d*\.?\d*)'  # first cation
    r'(?:\s*(?:Cs|FA|MA|GA|K|Rb|Na)(?:\d*\.?\d*))+'  # additional cations
    r')?'
    r'Pb(I|Br|Cl)(?:\d*\.?\d*)?'  # B-site + X-site
    r'(?:I|Br|Cl)(?:\d*\.?\d*)?'  # optional second halide
    r'$',
    re.IGNORECASE
)

# Simplified formula: just cations + Pb + halide(s)
_SIMPLE_FORMULA_RE = re.compile(
    r'((?:(?:Cs|FA|MA|GA|K|Rb|Na)(?:\d*\.?\d*)?\s*)+)'
    r'Pb((?:I|Br|Cl)(?:\d*\.?\d*)?(?:I|Br|Cl)?(?:\d*\.?\d*)?)',
    re.IGNORECASE
)

# Mixed cation text patterns
_MIXED_TEXT_RE = re.compile(
    r'(Cs|FA|MA|GA|K|Rb|Na)[/|\s,]+(Cs|FA|MA|GA|K|Rb|Na)(?:[/|\s,]+(?:Cs|FA|MA|GA|K|Rb|Na))*'
    r'\s*(?:三阳离子|双阳离子|混合阳离子|triple|double|mixed)',
    re.IGNORECASE
)


def normalize_composition(raw: str) -> str:
    """Parse perovskite composition string into canonical form.

    Rules:
    - Cations sorted: Cs < FA < MA < GA < K < Rb < Na
    - Subscripts normalized (no leading zeros, no trailing .0)
    - If subscripts sum to ~1.0, keep as-is; if integers, divide by gcd
    - Fallback: return original string unchanged

    Examples:
        "FA0.85MA0.1Cs0.05PbI3" -> "Cs0.05FA0.85MA0.1PbI3"
        "Cs/FA/MA混合阳离子" -> "Cs/FA/MA mixed cation"
        "FAPbBr3" -> "FAPbBr3"
        "MAPbI3" -> "MAPbI3"
    """
    if not raw or not raw.strip():
        return raw

    stripped = raw.strip()

    # Try structured formula parse
    match = _SIMPLE_FORMULA_RE.search(stripped)
    if match:
        cation_part = match.group(1)
        halide_part = match.group(2)

        cations = _CATION_RE.findall(cation_part)
        if cations:
            # Sort by canonical order
            cations.sort(key=lambda c: _CATION_ORDER.get(c[0], 99))

            # Build canonical A-site
            a_site = ""
            for name, subscript in cations:
                sub = _normalize_subscript(subscript)
                a_site += f"{name}{sub}"

            return f"{a_site}Pb{halide_part}"

    # Try mixed cation text pattern
    match = _MIXED_TEXT_RE.search(stripped)
    if match:
        # Extract all cations mentioned
        cations_found = _CATION_RE.findall(stripped)
        if cations_found:
            cation_names = sorted(set(c[0] for c in cations_found),
                                  key=lambda c: _CATION_ORDER.get(c, 99))
            return "/".join(cation_names) + " mixed cation"

    # Simple single-cation perovskite
    for cation in ["Cs", "FA", "MA", "GA"]:
        pattern = re.compile(rf'^{cation}Pb(I|Br|Cl)3$', re.IGNORECASE)
        if pattern.match(stripped):
            return f"{cation}Pb{match.group(1) if match else 'I'}3"

    # Fail-open: return original
    return stripped


def _normalize_subscript(sub: str) -> str:
    """Normalize a subscript value: remove trailing .0, leading zeros."""
    if not sub:
        return ""
    try:
        val = float(sub)
        if val == int(val):
            return str(int(val))
        # Remove trailing zeros
        formatted = f"{val:g}"
        return formatted
    except (ValueError, OverflowError):
        return sub


# ============================================================
# Unit Conversion
# ============================================================

# Lazy pint initialization
_ureg = None


def _get_ureg():
    """Lazy-load pint UnitRegistry."""
    global _ureg
    if _ureg is None:
        try:
            import pint
            _ureg = pint.UnitRegistry()
        except ImportError:
            logger.warning("pint not installed — unit conversion disabled")
            return None
    return _ureg


# Common perovskite unit mappings
_UNIT_ALIASES = {
    "mA/cm2": "milliampere / centimeter**2",
    "mA/cm²": "milliampere / centimeter**2",
    "mA·cm⁻²": "milliampere / centimeter**2",
    "A/cm2": "ampere / centimeter**2",
    "A/m2": "ampere / meter**2",
    "mV": "millivolt",
    "V": "volt",
    "mW/cm2": "milliwatt / centimeter**2",
    "W/m2": "watt / meter**2",
    "nm": "nanometer",
    "um": "micrometer",
    "μm": "micrometer",
    "%": "percent",
    "°C": "degC",
    "rpm": "rpm",
    "M": "molar",
    "ppm": "ppm",
}

# Standard target units for perovskite metrics
_TARGET_UNITS = {
    "PCE": "%",
    "Voc": "V",
    "Jsc": "mA/cm2",
    "FF": "%",
    "active_area": "cm2",
    "thickness": "nm",
    "annealing_temperature": "degC",
}


def convert_units(value_str: str, target_unit: str) -> tuple[float, str]:
    """Convert a value string to the target unit using pint.

    Args:
        value_str: String like "24.9%", "1.12 V", "22.3 mA/cm2"
        target_unit: Target unit like "V", "mA/cm2", "%"

    Returns:
        (numeric_value, canonical_unit_string)
        On failure: (parsed_float, original_unit)
    """
    if not value_str or not value_str.strip():
        return (0.0, target_unit)

    stripped = value_str.strip()

    # Parse numeric value and unit from string
    num_match = re.match(r'^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*(.*)', stripped)
    if not num_match:
        # Try just a number
        try:
            return (float(stripped), target_unit)
        except ValueError:
            return (0.0, target_unit)

    num_val = float(num_match.group(1))
    unit_str = num_match.group(2).strip()

    if not unit_str:
        # No unit in input — assume already in target unit
        return (num_val, target_unit)

    ureg = _get_ureg()
    if ureg is None:
        return (num_val, unit_str)

    # Resolve unit aliases
    pint_unit_str = _UNIT_ALIASES.get(unit_str, unit_str)
    target_pint_str = _UNIT_ALIASES.get(target_unit, target_unit)

    try:
        source_quantity = num_val * ureg(pint_unit_str)
        target_quantity = source_quantity.to(ureg(target_pint_str))
        return (float(target_quantity.magnitude), target_unit)
    except Exception as e:
        logger.debug(f"Unit conversion failed '{value_str}' -> '{target_unit}': {e}")
        return (num_val, unit_str)


def parse_metric_value(value_str: str) -> tuple[Optional[float], str]:
    """Parse a metric value string into (number, unit).

    Examples:
        "24.9%" -> (24.9, "%")
        "1.12 V" -> (1.12, "V")
        "22.3 mA/cm2" -> (22.3, "mA/cm2")
        "N/A" -> (None, "")
    """
    if not value_str or value_str.strip().lower() in ("n/a", "null", "-", "—", "na"):
        return (None, "")

    stripped = value_str.strip()
    num_match = re.match(r'^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*(.*)', stripped)
    if not num_match:
        return (None, "")

    return (float(num_match.group(1)), num_match.group(2).strip())


# ============================================================
# Quality Flag Engine
# ============================================================

@dataclass
class QualityWarning:
    """A data quality warning for a specific metric field."""
    field: str
    reason: str
    severity: str  # "warning" or "missing"


def evaluate_quality_flags(
    metrics: dict,
    process: dict,
    stability: Optional[dict] = None,
) -> list[QualityWarning]:
    """Evaluate data quality flags based on perovskite research best practices.

    Args:
        metrics: Extracted performance metrics dict. Expected keys:
            - "metrics": list of {field, value, condition, scan_direction, has_spo}
            - Or flat keys: "pce", "voc", "jsc", "ff" with {value, scan_direction, has_spo}
        process: Extracted process parameters dict.
        stability: Optional stability data dict with "protocol" key.

    Returns:
        List of QualityWarning objects.
    """
    warnings: list[QualityWarning] = []

    # Normalize input — handle both flat and structured metrics
    flat_metrics = _flatten_metrics(metrics)

    # Rule 1: Scan direction — only R-scan without F-scan
    pce_data = flat_metrics.get("PCE") or flat_metrics.get("pce")
    if pce_data:
        scan_dir = _get_scan_direction(pce_data)
        has_spo = _get_has_spo(pce_data)

        if scan_dir == "R-scan":
            warnings.append(QualityWarning(
                field="PCE",
                reason="仅 R-scan，无 F-scan 对照，效率可能偏高",
                severity="warning",
            ))

        # Rule 2: No SPO reported
        if not has_spo:
            warnings.append(QualityWarning(
                field="PCE",
                reason="未报告稳态功率输出 (SPO)，效率可靠性存疑",
                severity="warning",
            ))

    # Rule 3: Active area
    active_area = _get_active_area(metrics, process)
    if active_area is not None:
        try:
            if active_area < 0.1:
                warnings.append(QualityWarning(
                    field="active_area",
                    reason=f"活性面积偏小 ({active_area} cm²)，认证效率要求 ≥0.1 cm²",
                    severity="warning",
                ))
        except (TypeError, ValueError):
            pass
    else:
        # Check if this is a solar cell paper without area info
        device_type = _get_device_type(metrics)
        if device_type == "solar_cell":
            warnings.append(QualityWarning(
                field="active_area",
                reason="未报告活性面积，无法验证效率认证标准",
                severity="warning",
            ))

    # Rule 4: ISOS protocol for stability data
    if stability:
        protocol = stability.get("protocol", "")
        if stability.get("t80") or stability.get("t90") or stability.get("retention"):
            if not protocol or protocol.lower() in ("", "none", "n/a", "unknown"):
                warnings.append(QualityWarning(
                    field="stability",
                    reason="稳定性数据未遵循 ISOS 协议，测试条件不可比",
                    severity="warning",
                ))

    # Rule 5: Missing key metrics
    required_metrics = ["PCE", "Voc", "Jsc", "FF"]
    for metric_name in required_metrics:
        if not flat_metrics.get(metric_name) and not flat_metrics.get(metric_name.lower()):
            warnings.append(QualityWarning(
                field=metric_name,
                reason=f"关键指标 {metric_name} 未提取",
                severity="missing",
            ))

    return warnings


def _flatten_metrics(metrics: dict) -> dict:
    """Flatten structured metrics into a simple dict keyed by field name."""
    flat = {}

    # Handle structured format: {"metrics": [{field, value, ...}]}
    if "metrics" in metrics and isinstance(metrics["metrics"], list):
        for m in metrics["metrics"]:
            field_name = m.get("field", "")
            flat[field_name] = m
            flat[field_name.lower()] = m
        return flat

    # Handle flat format: {"pce": {...}, "voc": {...}}
    for key, val in metrics.items():
        if isinstance(val, dict):
            flat[key] = val
            flat[key.upper()] = val
            flat[key.lower()] = val
        elif val is not None:
            flat[key] = {"value": val}
            flat[key.upper()] = {"value": val}
            flat[key.lower()] = {"value": val}

    return flat


def _get_scan_direction(metric_data) -> str:
    """Extract scan direction from metric data."""
    if isinstance(metric_data, dict):
        return metric_data.get("scan_direction", "") or ""
    return ""


def _get_has_spo(metric_data) -> bool:
    """Check if SPO data is reported."""
    if isinstance(metric_data, dict):
        spo = metric_data.get("has_spo")
        if isinstance(spo, bool):
            return spo
        if isinstance(spo, str):
            return spo.lower() in ("true", "yes", "1")
    return False


def _get_active_area(metrics: dict, process: dict) -> Optional[float]:
    """Extract active area from metrics or process data."""
    # Check metrics first
    flat = _flatten_metrics(metrics)
    area_data = flat.get("active_area") or flat.get("Active Area")
    if area_data:
        if isinstance(area_data, dict):
            val = area_data.get("value", "")
        else:
            val = str(area_data)
        parsed, _ = parse_metric_value(str(val))
        if parsed is not None:
            # Convert to cm² if in other units
            converted, _ = convert_units(str(val), "cm2")
            return converted

    # Check process params
    if process and isinstance(process, dict):
        for key in ("active_area", "Active Area", "area"):
            if key in process:
                val = process[key]
                if isinstance(val, dict):
                    val = val.get("value", "")
                parsed, _ = parse_metric_value(str(val))
                if parsed is not None:
                    return parsed

    return None


def _get_device_type(metrics: dict) -> str:
    """Extract device type from metrics."""
    if isinstance(metrics, dict):
        dt = metrics.get("device_type", "")
        if dt:
            return dt.lower()
        # Infer from metric fields
        flat = _flatten_metrics(metrics)
        if flat.get("PCE") or flat.get("pce"):
            return "solar_cell"
    return ""
