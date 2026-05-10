"""
Dual-engine search module for SIA V2.1.

Separates search logic from crawler.py for cleaner architecture.
Uses Semantic Scholar + OpenAlex with merge and de-duplication.
Chinese queries are auto-translated via translator.py.
"""

import httpx
import logging
from typing import Optional

from .translator import translator

logger = logging.getLogger(__name__)

# Shared HTTP headers
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
}


async def search_semantic_scholar(query: str) -> list[dict]:
    """Search Semantic Scholar API."""
    search_q = await translator.translate_query(query)
    url = (
        f"https://api.semanticscholar.org/graph/v1/paper/search"
        f"?query={search_q}&limit=10"
        f"&fields=title,authors,year,venue,externalIds,relevanceScore,abstract"
    )

    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_HEADERS) as client:
            resp = await client.get(url, timeout=8.0)
            if resp.status_code != 200:
                logger.warning(f"SS API returned {resp.status_code}")
                return []

            data = resp.json()
            results = []
            for paper in data.get("data", []):
                eid = paper.get("externalIds", {})
                doi = eid.get("DOI")
                if not doi:
                    continue

                authors_list = paper.get("authors", [])
                authors = ", ".join(a.get("name", "") for a in authors_list[:3])
                if len(authors_list) > 3:
                    authors += " et al."

                results.append({
                    "doi": doi,
                    "title": paper.get("title", "Unknown"),
                    "journal": paper.get("venue", ""),
                    "year": paper.get("year"),
                    "authors": authors,
                    "abstract": paper.get("abstract"),
                    "relevance": paper.get("relevanceScore", 0),
                    "source": "semantic_scholar",
                })
            return results

    except (httpx.TimeoutException, httpx.ConnectError) as e:
        logger.warning(f"SS search failed: {e}")
        return []


async def search_openalex(query: str) -> list[dict]:
    """Search OpenAlex API."""
    search_q = await translator.translate_query(query)
    url = (
        f"https://api.openalex.org/works"
        f"?search={search_q}&per_page=10"
        f"&sort=relevance_score:desc"
    )

    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_HEADERS) as client:
            resp = await client.get(url, timeout=8.0)
            if resp.status_code != 200:
                logger.warning(f"OpenAlex API returned {resp.status_code}")
                return []

            data = resp.json()
            results = []
            for work in data.get("results", []):
                doi = work.get("doi", "")
                if doi and doi.startswith("https://doi.org/"):
                    doi = doi.replace("https://doi.org/", "")

                if not doi:
                    continue

                authorships = work.get("authorships", [])
                authors = ", ".join(
                    a.get("author", {}).get("display_name", "")
                    for a in authorships[:3]
                )
                if len(authorships) > 3:
                    authors += " et al."

                results.append({
                    "doi": doi,
                    "title": work.get("title", "Unknown"),
                    "journal": work.get("primary_location", {}).get("source", {}).get("display_name", "") if work.get("primary_location") else "",
                    "year": work.get("publication_year"),
                    "authors": authors,
                    "abstract": _reconstruct_abstract(work.get("abstract_inverted_index")),
                    "relevance": work.get("relevance_score", 0),
                    "source": "openalex",
                })
            return results

    except (httpx.TimeoutException, httpx.ConnectError) as e:
        logger.warning(f"OpenAlex search failed: {e}")
        return []


async def search_dual_engine(query: str) -> list[dict]:
    """Search both engines and merge/de-duplicate results."""
    import asyncio

    ss_results, oa_results = await asyncio.gather(
        search_semantic_scholar(query),
        search_openalex(query),
        return_exceptions=True,
    )

    if isinstance(ss_results, Exception):
        logger.error(f"SS search error: {ss_results}")
        ss_results = []
    if isinstance(oa_results, Exception):
        logger.error(f"OpenAlex search error: {oa_results}")
        oa_results = []

    # Merge and de-duplicate by DOI
    seen_dois = set()
    merged = []

    # SS results first (usually better relevance)
    for r in ss_results:
        doi = r.get("doi", "")
        if doi not in seen_dois:
            seen_dois.add(doi)
            merged.append(r)

    # Then OA results
    for r in oa_results:
        doi = r.get("doi", "")
        if doi not in seen_dois:
            seen_dois.add(doi)
            merged.append(r)

    # Sort by relevance
    merged.sort(key=lambda x: x.get("relevance", 0), reverse=True)

    return merged


async def get_paper_metadata(doi: str) -> Optional[dict]:
    """Fetch paper metadata by DOI from Semantic Scholar."""
    url = (
        f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}"
        f"?fields=title,authors,year,venue,abstract,externalIds"
    )

    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_HEADERS) as client:
            resp = await client.get(url, timeout=8.0)
            if resp.status_code != 200:
                return None

            data = resp.json()
            authors_list = data.get("authors", [])
            authors = ", ".join(a.get("name", "") for a in authors_list[:3])
            if len(authors_list) > 3:
                authors += " et al."

            return {
                "doi": doi,
                "title": data.get("title", ""),
                "journal": data.get("venue", ""),
                "year": data.get("year"),
                "authors": authors,
                "abstract": data.get("abstract"),
            }
    except Exception as e:
        logger.warning(f"Failed to fetch metadata for {doi}: {e}")
        return None


def _reconstruct_abstract(inverted_index: Optional[dict]) -> Optional[str]:
    """Reconstruct abstract from OpenAlex inverted index format."""
    if not inverted_index:
        return None

    word_positions: list[tuple[int, str]] = []
    for word, positions in inverted_index.items():
        for pos in positions:
            word_positions.append((pos, word))

    word_positions.sort(key=lambda x: x[0])
    return " ".join(w for _, w in word_positions)
