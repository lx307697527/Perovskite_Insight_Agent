import os
import asyncio
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
import multiprocessing

# Try to import PDF parsing libraries
try:
    from docling.document_converter import DocumentConverter
    # Docling C++ extension (docling_parse) crashes on Windows if the user path contains non-ASCII characters (like "星")
    # Disabling docling backend for now to prevent hard crashes and rely on pdfplumber/PyPDF2.
    DOCLING_AVAILABLE = False
except Exception as e:
    print(f"Docling not available: {e}")
    DOCLING_AVAILABLE = False

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False

try:
    import PyPDF2
    PYPDF2_AVAILABLE = True
except ImportError:
    PYPDF2_AVAILABLE = False

# OCR Engine availability flags
PADDLEOCR_AVAILABLE = False
RAPIDOCR_AVAILABLE = False

# Try to import PaddleOCR (preferred for Chinese/multilingual)
try:
    from paddleocr import PaddleOCR
    PADDLEOCR_AVAILABLE = True
    print("OCR Engine: PaddleOCR available")
except ImportError:
    print("OCR Engine: PaddleOCR not installed (pip install paddleocr paddlepaddle)")

# Try to import RapidOCR (fallback)
try:
    from rapidocr_onnxruntime import RapidOCR
    RAPIDOCR_AVAILABLE = True
    print("OCR Engine: RapidOCR available")
except ImportError:
    print("OCR Engine: RapidOCR not installed")

# Global OCR instance (lazy initialization)
_paddle_ocr = None
_rapid_ocr = None


def _get_paddle_ocr():
    """Get or create PaddleOCR instance (lazy initialization)"""
    global _paddle_ocr
    if _paddle_ocr is None and PADDLEOCR_AVAILABLE:
        try:
            # use_angle_cls=True for better handling of rotated text
            # lang='en' for English, 'ch' for Chinese, 'latin' for multilingual
            _paddle_ocr = PaddleOCR(
                use_angle_cls=True,
                lang='en',  # Scientific papers are mostly English
                show_log=False,
                use_gpu=False  # CPU mode for compatibility
            )
            print("OCR: PaddleOCR initialized successfully")
        except Exception as e:
            print(f"OCR: PaddleOCR init failed: {e}")
            _paddle_ocr = None
    return _paddle_ocr


def _get_rapid_ocr():
    """Get or create RapidOCR instance (lazy initialization)"""
    global _rapid_ocr
    if _rapid_ocr is None and RAPIDOCR_AVAILABLE:
        try:
            _rapid_ocr = RapidOCR()
            print("OCR: RapidOCR initialized successfully")
        except Exception as e:
            print(f"OCR: RapidOCR init failed: {e}")
            _rapid_ocr = None
    return _rapid_ocr


def _ocr_image(img_array) -> Optional[str]:
    """
    Run OCR on an image array using available OCR engine.
    Priority: PaddleOCR > RapidOCR
    """
    # Try PaddleOCR first (better for complex layouts)
    paddle_ocr = _get_paddle_ocr()
    if paddle_ocr is not None:
        try:
            result = paddle_ocr.ocr(img_array, cls=True)
            if result and result[0]:
                # PaddleOCR returns list of [box, (text, confidence)]
                lines = []
                for line in result[0]:
                    if line and len(line) >= 2:
                        text = line[1][0] if isinstance(line[1], tuple) else str(line[1])
                        lines.append(text)
                return "\n".join(lines)
        except Exception as e:
            print(f"PaddleOCR error: {e}")

    # Fallback to RapidOCR
    rapid_ocr = _get_rapid_ocr()
    if rapid_ocr is not None:
        try:
            result, _ = rapid_ocr(img_array)
            if result:
                return "\n".join([line[1] for line in result])
        except Exception as e:
            print(f"RapidOCR error: {e}")

    return None

# Global thread pool for PDF processing
MAX_WORKERS = min(4, multiprocessing.cpu_count())
pdf_executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)

