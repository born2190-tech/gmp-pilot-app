"""Helper to serve scan bytes as a base64 JSON payload.

Download managers and browser PDF extensions hijack responses that look like
a downloadable file (``Content-Type: application/pdf`` + ``Content-Disposition``),
which leaves the page's own ``fetch`` with an empty body and PDF.js raising
"The PDF file is empty, i.e. its size is zero bytes." Wrapping the bytes in a
JSON object sidesteps that entirely — an XHR/fetch JSON response is never
treated as a file.
"""
from __future__ import annotations

import base64

from fastapi.responses import JSONResponse


def scan_bytes_as_json(blob: bytes, mime_type: str) -> JSONResponse:
    return JSONResponse(
        {
            "mime_type": mime_type or "application/pdf",
            "data_base64": base64.b64encode(blob).decode("ascii"),
        }
    )
