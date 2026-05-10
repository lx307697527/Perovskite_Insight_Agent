import httpx
import os
from typing import List, Dict
from .translator import translator

class PaperCrawler:
    """
    Handles PDF and SI discovery and downloading
    """
    def __init__(self, download_dir: str):
        self.download_dir = download_dir
        if not os.path.exists(download_dir):
            os.makedirs(download_dir)
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1"
        }

    async def search_semantic_scholar(self, query: str) -> List[Dict]:
        """
        Search using Semantic Scholar API (Best for Semantic/Natural Language)
        """
        search_q = await translator.translate_query(query)
        print(f"DEBUG: Starting SS search for: {search_q}")
        # Added abstract to fields
        url = f"https://api.semanticscholar.org/graph/v1/paper/search?query={search_q}&limit=10&fields=title,authors,year,venue,externalIds,relevanceScore,abstract"
        async with httpx.AsyncClient(timeout=10.0, headers=self.headers) as client:
            try:
                resp = await client.get(url, timeout=5.0)
                data = resp.json()
                results = []
                for work in data.get('data', []):
                    ext_ids = work.get('externalIds', {})
                    doi = ext_ids.get('DOI')
                    if not doi: continue
                    
                    results.append({
                        "doi": doi,
                        "title": work.get('title'),
                        "journal": work.get('venue') or 'Unknown',
                        "year": work.get('year'),
                        "authors": ", ".join([a.get('name', '') for a in work.get('authors', [])[:3]]),
                        "relevance": min(99, int(work.get('relevanceScore', 0) * 100)) if work.get('relevanceScore') else 85,
                        "abstract": work.get('abstract'),
                        "cached": False,
                        "source": "Semantic Scholar"
                    })
                print(f"DEBUG: SS search success, found {len(results)} results")
                return results
            except Exception as e:
                print(f"DEBUG: SS Search error: {e}")
                return []

    def _reconstruct_abstract(self, inverted_index: Dict) -> str:
        """Reconstructs abstract text from OpenAlex's inverted index format"""
        if not inverted_index: return ""
        try:
            # Create a list of (index, word) pairs
            word_positions = []
            for word, positions in inverted_index.items():
                for pos in positions:
                    word_positions.append((pos, word))
            # Sort by position and join
            word_positions.sort()
            return " ".join([w[1] for w in word_positions])
        except:
            return ""

    async def search_openalex(self, query: str) -> List[Dict]:
        """
        Real-time search using OpenAlex API (Best for coverage)
        """
        search_q = await translator.translate_query(query)
        print(f"DEBUG: Starting OpenAlex search for: {search_q}")
        url = f"https://api.openalex.org/works?search={search_q}&sort=relevance_score:desc"
        async with httpx.AsyncClient(timeout=10.0, headers=self.headers) as client:
            try:
                resp = await client.get(url, timeout=5.0)
                data = resp.json()
                results = []
                for work in data.get('results', [])[:10]:
                    doi = work.get('doi', '').replace('https://doi.org/', '')
                    if not doi: continue
                    
                    # Normalize relevance
                    raw_score = work.get('relevance_score', 0)
                    normalized_relevance = min(99, int(raw_score)) if raw_score > 1 else int(raw_score * 100)

                    results.append({
                        "doi": doi,
                        "title": work.get('display_name'),
                        "journal": work.get('primary_location', {}).get('source', {}).get('display_name', 'Unknown'),
                        "year": work.get('publication_year'),
                        "authors": ", ".join([a.get('author', {}).get('display_name', '') for a in work.get('authorships', [])[:3]]),
                        "relevance": normalized_relevance,
                        "abstract": self._reconstruct_abstract(work.get('abstract_inverted_index')),
                        "cached": False,
                        "source": "OpenAlex"
                    })
                print(f"DEBUG: OpenAlex search success, found {len(results)} results")
                return results
            except Exception as e:
                print(f"DEBUG: OpenAlex Search error: {e}")
                return []

    async def search_papers_dual_engine(self, query: str) -> List[Dict]:
        """
        Concurrent dual-engine search with merging and de-duplication
        """
        import asyncio
        print(f"DEBUG: Dual-engine search triggered for: {query}")
        
        # Wrap each call to ensure they don't block each other
        tasks = [
            self.search_semantic_scholar(query),
            self.search_openalex(query)
        ]
        
        # Use return_exceptions=True to get what we can
        results_group = await asyncio.gather(*tasks, return_exceptions=True)
        
        ss_results = results_group[0] if not isinstance(results_group[0], Exception) else []
        oa_results = results_group[1] if not isinstance(results_group[1], Exception) else []
        
        # Merge and de-duplicate by DOI
        merged = {}
        for r in ss_results + oa_results:
            doi = r['doi'].lower()
            if doi not in merged:
                merged[doi] = r
            else:
                # If both found it, mark as high quality
                merged[doi]['relevance'] = min(100, merged[doi]['relevance'] + 5)
        
        # Sort by relevance
        print(f"DEBUG: Merged {len(merged)} unique results")
        return sorted(merged.values(), key=lambda x: x['relevance'], reverse=True)

    async def get_paper_by_doi(self, doi: str) -> Dict:
        """
        Fetches basic paper info for a single DOI from Semantic Scholar
        """
        url = f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}?fields=title,authors,year,venue,abstract"
        async with httpx.AsyncClient(timeout=10.0, headers=self.headers) as client:
            try:
                resp = await client.get(url, timeout=5.0)
                if resp.status_code != 200: return None
                work = resp.json()
                return {
                    "doi": doi,
                    "title": work.get('title'),
                    "journal": work.get('venue') or 'Unknown',
                    "year": work.get('year'),
                    "authors": ", ".join([a.get('name', '') for a in work.get('authors', [])[:3]]),
                    "abstract": work.get('abstract')
                }
            except Exception as e:
                print(f"DEBUG: Fetch paper by DOI error: {e}")
                return None

    async def get_pdf_links(self, doi: str) -> Dict[str, str]:
        """
        Discovery of PDF and SI links using OpenAlex API
        """
        print(f"DEBUG: Resolving PDF links for DOI: {doi}")
        url = f"https://api.openalex.org/works/https://doi.org/{doi}"
        
        async with httpx.AsyncClient(timeout=10.0, headers=self.headers) as client:
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    # Try to get the best OA location
                    best_oa = data.get('best_oa_location', {})
                    if best_oa and best_oa.get('pdf_url'):
                        print(f"DEBUG: Found PDF via OpenAlex: {best_oa['pdf_url']}")
                        return {
                            "main": best_oa['pdf_url'],
                            "si": [] # OpenAlex doesn't always provide SI URLs directly
                        }
                
                # Fallback heuristic for common publishers if OpenAlex fails
                print(f"DEBUG: OpenAlex resolution failed, using heuristic fallback")
                if "10.1126" in doi: # Science
                    doi_suffix = doi.split('/')[-1]
                    return {
                        "main": f"https://www.science.org/doi/pdf/{doi}",
                        "si": [f"https://www.science.org/doi/suppl/{doi}/suppl_file/{doi_suffix}_sm.pdf"]
                    }
                elif "10.1038" in doi: # Nature
                    doi_suffix = doi.split('/')[-1]
                    return {
                        "main": f"https://www.nature.com/articles/{doi_suffix}.pdf",
                        "si": [f"https://static-content.springer.com/esm/art%3A10.1038%2F{doi_suffix}/MediaObjects/{doi_suffix}_MOESM1_ESM.pdf"]
                    }
                
                # ACS Publications (American Chemical Society) - common for Perovskite
                if "10.1021" in doi:
                    doi_suffix = doi.split('/')[-1]
                    return {
                        "main": f"https://pubs.acs.org/doi/pdf/{doi}",
                        "si": [f"https://pubs.acs.org/doi/suppl/{doi}/suppl_file/{doi_suffix}_si_001.pdf"]
                    }
                
                # Royal Society of Chemistry (RSC)
                elif "10.1039" in doi:
                    doi_suffix = doi.split('/')[-1]
                    return {
                        "main": f"https://pubs.rsc.org/en/content/articlepdf/{paper_info.get('year', 2024)}/ee/{doi_suffix.lower()}",
                        "si": []
                    }

                # Wiley
                elif "10.1002" in doi:
                    return {
                        "main": f"https://onlinelibrary.wiley.com/doi/pdf/{doi}",
                        "si": []
                    }
                
                # Ultimate fallback to DOI.org (often lands on publisher landing page)
                return {
                    "main": f"https://doi.org/{doi}",
                    "si": []
                }
            except Exception as e:
                print(f"DEBUG: PDF resolution error: {e}")
                return {"main": f"https://doi.org/{doi}", "si": []}

    async def download_file(self, url: str, filename: str) -> tuple[str, str]:
        """
        Downloads a file to the local storage using streaming to handle large files
        Returns: (local_path, error_message)
        """
        local_path = os.path.join(self.download_dir, filename)

        # In a real app, handle authentication/cookies for publishers
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=self.headers) as client:
            try:
                # Use streaming to avoid loading entire file into memory
                async with client.stream("GET", url, follow_redirects=True) as response:
                    response.raise_for_status()

                    with open(local_path, "wb") as f:
                        # Stream in 8KB chunks
                        async for chunk in response.aiter_bytes(chunk_size=8192):
                            f.write(chunk)

                return local_path, ""
            except httpx.HTTPStatusError as e:
                error_msg = f"HTTP {e.response.status_code}: {e.response.reason_phrase}"
                print(f"Download error: {error_msg}")
                return "", error_msg
            except Exception as e:
                error_msg = str(e)
                print(f"Download error: {error_msg}")
                return "", error_msg

    def clear_downloads(self):
        """Removes all downloaded PDF files"""
        if os.path.exists(self.download_dir):
            for f in os.listdir(self.download_dir):
                file_path = os.path.join(self.download_dir, f)
                try:
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                except Exception as e:
                    print(f"Error clearing file {file_path}: {e}")

# Initialize with a local path
def get_crawler():
    base_dir = os.environ.get('APPDATA', os.path.expanduser('~'))
    download_dir = os.path.join(base_dir, "SIA", "downloads")
    return PaperCrawler(download_dir)

crawler = get_crawler()
