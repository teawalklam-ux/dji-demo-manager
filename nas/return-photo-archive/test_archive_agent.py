import json
import tempfile
import threading
import unittest
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from archive_agent import (
    ArchiveAgent,
    Config,
    StateStore,
    ViewerServer,
    safe_archive_destination,
    validate_supabase_restore_location,
)


PHOTO_ID = "00000000-0000-4000-8000-000000000001"


def add_verified_archive(store: StateStore) -> None:
    store.save_local_copy(
        photo_id=PHOTO_ID,
        job_id="00000000-0000-4000-8000-000000000002",
        lease_token="00000000-0000-4000-8000-000000000003",
        relative_path="2026/08/24/photo.jpg",
        size_bytes=10,
        sha256="a" * 64,
        source_bucket_id="return-photos",
        source_storage_path="user-id/borrow-record-id/1724457600000.jpg",
        captured_at="2026-08-24T00:00:00+00:00",
        borrow_record_id="00000000-0000-4000-8000-000000000004",
        request_id="00000000-0000-4000-8000-000000000005",
        request_number="BR-20260824-001",
        item_id="00000000-0000-4000-8000-000000000006",
        item_name="DJI Air 3S",
        item_model="DJI Air 3S Fly More Combo",
        serial_number_last4="A123",
    )
    store.mark_verified(PHOTO_ID)


class RlsStubHandler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_GET(self) -> None:
        rows = [{"id": PHOTO_ID}] if self.headers.get("Authorization") == "Bearer allowed" else []
        payload = json.dumps(rows).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class SafeArchivePathTests(unittest.TestCase):
    def test_accepts_generated_relative_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            result = safe_archive_destination(root, "2026/08/24/00000000-0000-4000-8000-000000000001.jpg")
            self.assertEqual(result.parent, root / "2026" / "08" / "24")

    def test_rejects_traversal_and_absolute_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for unsafe in ("../secret", "/etc/passwd", "2026/../../secret", "2026\\secret"):
                with self.subTest(path=unsafe), self.assertRaises(ValueError):
                    safe_archive_destination(root, unsafe)

    def test_restore_location_accepts_only_original_private_bucket_path(self) -> None:
        self.assertEqual(
            validate_supabase_restore_location(
                "return-photos",
                "user-id/borrow-record-id/1724457600000.jpg",
            ),
            ("return-photos", "user-id/borrow-record-id/1724457600000.jpg"),
        )
        for bucket, path in (
            ("other", "user/record/photo.jpg"),
            ("return-photos", "../photo.jpg"),
            ("return-photos", "/photo.jpg"),
        ):
            with self.subTest(bucket=bucket, path=path), self.assertRaises(ValueError):
                validate_supabase_restore_location(bucket, path)


class StateStoreTests(unittest.TestCase):
    def test_manifest_moves_to_verified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = StateStore(Path(directory) / "archive.db")
            add_verified_archive(store)
            self.assertEqual(len(store.pending_confirmations()), 0)
            self.assertIsNotNone(store.get_verified(PHOTO_ID))
            self.assertEqual(
                len(store.search_verified("BR-20260824", "Air 3S", "A123")),
                1,
            )
            self.assertEqual(len(store.search_verified("BR-OTHER", "", "")), 0)

    def test_metadata_sidecar_is_valid_utf8_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = StateStore(root / "archive.db")
            add_verified_archive(store)
            row = store.get_verified(PHOTO_ID)
            self.assertIsNotNone(row)
            config = Config(
                supabase_url="https://example.supabase.co",
                publishable_key="public-test-key",
                archive_token="archive-test-token",
                archive_root=root,
                state_db=root / "archive.db",
                worker_id="test",
                poll_seconds=60,
                claim_limit=5,
                max_file_bytes=6_291_456,
                allowed_origin="https://teawalklam-ux.github.io",
                view_bind="127.0.0.1",
                view_port=0,
                tls_cert_file=None,
                tls_key_file=None,
                require_tls=False,
            )
            ArchiveAgent(config, store, threading.Event()).write_sidecar(
                row,
                "2026-08-24T01:02:03+00:00",
            )
            path = root / "2026" / "08" / "24" / "photo.jpg.metadata.json"
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(data["request_number"], "BR-20260824-001")
            self.assertEqual(data["supabase_restore"]["bucket_id"], "return-photos")
            self.assertEqual(
                data["supabase_restore"]["storage_path"],
                "user-id/borrow-record-id/1724457600000.jpg",
            )


class ViewerSearchTests(unittest.TestCase):
    def test_search_filters_results_through_supabase_rls(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = StateStore(root / "archive.db")
            add_verified_archive(store)

            rls_server = ThreadingHTTPServer(("127.0.0.1", 0), RlsStubHandler)
            rls_thread = threading.Thread(target=rls_server.serve_forever, daemon=True)
            rls_thread.start()
            config = Config(
                supabase_url=f"http://127.0.0.1:{rls_server.server_address[1]}",
                publishable_key="public-test-key",
                archive_token="archive-test-token",
                archive_root=root,
                state_db=root / "archive.db",
                worker_id="test",
                poll_seconds=60,
                claim_limit=5,
                max_file_bytes=6_291_456,
                allowed_origin="https://teawalklam-ux.github.io",
                view_bind="127.0.0.1",
                view_port=0,
                tls_cert_file=None,
                tls_key_file=None,
                require_tls=False,
            )
            viewer = ViewerServer(config, store)
            viewer_thread = threading.Thread(target=viewer.serve_forever, daemon=True)
            viewer_thread.start()
            try:
                url = (
                    f"http://127.0.0.1:{viewer.server_address[1]}/search?"
                    + urllib.parse.urlencode({"request_number": "BR-20260824", "sn_last4": "A123"})
                )
                allowed_request = urllib.request.Request(url, headers={
                    "Authorization": "Bearer allowed",
                    "Origin": "https://teawalklam-ux.github.io",
                })
                with urllib.request.urlopen(allowed_request) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                    self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://teawalklam-ux.github.io")
                    self.assertEqual(payload["count"], 1)
                    self.assertEqual(payload["results"][0]["request_number"], "BR-20260824-001")
                    self.assertEqual(payload["results"][0]["source_bucket_id"], "return-photos")
                    self.assertEqual(
                        payload["results"][0]["source_storage_path"],
                        "user-id/borrow-record-id/1724457600000.jpg",
                    )

                denied_request = urllib.request.Request(url, headers={"Authorization": "Bearer denied"})
                with urllib.request.urlopen(denied_request) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                    self.assertEqual(payload["count"], 0)
            finally:
                viewer.shutdown()
                viewer.server_close()
                rls_server.shutdown()
                rls_server.server_close()
                viewer_thread.join(timeout=5)
                rls_thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
