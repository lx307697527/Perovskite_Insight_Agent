"""Compare and export API routes — condition filtering + quality warnings + multi-format export."""

import csv
import io
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import SessionLocal, Literature, Project
from core.normalizer import (
    normalize_composition,
    evaluate_quality_flags,
    parse_metric_value,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["compare"])


class ExportRequest(BaseModel):
    format: str  # excel, csv, latex, png, svg
    dois: Optional[list[str]] = None
    view_mode: Optional[str] = "metrics"  # metrics | literature


# ============================================================
# Helper: Build comparison data from project literature
# ============================================================

def _build_comparison_data(
    project_id: str,
    scan_direction: Optional[str] = None,
    min_active_area: Optional[float] = None,
    has_spo: Optional[bool] = None,
    isos_protocol: Optional[str] = None,
    year_start: Optional[int] = None,
    year_end: Optional[int] = None,
    view_mode: str = "metrics",
) -> dict:
    """Build comparison data with quality warnings and condition filtering."""
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return {"success": False, "error": f"Project {project_id} not found"}

        query = db.query(Literature).filter(
            Literature.project_id == project_id,
            Literature.is_extracted == True,
        )

        if year_start:
            query = query.filter(Literature.year >= year_start)
        if year_end:
            query = query.filter(Literature.year <= year_end)

        literature_list = query.all()

        if not literature_list:
            return {
                "success": True,
                "data": {
                    "columns": [],
                    "rows": [],
                    "quality_warnings": {},
                    "total": 0,
                    "filtered": 0,
                    "view_mode": view_mode,
                },
            }

        # Process each literature entry
        processed = []
        all_warnings = {}
        total_count = len(literature_list)

        for lit in literature_list:
            perf = json.loads(lit.performance_data) if lit.performance_data else {}
            process = json.loads(lit.process_params) if lit.process_params else {}
            stability = json.loads(lit.stability_data) if lit.stability_data else {}

            # Normalize composition
            raw_comp = perf.get("composition", "") or process.get("composition", "")
            composition = normalize_composition(raw_comp) if raw_comp else ""

            # Extract metrics with conditions
            metrics = perf.get("metrics", []) if isinstance(perf, dict) else []
            flat_metrics = {}
            for m in metrics:
                field = m.get("field", "")
                flat_metrics[field] = m

            # Also check flat format
            if not metrics:
                for key in ("pce", "voc", "jsc", "ff"):
                    if key in perf:
                        flat_metrics[key.upper()] = {"field": key.upper(), **perf[key]} if isinstance(perf[key], dict) else {"field": key.upper(), "value": perf[key]}

            # Extract scan direction and SPO from metrics
            pce_metric = flat_metrics.get("PCE", {})
            lit_scan_dir = ""
            if isinstance(pce_metric, dict):
                lit_scan_dir = pce_metric.get("scan_direction", "") or pce_metric.get("condition", "")

            lit_has_spo = False
            if isinstance(pce_metric, dict):
                spo_val = pce_metric.get("has_spo")
                lit_has_spo = spo_val is True or (isinstance(spo_val, str) and spo_val.lower() in ("true", "yes"))

            # Apply condition filters
            if scan_direction and scan_direction != "all":
                if scan_direction == "both":
                    # Only include papers that report both directions
                    if not ("R-scan" in lit_scan_dir and "F-scan" in lit_scan_dir):
                        continue
                elif scan_direction not in lit_scan_dir.lower():
                    continue

            if has_spo is not None:
                if has_spo and not lit_has_spo:
                    continue
                if not has_spo and lit_has_spo:
                    continue

            if min_active_area is not None:
                area_val = _extract_active_area(perf, process)
                if area_val is None or area_val < min_active_area:
                    continue

            if isos_protocol and isos_protocol != "all":
                stability_protocol = stability.get("protocol", "") if isinstance(stability, dict) else ""
                if isos_protocol == "non_standard":
                    if stability_protocol and stability_protocol.lower() not in ("none", "n/a", ""):
                        if "ISOS" in stability_protocol.upper():
                            continue
                elif isos_protocol.lower() not in stability_protocol.lower():
                    continue

            # Evaluate quality flags
            warnings = evaluate_quality_flags(perf, process, stability)
            lit_warnings = {w.field: {"reason": w.reason, "severity": w.severity} for w in warnings}
            all_warnings[lit.doi] = lit_warnings

            # Build row data
            row = {
                "doi": lit.doi,
                "title": lit.title or lit.doi,
                "journal": lit.journal,
                "year": lit.year,
                "composition": composition,
                "structure": perf.get("structure", "") or process.get("structure", ""),
                "metrics": {},
                "quality_flag": lit.quality_flag,
            }

            # Extract metric values
            for field_name, metric_data in flat_metrics.items():
                if isinstance(metric_data, dict):
                    row["metrics"][field_name] = {
                        "value": metric_data.get("value", ""),
                        "condition": metric_data.get("condition", ""),
                        "scan_direction": metric_data.get("scan_direction", ""),
                        "has_spo": metric_data.get("has_spo", False),
                        "evidence": metric_data.get("evidence", ""),
                    }
                else:
                    row["metrics"][field_name] = {"value": str(metric_data)}

            processed.append(row)

        # Build response based on view mode
        filtered_count = len(processed)

        if view_mode == "literature":
            # Papers as columns, metrics as rows
            columns = ["Metric"] + [p["title"][:30] for p in processed]
            metric_fields = _collect_metric_fields(processed)
            rows = []
            for field in metric_fields:
                row = {"Metric": field}
                for p in processed:
                    m = p["metrics"].get(field, {})
                    row[p["title"][:30]] = m.get("value", "") if isinstance(m, dict) else str(m)
                rows.append(row)
        else:
            # Metrics as columns, papers as rows (default)
            metric_fields = _collect_metric_fields(processed)
            columns = ["DOI", "Title", "Composition", "Structure"] + metric_fields
            rows = []
            for p in processed:
                row = {
                    "DOI": p["doi"],
                    "Title": p["title"],
                    "Composition": p["composition"],
                    "Structure": p["structure"],
                }
                for field in metric_fields:
                    m = p["metrics"].get(field, {})
                    row[field] = m.get("value", "") if isinstance(m, dict) else str(m)
                rows.append(row)

        return {
            "success": True,
            "data": {
                "columns": columns,
                "rows": rows,
                "quality_warnings": all_warnings,
                "total": total_count,
                "filtered": filtered_count,
                "view_mode": view_mode,
            },
        }
    except Exception as e:
        logger.error(f"Failed to build comparison data for project {project_id}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()


def _collect_metric_fields(processed: list[dict]) -> list[str]:
    """Collect all unique metric field names across processed literature."""
    fields = []
    seen = set()
    # Priority order
    priority = ["PCE", "Voc", "Jsc", "FF"]
    for p in processed:
        for f in priority:
            if f in p.get("metrics", {}) and f not in seen:
                fields.append(f)
                seen.add(f)
        for f in p.get("metrics", {}):
            if f not in seen:
                fields.append(f)
                seen.add(f)
    return fields


def _extract_active_area(perf: dict, process: dict) -> Optional[float]:
    """Extract active area value from performance or process data."""
    for data in [perf, process]:
        if not isinstance(data, dict):
            continue
        for key in ("active_area", "Active Area", "area"):
            if key in data:
                val = data[key]
                if isinstance(val, dict):
                    val = val.get("value", "")
                parsed, _ = parse_metric_value(str(val))
                if parsed is not None:
                    return parsed
    return None


# ============================================================
# API Endpoints
# ============================================================

@router.get("/project/{project_id}/compare")
async def get_compare_data(
    project_id: str,
    scan_direction: Optional[str] = Query(None, description="Filter by scan direction: all, R-scan, F-scan, both"),
    min_active_area: Optional[float] = Query(None, description="Minimum active area in cm²"),
    has_spo: Optional[bool] = Query(None, description="Filter by SPO availability"),
    isos_protocol: Optional[str] = Query(None, description="Filter by ISOS protocol"),
    year_start: Optional[int] = Query(None, description="Start year"),
    year_end: Optional[int] = Query(None, description="End year"),
    view_mode: str = Query("metrics", description="View mode: metrics or literature"),
):
    """Get comparison data for project literature with condition filtering and quality warnings.

    Returns:
    - columns: Column headers
    - rows: Data rows
    - quality_warnings: Per-DOI quality warning mapping
    - total/filtered: Paper counts before and after filtering
    """
    result = _build_comparison_data(
        project_id=project_id,
        scan_direction=scan_direction,
        min_active_area=min_active_area,
        has_spo=has_spo,
        isos_protocol=isos_protocol,
        year_start=year_start,
        year_end=year_end,
        view_mode=view_mode,
    )
    return result


@router.post("/project/{project_id}/compare/export")
async def export_comparison(project_id: str, body: ExportRequest):
    """Export comparison data in specified format.

    Supported formats: excel, csv, latex, png, svg
    """
    # Build data first
    data_result = _build_comparison_data(
        project_id=project_id,
        view_mode=body.view_mode or "metrics",
    )

    if not data_result.get("success"):
        raise HTTPException(status_code=500, detail=data_result.get("error", "Failed to build comparison data"))

    data = data_result["data"]
    warnings = data.get("quality_warnings", {})

    fmt = body.format.lower()

    if fmt == "excel":
        return _export_excel(data, warnings)
    elif fmt == "csv":
        return _export_csv(data)
    elif fmt == "latex":
        return _export_latex(data, warnings)
    elif fmt == "png":
        return _export_png(data, warnings)
    elif fmt == "svg":
        return _export_svg(data, warnings)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported export format: {fmt}")


# ============================================================
# Export formatters
# ============================================================

def _export_excel(data: dict, warnings: dict) -> StreamingResponse:
    """Export as Excel with quality warning annotations."""
    import pandas as pd

    rows = data.get("rows", [])
    if not rows:
        raise HTTPException(status_code=404, detail="No data to export")

    df = pd.DataFrame(rows, columns=data.get("columns", []))

    # Add quality warnings column
    warning_col = []
    for row in rows:
        doi = row.get("DOI", "")
        doi_warnings = warnings.get(doi, {})
        if doi_warnings:
            warning_texts = [f"{f}: {w['reason']}" for f, w in doi_warnings.items()]
            warning_col.append("; ".join(warning_texts))
        else:
            warning_col.append("")
    df["Quality Warnings"] = warning_col

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Comparison')

        worksheet = writer.sheets['Comparison']
        for idx, col in enumerate(df.columns):
            max_len = max(df[col].astype(str).map(len).max(), len(col)) + 2
            col_letter = chr(65 + idx) if idx < 26 else chr(64 + idx // 26) + chr(65 + idx % 26)
            worksheet.column_dimensions[col_letter].width = min(max_len, 60)

    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=comparison.xlsx"},
    )


def _export_csv(data: dict) -> StreamingResponse:
    """Export as CSV."""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=data.get("columns", []))
    writer.writeheader()
    for row in data.get("rows", []):
        writer.writerow(row)

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8-sig')),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=comparison.csv"},
    )


