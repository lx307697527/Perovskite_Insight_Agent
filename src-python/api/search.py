"""Search API routes — dual-engine search (Semantic Scholar + OpenAlex)."""

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
async def search_papers(query: str, year_start: int = None, year_end: int = None, min_pce: float = None):
    """Dual-engine search: SS + OpenAlex with merge and de-duplication."""
    # TODO: Phase 1 — delegate to core/search.py (extracted from crawler)
    from core.crawler import crawler
    from core.translator import translator
    import datetime
    import json

    warning = None
    # Input validation
    if len(query) > 500:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Query too long (max 500 characters)")

    enhanced_query = query
    if year_start and year_end:
        enhanced_query += f" from {year_start} to {year_end}"
    if min_pce:
        enhanced_query += f" PCE over {min_pce}%"

    results = await crawler.search_papers_dual_engine(enhanced_query)

    if year_start or year_end:
        results = [r for r in results if
                   (not year_start or (r.get('year') and r['year'] >= year_start)) and
                   (not year_end or (r.get('year') and r['year'] <= year_end))]

    return {
        "success": True,
        "data": {
            "results": results,
            "warning": warning
        }
    }
