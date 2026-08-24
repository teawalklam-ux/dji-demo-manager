#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import mimetypes
import os
import shutil
import signal
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Any


LOGGER = logging.getLogger("return-photo-archive")


class ApiError(RuntimeError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Config:
    supabase_url: str
    publishable_key: str
    archive_token: str
    archive_root: Path
    state_db: Path
    worker_id: str
    poll_seconds: int
    claim_limit: int
    max_file_bytes: int
    allowed_origin: str
    view_bind: str
    view_port: int
    tls_cert_file: Path | None
    tls_key_file: Path | None
    require_tls: bool

    @classmethod
    def from_env(cls) -> "Config":
        required = {
            "SUPABASE_URL": os.environ.get("SUPABASE_URL", "").rstrip("/"),
            "SUPABASE_PUBLISHABLE_KEY": os.environ.get("SUPABASE_PUBLISHABLE_KEY", ""),
            "NAS_ARCHIVE_TOKEN": os.environ.get("NAS_ARCHIVE_TOKEN", ""),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")

        archive_root = Path(os.environ.get("ARCHIVE_ROOT", "/archive")).resolve()
        state_db = Path(os.environ.get("STATE_DB", "/data/archive.db")).resolve()
        tls_cert = os.environ.get("TLS_CERT_FILE", "").strip()
        tls_key = os.environ.get("TLS_KEY_FILE", "").strip()
        require_tls = os.environ.get("REQUIRE_TLS", "true").lower() in {"1", "true", "yes"}
        if bool(tls_cert) != bool(tls_key):
            raise RuntimeError("TLS_CERT_FILE and TLS_KEY_FILE must be configured together")
        if require_tls and not tls_cert:
            raise RuntimeError("TLS is required; configure a certificate or terminate HTTPS at a reverse proxy and set REQUIRE_TLS=false")

        return cls(
            supabase_url=required["SUPABASE_URL"],
            publishable_key=required["SUPABASE_PUBLISHABLE_KEY"],
            archive_token=required["NAS_ARCHIVE_TOKEN"],
            archive_root=archive_root,
            state_db=state_db,
            worker_id=os.environ.get("WORKER_ID", "ugreen-dxp4800-plus")[:128],
            poll_seconds=max(15, int(os.environ.get("POLL_SECONDS", "60"))),
            claim_limit=min(20, max(1, int(os.environ.get("CLAIM_LIMIT", "5")))),
            max_file_bytes=max(1_048_576, int(os.environ.get("MAX_FILE_BYTES", "6291456"))),
            allowed_origin=os.environ.get("ALLOWED_ORIGIN", "https://teawalklam-ux.github.io").rstrip("/"),
            view_bind=os.environ.get("VIEW_BIND", "0.0.0.0"),
            view_port=int(os.environ.get("VIEW_PORT", "8787")),
            tls_cert_file=Path(tls_cert).resolve() if tls_cert else None,
            tls_key_file=Path(tls_key).resolve() if tls_key else None,
            require_tls=require_tls,
        )

    @property
    def archive_api_url(self) -> str:
        return f"{self.supabase_url}/functions/v1/nas-photo-archive"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_archive_destination(root: Path, relative_path: str) -> Path:
    if not relative_path or "\\" in relative_path or "\x00" in relative_path:
        raise ValueError("Unsafe archive path")
    pure = PurePosixPath(relative_path)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError("Unsafe archive path")
    destination = (root / Path(*pure.parts)).resolve()
    try:
        destination.relative_to(root.resolve())
    except ValueError as error:
        raise ValueError("Archive path escapes configured root") from error
    return destination


def validate_supabase_restore_location(bucket_id: str, storage_path: str) -> tuple[str, str]:
    if bucket_id != "return-photos" or not storage_path or len(storage_path) > 1024:
        raise ValueError("Unsafe Supabase restore location")
    if "\\" in storage_path or "\x00" in storage_path:
        raise ValueError("Unsafe Supabase restore location")
    pure = PurePosixPath(storage_path)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError("Unsafe Supabase restore location")
    return bucket_id, storage_path


def sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def bounded_text(value: object, max_length: int) -> str:
    if value is None:
        return ""
    return str(value).strip()[:max_length]


def fsync_directory(path: Path) -> None:
    try:
        directory_fd = os.open(path, os.O_RDONLY)
    except OSError:
        if os.name == "nt":
            return
        raise
    try:
        os.fsync(directory_fd)
    except OSError:
        if os.name != "nt":
            raise
    finally:
        os.close(directory_fd)


def write_json_atomically(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
    encoded = (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    try:
        with temporary.open("xb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


class StateStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.Lock()
        self._initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS archives (
                    photo_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    lease_token TEXT NOT NULL,
                    relative_path TEXT NOT NULL UNIQUE,
                    size_bytes INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    source_bucket_id TEXT NOT NULL,
                    source_storage_path TEXT NOT NULL,
                    captured_at TEXT,
                    borrow_record_id TEXT,
                    request_id TEXT,
                    request_number TEXT,
                    item_id TEXT,
                    item_name TEXT,
                    item_model TEXT,
                    serial_number_last4 TEXT,
                    status TEXT NOT NULL,
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    server_verified_at TEXT
                )
                """
            )
            existing_columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(archives)")
            }
            metadata_columns = {
                "captured_at": "TEXT",
                "source_bucket_id": "TEXT",
                "source_storage_path": "TEXT",
                "borrow_record_id": "TEXT",
                "request_id": "TEXT",
                "request_number": "TEXT",
                "item_id": "TEXT",
                "item_name": "TEXT",
                "item_model": "TEXT",
                "serial_number_last4": "TEXT",
            }
            for column, definition in metadata_columns.items():
                if column not in existing_columns:
                    connection.execute(f"ALTER TABLE archives ADD COLUMN {column} {definition}")
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS archives_request_number_idx
                ON archives(request_number COLLATE NOCASE)
                WHERE status = 'verified'
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS archives_item_model_idx
                ON archives(item_model COLLATE NOCASE)
                WHERE status = 'verified'
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS archives_serial_last4_idx
                ON archives(serial_number_last4 COLLATE NOCASE)
                WHERE status = 'verified'
                """
            )

    def save_local_copy(
        self,
        photo_id: str,
        job_id: str,
        lease_token: str,
        relative_path: str,
        size_bytes: int,
        sha256: str,
        source_bucket_id: str,
        source_storage_path: str,
        captured_at: str,
        borrow_record_id: str,
        request_id: str,
        request_number: str,
        item_id: str,
        item_name: str,
        item_model: str,
        serial_number_last4: str | None,
    ) -> None:
        now = utc_now()
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO archives (
                    photo_id, job_id, lease_token, relative_path, size_bytes,
                    sha256, source_bucket_id, source_storage_path,
                    captured_at, borrow_record_id, request_id,
                    request_number, item_id, item_name, item_model,
                    serial_number_last4, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                          'pending_confirmation', ?, ?)
                ON CONFLICT(photo_id) DO UPDATE SET
                    job_id = excluded.job_id,
                    lease_token = excluded.lease_token,
                    relative_path = excluded.relative_path,
                    size_bytes = excluded.size_bytes,
                    sha256 = excluded.sha256,
                    source_bucket_id = excluded.source_bucket_id,
                    source_storage_path = excluded.source_storage_path,
                    captured_at = excluded.captured_at,
                    borrow_record_id = excluded.borrow_record_id,
                    request_id = excluded.request_id,
                    request_number = excluded.request_number,
                    item_id = excluded.item_id,
                    item_name = excluded.item_name,
                    item_model = excluded.item_model,
                    serial_number_last4 = excluded.serial_number_last4,
                    status = 'pending_confirmation',
                    last_error = NULL,
                    updated_at = excluded.updated_at
                """,
                (
                    photo_id,
                    job_id,
                    lease_token,
                    relative_path,
                    size_bytes,
                    sha256,
                    source_bucket_id,
                    source_storage_path,
                    captured_at,
                    borrow_record_id,
                    request_id,
                    request_number,
                    item_id,
                    item_name,
                    item_model,
                    serial_number_last4,
                    now,
                    now,
                ),
            )

    def mark_verified(self, photo_id: str, verified_at: str | None = None) -> None:
        now = verified_at or utc_now()
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                UPDATE archives
                SET status = 'verified', server_verified_at = ?, last_error = NULL, updated_at = ?
                WHERE photo_id = ?
                """,
                (now, now, photo_id),
            )

    def mark_waiting(self, photo_id: str, error: str) -> None:
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                UPDATE archives
                SET status = 'awaiting_reclaim', last_error = ?, updated_at = ?
                WHERE photo_id = ?
                """,
                (error[:2000], utc_now(), photo_id),
            )

    def pending_confirmations(self) -> list[sqlite3.Row]:
        with self.connect() as connection:
            return list(connection.execute(
                "SELECT * FROM archives WHERE status = 'pending_confirmation' ORDER BY updated_at LIMIT 20"
            ))

    def get(self, photo_id: str) -> sqlite3.Row | None:
        with self.connect() as connection:
            return connection.execute(
                "SELECT * FROM archives WHERE photo_id = ?",
                (photo_id,),
            ).fetchone()

    def get_verified(self, photo_id: str) -> sqlite3.Row | None:
        with self.connect() as connection:
            return connection.execute(
                "SELECT * FROM archives WHERE photo_id = ? AND status = 'verified'",
                (photo_id,),
            ).fetchone()

    def search_verified(
        self,
        request_number: str,
        item_model: str,
        serial_number_last4: str,
        limit: int = 50,
    ) -> list[sqlite3.Row]:
        clauses = ["status = 'verified'"]
        parameters: list[object] = []
        if request_number:
            clauses.append("request_number LIKE ? ESCAPE '\\' COLLATE NOCASE")
            parameters.append(f"{escape_like(request_number)}%")
        if item_model:
            clauses.append("item_model LIKE ? ESCAPE '\\' COLLATE NOCASE")
            parameters.append(f"%{escape_like(item_model)}%")
        if serial_number_last4:
            clauses.append("serial_number_last4 = ? COLLATE NOCASE")
            parameters.append(serial_number_last4)
        parameters.append(min(50, max(1, limit)))
        query = (
            "SELECT * FROM archives WHERE "
            + " AND ".join(clauses)
            + " ORDER BY captured_at DESC, updated_at DESC LIMIT ?"
        )
        with self.connect() as connection:
            return list(connection.execute(query, parameters))

    def counts(self) -> dict[str, int]:
        with self.connect() as connection:
            rows = connection.execute("SELECT status, COUNT(*) AS count FROM archives GROUP BY status")
            return {str(row["status"]): int(row["count"]) for row in rows}


class ArchiveAgent:
    def __init__(self, config: Config, store: StateStore, stop_event: threading.Event) -> None:
        self.config = config
        self.store = store
        self.stop_event = stop_event

    def api(self, payload: dict[str, Any], timeout: int = 90) -> dict[str, Any]:
        request = urllib.request.Request(
            self.config.archive_api_url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.config.archive_token}",
                "Content-Type": "application/json",
                "User-Agent": "dji-return-photo-archive/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            response_body = error.read().decode("utf-8", errors="replace")
            try:
                message = json.loads(response_body).get("error", response_body)
            except json.JSONDecodeError:
                message = response_body
            raise ApiError(error.code, str(message)[:2000]) from error

    def confirm(self, row: sqlite3.Row | dict[str, Any]) -> None:
        response = self.api({
            "action": "complete",
            "job_id": row["job_id"],
            "lease_token": row["lease_token"],
            "archive_path": row["relative_path"],
            "size_bytes": int(row["size_bytes"]),
            "sha256": row["sha256"],
        })
        if response.get("status") not in {"verified", "deleting", "deleted"}:
            raise RuntimeError(f"Unexpected verification response: {response}")
        verified_at = utc_now()
        self.write_sidecar(row, verified_at)
        self.store.mark_verified(str(row["photo_id"]), verified_at)
        LOGGER.info("archive_verified photo_id=%s path=%s", row["photo_id"], row["relative_path"])

    def write_sidecar(self, row: sqlite3.Row | dict[str, Any], verified_at: str) -> None:
        photo_path = safe_archive_destination(self.config.archive_root, str(row["relative_path"]))
        sidecar_path = photo_path.with_name(f"{photo_path.name}.metadata.json")
        write_json_atomically(sidecar_path, {
            "schema_version": 2,
            "return_photo_id": row["photo_id"],
            "supabase_restore": {
                "bucket_id": row["source_bucket_id"],
                "storage_path": row["source_storage_path"],
            },
            "borrow_record_id": row["borrow_record_id"],
            "request_id": row["request_id"],
            "request_number": row["request_number"],
            "item_id": row["item_id"],
            "item_name": row["item_name"],
            "item_model": row["item_model"],
            "serial_number_last4": row["serial_number_last4"],
            "captured_at": row["captured_at"],
            "archive_path": row["relative_path"],
            "size_bytes": int(row["size_bytes"]),
            "sha256": row["sha256"],
            "server_verified_at": verified_at,
        })

    def retry_pending_confirmations(self) -> None:
        for row in self.store.pending_confirmations():
            if self.stop_event.is_set():
                return
            try:
                self.confirm(row)
            except ApiError as error:
                if error.status in {HTTPStatus.CONFLICT, HTTPStatus.UNPROCESSABLE_ENTITY}:
                    self.store.mark_waiting(str(row["photo_id"]), str(error))
                else:
                    LOGGER.warning("archive_confirmation_retry_failed photo_id=%s status=%s", row["photo_id"], error.status)
            except Exception as error:  # network failures remain pending for retry
                LOGGER.warning("archive_confirmation_retry_failed photo_id=%s error=%s", row["photo_id"], error)

    def report_failure(self, job: dict[str, Any], message: str) -> None:
        try:
            self.api({
                "action": "fail",
                "job_id": job["job_id"],
                "lease_token": job["lease_token"],
                "error": message[:2000],
            })
        except Exception as error:
            LOGGER.warning("archive_failure_report_failed job_id=%s error=%s", job.get("job_id"), error)

    def download(self, url: str, destination: Path) -> tuple[int, str]:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.part")
        digest = hashlib.sha256()
        size = 0
        request = urllib.request.Request(url, headers={"User-Agent": "dji-return-photo-archive/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open("xb") as output:
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > self.config.max_file_bytes:
                    raise RuntimeError("Source object exceeds configured maximum size")
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.config.max_file_bytes:
                        raise RuntimeError("Source object exceeds configured maximum size")
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if size < 1:
                raise RuntimeError("Source object is empty")
            os.replace(temporary, destination)
            fsync_directory(destination.parent)
        finally:
            temporary.unlink(missing_ok=True)

        readback_size, readback_sha256 = sha256_file(destination)
        if readback_size != size or readback_sha256 != digest.hexdigest():
            raise RuntimeError("NAS read-back verification failed")
        return readback_size, readback_sha256

    def process_job(self, job: dict[str, Any]) -> None:
        photo_id = str(job.get("return_photo_id", ""))
        relative_path = str(job.get("suggested_archive_path", ""))
        destination = safe_archive_destination(self.config.archive_root, relative_path)
        source_bucket_id, source_storage_path = validate_supabase_restore_location(
            bounded_text(job.get("source_bucket_id"), 64),
            bounded_text(job.get("source_storage_path"), 1024),
        )

        try:
            existing = self.store.get(photo_id)
            if existing and destination.exists() and existing["relative_path"] == relative_path:
                size_bytes, sha256 = sha256_file(destination)
            else:
                size_bytes, sha256 = self.download(str(job["download_url"]), destination)

            self.store.save_local_copy(
                photo_id=photo_id,
                job_id=str(job["job_id"]),
                lease_token=str(job["lease_token"]),
                relative_path=relative_path,
                size_bytes=size_bytes,
                sha256=sha256,
                source_bucket_id=source_bucket_id,
                source_storage_path=source_storage_path,
                captured_at=bounded_text(job.get("captured_at"), 64),
                borrow_record_id=bounded_text(job.get("borrow_record_id"), 64),
                request_id=bounded_text(job.get("request_id"), 64),
                request_number=bounded_text(job.get("request_number"), 128),
                item_id=bounded_text(job.get("item_id"), 64),
                item_name=bounded_text(job.get("item_name"), 256),
                item_model=bounded_text(job.get("item_model"), 256),
                serial_number_last4=bounded_text(job.get("serial_number_last4"), 4) or None,
            )
            row = self.store.get(photo_id)
            if row is None:
                raise RuntimeError("Local archive manifest was not persisted")
            self.confirm(row)
        except ApiError as error:
            if error.status == HTTPStatus.UNPROCESSABLE_ENTITY:
                quarantine = destination.with_name(f"{destination.name}.quarantine-{int(time.time())}")
                if destination.exists():
                    os.replace(destination, quarantine)
                self.store.mark_waiting(photo_id, str(error))
            elif error.status == HTTPStatus.CONFLICT:
                self.store.mark_waiting(photo_id, str(error))
            else:
                LOGGER.warning("archive_confirmation_deferred photo_id=%s status=%s", photo_id, error.status)
            raise
        except Exception as error:
            self.report_failure(job, str(error))
            raise

    def run(self) -> None:
        self.config.archive_root.mkdir(parents=True, exist_ok=True)
        while not self.stop_event.is_set():
            try:
                self.retry_pending_confirmations()
                result = self.api({
                    "action": "claim",
                    "worker_id": self.config.worker_id,
                    "limit": self.config.claim_limit,
                })
                jobs = result.get("jobs", [])
                for job in jobs:
                    if self.stop_event.is_set():
                        break
                    try:
                        self.process_job(job)
                    except Exception as error:
                        LOGGER.error("archive_job_failed job_id=%s error=%s", job.get("job_id"), error)
            except Exception as error:
                LOGGER.error("archive_poll_failed error=%s", error)

            self.stop_event.wait(self.config.poll_seconds)


class ViewerHandler(BaseHTTPRequestHandler):
    server_version = "DJIArchiveViewer/1.0"

    @property
    def app(self) -> "ViewerServer":
        return self.server  # type: ignore[return-value]

    def log_message(self, format_string: str, *args: object) -> None:
        LOGGER.info("viewer client=%s %s", self.client_address[0], format_string % args)

    def cors_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if not origin:
            return None
        return origin if origin.rstrip("/") == self.app.config.allowed_origin else ""

    def send_common_headers(self, content_type: str, content_length: int) -> None:
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(content_length))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'")
        origin = self.cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def json_error(self, status: int, message: str) -> None:
        payload = json.dumps({"error": message}).encode("utf-8")
        self.send_response(status)
        self.send_common_headers("application/json; charset=utf-8", len(payload))
        self.end_headers()
        self.wfile.write(payload)

    def json_response(self, payload_value: object, status: int = HTTPStatus.OK) -> None:
        payload = json.dumps(payload_value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_common_headers("application/json; charset=utf-8", len(payload))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        origin = self.cors_origin()
        if origin == "":
            self.json_error(HTTPStatus.FORBIDDEN, "Origin is not allowed")
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def authorized_photo_ids(self, photo_ids: list[str]) -> set[str]:
        if not photo_ids:
            return set()
        authorization = self.headers.get("Authorization", "")
        if not authorization.lower().startswith("bearer "):
            return set()
        query = urllib.parse.urlencode({
            "id": f"in.({','.join(photo_ids[:50])})",
            "select": "id",
            "limit": "50",
        })
        request = urllib.request.Request(
            f"{self.app.config.supabase_url}/rest/v1/return_photos?{query}",
            headers={
                "apikey": self.app.config.publishable_key,
                "Authorization": authorization,
                "Accept": "application/json",
                "User-Agent": "dji-return-photo-viewer/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                rows = json.loads(response.read().decode("utf-8"))
                return {
                    str(row.get("id"))
                    for row in rows
                    if row.get("id") in photo_ids
                }
        except Exception as error:
            LOGGER.warning("viewer_authorization_failed photo_count=%s error=%s", len(photo_ids), error)
            return set()

    def authorize(self, photo_id: str) -> bool:
        return photo_id in self.authorized_photo_ids([photo_id])

    def do_GET(self) -> None:
        origin = self.cors_origin()
        if origin == "":
            self.json_error(HTTPStatus.FORBIDDEN, "Origin is not allowed")
            return

        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            payload = json.dumps({
                "ok": True,
                "service": "dji-return-photo-archive",
                "archives": self.app.store.counts(),
                "disk_free_bytes": shutil.disk_usage(self.app.config.archive_root).free,
            }).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_common_headers("application/json; charset=utf-8", len(payload))
            self.end_headers()
            self.wfile.write(payload)
            return

        if parsed.path == "/search":
            parameters = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)

            def parameter(name: str, max_length: int) -> str:
                values = parameters.get(name, [])
                return bounded_text(values[0] if values else "", max_length)

            request_number = parameter("request_number", 128)
            item_model = parameter("model", 256)
            serial_number_last4 = parameter("sn_last4", 4)
            if not request_number and not item_model and not serial_number_last4:
                self.json_error(HTTPStatus.BAD_REQUEST, "At least one search filter is required")
                return
            if serial_number_last4 and len(serial_number_last4) != 4:
                self.json_error(HTTPStatus.BAD_REQUEST, "sn_last4 must contain exactly four characters")
                return

            rows = self.app.store.search_verified(
                request_number=request_number,
                item_model=item_model,
                serial_number_last4=serial_number_last4,
                limit=50,
            )
            authorized = self.authorized_photo_ids([str(row["photo_id"]) for row in rows])
            results = [
                {
                    "return_photo_id": row["photo_id"],
                    "source_bucket_id": row["source_bucket_id"],
                    "source_storage_path": row["source_storage_path"],
                    "borrow_record_id": row["borrow_record_id"],
                    "request_id": row["request_id"],
                    "request_number": row["request_number"],
                    "item_id": row["item_id"],
                    "item_name": row["item_name"],
                    "item_model": row["item_model"],
                    "serial_number_last4": row["serial_number_last4"],
                    "captured_at": row["captured_at"],
                    "archive_path": row["relative_path"],
                    "size_bytes": row["size_bytes"],
                    "sha256": row["sha256"],
                    "server_verified_at": row["server_verified_at"],
                    "photo_path": f"/photos/{row['photo_id']}",
                }
                for row in rows
                if str(row["photo_id"]) in authorized
            ]
            self.json_response({"results": results, "count": len(results)})
            return

        segments = [urllib.parse.unquote(segment) for segment in parsed.path.split("/") if segment]
        if len(segments) != 2 or segments[0] != "photos":
            self.json_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        try:
            photo_id = str(uuid.UUID(segments[1]))
        except ValueError:
            self.json_error(HTTPStatus.BAD_REQUEST, "Invalid photo id")
            return

        row = self.app.store.get_verified(photo_id)
        if row is None or not self.authorize(photo_id):
            self.json_error(HTTPStatus.NOT_FOUND, "Photo not found")
            return

        try:
            path = safe_archive_destination(self.app.config.archive_root, str(row["relative_path"]))
            size_bytes, sha256 = sha256_file(path)
            if size_bytes != int(row["size_bytes"]) or sha256 != row["sha256"]:
                raise RuntimeError("Archive integrity check failed")
        except Exception as error:
            LOGGER.error("viewer_integrity_failed photo_id=%s error=%s", photo_id, error)
            self.json_error(HTTPStatus.SERVICE_UNAVAILABLE, "Archived photo failed integrity verification")
            return

        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_common_headers(content_type, size_bytes)
        self.send_header("ETag", f'"sha256-{sha256}"')
        self.end_headers()
        with path.open("rb") as handle:
            shutil.copyfileobj(handle, self.wfile, length=1024 * 1024)


class ViewerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, config: Config, store: StateStore) -> None:
        self.config = config
        self.store = store
        super().__init__((config.view_bind, config.view_port), ViewerHandler)


def run() -> None:
    config = Config.from_env()
    config.archive_root.mkdir(parents=True, exist_ok=True)
    store = StateStore(config.state_db)
    stop_event = threading.Event()
    server = ViewerServer(config, store)

    if config.tls_cert_file and config.tls_key_file:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(config.tls_cert_file, config.tls_key_file)
        server.socket = context.wrap_socket(server.socket, server_side=True)

    def stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    archive_thread = threading.Thread(
        target=ArchiveAgent(config, store, stop_event).run,
        name="archive-poller",
        daemon=True,
    )
    viewer_thread = threading.Thread(target=server.serve_forever, name="archive-viewer", daemon=True)
    archive_thread.start()
    viewer_thread.start()
    scheme = "https" if config.tls_cert_file else "http"
    LOGGER.info("service_started viewer=%s://%s:%s", scheme, config.view_bind, config.view_port)

    try:
        while not stop_event.wait(1):
            if not archive_thread.is_alive() or not viewer_thread.is_alive():
                raise RuntimeError("A required service thread exited")
    finally:
        stop_event.set()
        server.shutdown()
        server.server_close()
        archive_thread.join(timeout=10)
        viewer_thread.join(timeout=10)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--healthcheck", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if args.healthcheck:
        config = Config.from_env()
        store = StateStore(config.state_db)
        if not config.archive_root.is_dir():
            raise SystemExit(1)
        store.counts()
        return
    run()


if __name__ == "__main__":
    main()