def _export_latex(data: dict, warnings: dict) -> StreamingResponse:
    """Export as LaTeX table with tablenotes for quality warnings."""
    columns = data.get("columns", [])
    rows = data.get("rows", [])

    if not rows:
        raise HTTPException(status_code=404, detail="No data to export")

    # Sanitize column names for LaTeX
    latex_cols = [_latex_escape(c) for c in columns]
    num_cols = len(latex_cols)

    lines = []
    lines.append(r"\begin{table}[htbp]")
    lines.append(r"\centering")
    lines.append(r"\caption{Comparison of perovskite device performance}")
    lines.append(r"\label{tab:comparison}")
    col_spec = "l" * num_cols
    lines.append(f"\\begin{{tabular}}{{{col_spec}}}")
    lines.append(r"\toprule")

    # Header
    lines.append(" & ".join(latex_cols) + r" \\")
    lines.append(r"\midrule")

    # Data rows
    for i, row in enumerate(rows):
        cells = []
        for col in columns:
            val = str(row.get(col, ""))
            # Find max PCE for bold
            if col == "PCE":
                val = _latex_escape(val)
            else:
                val = _latex_escape(val)
            cells.append(val)
        lines.append(" & ".join(cells) + r" \\")

    lines.append(r"\bottomrule")
    lines.append(r"\end{tabular}")

    # Tablenotes for quality warnings
    all_notes = []
    note_idx = 0
    for doi, doi_warnings in warnings.items():
        for field, w in doi_warnings.items():
            note_idx += 1
            all_notes.append(f"$^{chr(96+note_idx)}$ {w['reason']}")

    if all_notes:
        lines.append(r"\begin{tablenotes}")
        lines.append(r"\small")
        for note in all_notes:
            lines.append(f"\\item {note}")
        lines.append(r"\end{tablenotes}")

    lines.append(r"\end{table}")

    latex_content = "\n".join(lines)

    return StreamingResponse(
        io.BytesIO(latex_content.encode('utf-8')),
        media_type="text/x-tex",
        headers={"Content-Disposition": "attachment; filename=comparison.tex"},
    )


