"""
HTTP Function — /api/process

Receives an uploaded bank statement, stages it to private blob storage,
runs Azure Document Intelligence, applies the extraction + filename logic,
and returns the new filename plus a short-lived download URL.

This is a managed function inside Azure Static Web Apps, so it is
automatically protected by the same Azure AD login that guards the
frontend. The signed-in user's identity arrives in the
'x-ms-client-principal' header.
"""

import base64
import json
import logging
import os
import sys

import azure.functions as func

# Make the shared extraction code importable
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", "shared"))

from doc_intelligence import analyze_from_url
from blob_storage import upload_for_staging, save_renamed
from extractor import extract_from_response
from filename_builder import build_filename

logger = logging.getLogger("api.process")

app = func.FunctionApp()


def _get_user(req: func.HttpRequest) -> str:
    """Extract the signed-in user's name from the SWA auth header."""
    header = req.headers.get("x-ms-client-principal")
    if not header:
        return "unknown"
    try:
        decoded = base64.b64decode(header).decode("utf-8")
        principal = json.loads(decoded)
        return principal.get("userDetails", "unknown")
    except Exception:
        return "unknown"


@app.route(route="process", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def process(req: func.HttpRequest) -> func.HttpResponse:
    """Process a single uploaded bank statement."""
    user = _get_user(req)
    logger.info("Process request from user: %s", user)

    # ── Read the uploaded file from the multipart form ───────
    try:
        files = req.files.values()
        uploaded = next(iter(files), None)
        if uploaded is None:
            return _json_error("No file uploaded.", 400)

        filename = uploaded.filename
        file_bytes = uploaded.stream.read()
        content_type = uploaded.mimetype or "application/pdf"
    except Exception as exc:
        logger.exception("Failed to read uploaded file")
        return _json_error(f"Could not read uploaded file: {exc}", 400)

    if not file_bytes:
        return _json_error("Uploaded file is empty.", 400)

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "pdf"

    # ── Stage → analyse → extract → rename ───────────────────
    try:
        # 1. Stage to private blob, get a SAS URL for DI to read
        staged_blob, staged_url = upload_for_staging(
            file_bytes=file_bytes,
            original_filename=filename,
            content_type=content_type,
        )

        # 2. Document Intelligence reads from the blob
        di_response = analyze_from_url(staged_url)

        # 3. Extract fields
        fields = extract_from_response(
            di_response, original_filename=filename
        )

        # 4. Build filename or flag for review
        if fields.is_complete():
            new_filename = build_filename(fields, extension=ext)
            download_url = save_renamed(
                source_blob_name=staged_blob,
                new_filename=new_filename,
            )
            result = {
                "status": "renamed",
                "originalName": filename,
                "newName": new_filename,
                "downloadUrl": download_url,
                "fields": {
                    "bank": fields.bank_code,
                    "product": fields.product_name,
                    "accountType": fields.type_code,
                    "balance": fields.balance,
                    "last4": fields.account_last4,
                    "periodStart": str(fields.period_start)
                    if fields.period_start else None,
                    "periodEnd": str(fields.period_end)
                    if fields.period_end else None,
                    "accountHolder": fields.account_holder,
                },
            }
        else:
            notes = fields.confidence_notes or ["Extraction incomplete"]
            result = {
                "status": "needs_review",
                "originalName": filename,
                "notes": notes,
                "fields": {
                    "bank": fields.bank_code,
                    "accountType": fields.type_code,
                    "balance": fields.balance,
                    "last4": fields.account_last4,
                },
            }

        return func.HttpResponse(
            json.dumps(result),
            mimetype="application/json",
            status_code=200,
        )

    except Exception as exc:
        logger.exception("Processing failed for %s", filename)
        return _json_error(f"Processing failed: {exc}", 500)


def _json_error(message: str, status: int) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"status": "error", "message": message}),
        mimetype="application/json",
        status_code=status,
    )