class PDFProcessor:
    """
    Handles PDF to Markdown conversion with multiple backend support
    Priority: Docling > pdfplumber > PyPDF2
    """
    def __init__(self):
        self.converter = None
        if DOCLING_AVAILABLE:
            try:
                self.converter = DocumentConverter()
                print("PDF Processor: Using Docling backend")
            except Exception as e:
                print(f"Docling init failed: {e}")
                self.converter = None

        if not self.converter and PDFPLUMBER_AVAILABLE:
            print("PDF Processor: Using pdfplumber backend")
        elif not self.converter and PYPDF2_AVAILABLE:
            print("PDF Processor: Using PyPDF2 backend")

    async def convert_to_markdown(self, file_path: str) -> Optional[str]:
        """
        Converts a PDF file to a structured Markdown string.
        Uses thread pool to avoid blocking the event loop.
        """
        if not os.path.exists(file_path):
            print(f"Error: File not found {file_path}")
            return None

        # Try Docling first
        if self.converter:
            try:
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    pdf_executor,
                    self.converter.convert,
                    file_path
                )
                return result.document.export_to_markdown()
            except Exception as e:
                print(f"Docling error: {e}, trying fallback...")

        # Fallback to PyMuPDF + RapidOCR
        try:
            return await self._parse_with_pymupdf_ocr(file_path)
        except Exception as e:
            print(f"PyMuPDF/OCR error: {e}")

        # Fallback to pdfplumber
        if PDFPLUMBER_AVAILABLE:
            try:
                return await self._parse_with_pdfplumber(file_path)
            except Exception as e:
                print(f"pdfplumber error: {e}")

        # Fallback to PyPDF2
        if PYPDF2_AVAILABLE:
            try:
                return await self._parse_with_pypdf2(file_path)
            except Exception as e:
                print(f"PyPDF2 error: {e}")

        print("Warning: No PDF parser available")
        return None

    async def _parse_with_pymupdf_ocr(self, file_path: str) -> Optional[str]:
        """Parse PDF using PyMuPDF, falling back to OCR for scanned pages.
        OCR Engine Priority: PaddleOCR > RapidOCR
        """
        def _extract():
            import fitz
            import numpy as np

            text_parts = []

            with fitz.open(file_path) as doc:
                for i, page in enumerate(doc):
                    # Try native text extraction first
                    text = page.get_text()

                    if text and len(text.strip()) > 50:
                        text_parts.append(f"## Page {i+1}\n\n{text}\n")
                    else:
                        # Scanned page or image-based page, fallback to OCR
                        print(f"DEBUG: Page {i+1} has no native text, running OCR...")
                        pix = page.get_pixmap(dpi=150)

                        # Convert pixmap to numpy array (RGB)
                        if pix.n - pix.alpha < 4:      # GRAY or RGB
                            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                        else:                          # CMYK: convert to RGB first
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)

                        # If alpha channel exists, drop it
                        if pix.alpha:
                            img = img[:, :, :3]

                        # Use unified OCR helper (PaddleOCR > RapidOCR)
                        page_text = _ocr_image(img)
                        if page_text:
                            text_parts.append(f"## Page {i+1} (OCR)\n\n{page_text}\n")
                        else:
                            print(f"DEBUG: Page {i+1} OCR returned no text")
                            text_parts.append(f"## Page {i+1}\n\n[OCR failed to extract text]\n")

            return "\n".join(text_parts)

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(pdf_executor, _extract)

    async def _parse_with_pdfplumber(self, file_path: str) -> Optional[str]:
        """Parse PDF using pdfplumber"""
        def _extract():
            text_parts = []
            with pdfplumber.open(file_path) as pdf:
                for i, page in enumerate(pdf.pages):
                    text = page.extract_text()
                    if text:
                        text_parts.append(f"## Page {i+1}\n\n{text}\n")
                    # Also extract tables
                    tables = page.extract_tables()
                    for j, table in enumerate(tables):
                        if table:
                            text_parts.append(f"\n### Table {j+1}\n")
                            for row in table:
                                cells = [str(cell) if cell else "" for cell in row]
                                text_parts.append("| " + " | ".join(cells) + " |\n")
            return "".join(text_parts)

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(pdf_executor, _extract)

    async def _parse_with_pypdf2(self, file_path: str) -> Optional[str]:
        """Parse PDF using PyPDF2"""
        def _extract():
            text_parts = []
            with open(file_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                for i, page in enumerate(reader.pages):
                    text = page.extract_text()
                    if text:
                        text_parts.append(f"## Page {i+1}\n\n{text}\n")
            return "".join(text_parts)

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(pdf_executor, _extract)

pdf_processor = PDFProcessor()