def _export_png(data: dict, warnings: dict) -> StreamingResponse:
    """Export as PNG image using matplotlib."""
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except ImportError:
        raise HTTPException(status_code=500, detail="matplotlib not installed")

    columns = data.get("columns", [])
    rows = data.get("rows", [])

    if not rows:
        raise HTTPException(status_code=404, detail="No data to export")

    fig, ax = plt.subplots(figsize=(max(8, len(columns) * 2), max(4, len(rows) * 0.5 + 1)))
    ax.axis('off')

    # Prepare table data
    cell_text = []
    cell_colors = []
    for row in rows:
        text_row = []
        color_row = []
        for col in columns:
            val = str(row.get(col, ""))
            if len(val) > 30:
                val = val[:28] + ".."
            text_row.append(val)

            # Color coding based on quality warnings
            doi = row.get("DOI", "")
            if col in warnings.get(doi, {}):
                color_row.append([1.0, 0.95, 0.9])  # light orange
            else:
                color_row.append([1, 1, 1])  # white
        cell_text.append(text_row)
        cell_colors.append(color_row)

    table = ax.table(
        cellText=cell_text,
        colLabels=columns,
        cellColours=cell_colors,
        loc='center',
    )
    table.auto_set_font_size(False)
    table.set_fontsize(8)
    table.scale(1.2, 1.5)

    plt.tight_layout()

    output = io.BytesIO()
    fig.savefig(output, format='png', dpi=150, bbox_inches='tight')
    plt.close(fig)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="image/png",
        headers={"Content-Disposition": "attachment; filename=comparison.png"},
    )


def _export_svg(data: dict, warnings: dict) -> StreamingResponse:
    """Export as SVG image using matplotlib (GAP-007)."""
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except ImportError:
        raise HTTPException(status_code=500, detail="matplotlib not installed")

    columns = data.get("columns", [])
    rows = data.get("rows", [])

    if not rows:
        raise HTTPException(status_code=404, detail="No data to export")

    fig, ax = plt.subplots(figsize=(max(8, len(columns) * 2), max(4, len(rows) * 0.5 + 1)))
    ax.axis('off')

    # Prepare table data
    cell_text = []
    cell_colors = []
    for row in rows:
        text_row = []
        color_row = []
        for col in columns:
            val = str(row.get(col, ""))
            if len(val) > 30:
                val = val[:28] + ".."
            text_row.append(val)

            # Color coding based on quality warnings
            doi = row.get("DOI", "")
            if col in warnings.get(doi, {}):
                color_row.append([1.0, 0.95, 0.9])  # light orange
            else:
                color_row.append([1, 1, 1])  # white
        cell_text.append(text_row)
        cell_colors.append(color_row)

    table = ax.table(
        cellText=cell_text,
        colLabels=columns,
        cellColours=cell_colors,
        loc='center',
    )
    table.auto_set_font_size(False)
    table.set_fontsize(8)
    table.scale(1.2, 1.5)

    plt.tight_layout()

    output = io.BytesIO()
    fig.savefig(output, format='svg', bbox_inches='tight')
    plt.close(fig)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="image/svg+xml",
        headers={"Content-Disposition": "attachment; filename=comparison.svg"},
    )


def _latex_escape(text: str) -> str:
    """Escape special LaTeX characters."""
    replacements = {
        '&': r'\&',
        '%': r'\%',
        '$': r'\$',
        '#': r'\#',
        '_': r'\_',
        '{': r'\{',
        '}': r'\}',
        '~': r'\textasciitilde{}',
        '^': r'\^{}',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


# ============================================================
# V1 backward-compat routes (migrated from main.py)
# ============================================================

@router.get("/export/excel")
async def v1_export_excel(dois: str = None):
    """V1 compat: Export extracted papers to Excel.

    Prefer POST /api/project/{id}/compare/export for V2.
    """
    import datetime as _dt
    from core.exporter import exporter

    db = SessionLocal()
    try:
        from core.database import Literature

        if not dois or dois == "all":
            papers = db.query(Literature).filter(Literature.is_extracted == True).all()
            doi_list = [p.doi for p in papers]
        else:
            doi_list = [d.strip() for d in dois.split(',') if d.strip()]

        if not doi_list:
            raise HTTPException(status_code=400, detail="No extracted papers found to export.")

        output = exporter.export_to_excel(db, doi_list)
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=SIA_Export_All_{_dt.datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"}
        )
    finally:
        db.close()
