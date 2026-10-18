#!/usr/bin/env python3
"""Load reviewed lease contract files from Z:\\OPERATING FILES into rlms-attachments.

Z: is read-only. Logs and state stay next to this script. Never prints the service key.
Default mode is --dry-run (no writes).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
LIMIT_BYTES = 50 * 1024 * 1024
SAFE_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!-_.*'() &$@=;:+,")
SOURCE_ROOT_LABEL = r"Z:\OPERATING FILES"
BUCKET = "rlms-attachments"
ACTOR = "contract-loader"
LOG_FIELDS = [
    "ts", "load_batch", "rider_code", "source_path", "storage_path",
    "size", "status", "message",
]


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'").strip("\r"))


def rest(method: str, url: str, headers: dict[str, str], body: bytes | None = None, timeout: int = 60):
    req = Request(url, data=body, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            return resp.status, data, dict(resp.headers)
    except HTTPError as e:
        return e.code, e.read(), dict(e.headers)
    except URLError as e:
        raise RuntimeError(f"network error: {e.reason}") from e


class Client:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key
        self.h = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
        }

    def pg(self, method: str, path: str, params: str = "", body: Any = None, prefer: str | None = None):
        headers = {
            **self.h,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        payload = None if body is None else json.dumps(body).encode("utf-8")
        status, data, _ = rest(method, f"{self.url}/rest/v1/{path}{params}", headers, payload)
        if status >= 400:
            raise RuntimeError(f"postgrest {status}: {data.decode('utf-8', 'replace')[:500]}")
        if not data:
            return None
        return json.loads(data.decode("utf-8"))

    def rpc(self, name: str, payload: dict[str, Any]):
        return self.pg("POST", f"rpc/{name}", body=payload)

    def storage_upload(self, key: str, blob: bytes, content_type: str, upsert: bool = False):
        headers = {
            **self.h,
            "Content-Type": content_type,
            "x-upsert": "true" if upsert else "false",
        }
        url = f"{self.url}/storage/v1/object/{BUCKET}/{quote(key, safe='/')}"
        status, data, _ = rest("POST", url, headers, blob, timeout=300)
        return status, data.decode("utf-8", "replace")

    def storage_info(self, key: str) -> dict[str, Any] | None:
        folder, _, name = key.rpartition("/")
        headers = {**self.h, "Content-Type": "application/json"}
        body = json.dumps({"prefix": folder + "/" if folder else "", "limit": 1000}).encode()
        status, data, _ = rest("POST", f"{self.url}/storage/v1/object/list/{BUCKET}", headers, body)
        if status >= 400:
            return None
        rows = json.loads(data.decode("utf-8") or "[]")
        for r in rows:
            if r.get("name") == name or r.get("name") == key.split("/")[-1]:
                meta = r.get("metadata") or {}
                return {"name": r.get("name"), "size": int(meta.get("size") or r.get("metadata", {}).get("size") or 0)}
        return None

    def storage_remove(self, keys: list[str]):
        headers = {**self.h, "Content-Type": "application/json"}
        for i in range(0, len(keys), 100):
            chunk = keys[i : i + 100]
            body = json.dumps({"prefixes": chunk}).encode()
            status, data, _ = rest("DELETE", f"{self.url}/storage/v1/object/{BUCKET}", headers, body)
            if status >= 400:
                raise RuntimeError(f"storage remove {status}: {data.decode('utf-8', 'replace')[:400]}")


def safe_name(name: str) -> str:
    return "".join(ch if ch in SAFE_CHARS else "_" for ch in name)


def mime_for(ext: str) -> str:
    e = (ext or "").lower()
    if e == ".pdf":
        return "application/pdf"
    if e in (".tif", ".tiff"):
        return "image/tiff"
    return "application/octet-stream"


def resolve_under(zroot: Path, rel: str) -> Path:
    root = zroot.resolve()
    candidate = (root / rel).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as e:
        raise RuntimeError(f"path escapes ZROOT: {rel}") from e
    return candidate


def storage_key_from_manifest(row: dict[str, str], existing: set[str], source_path: str) -> str:
    raw = (row.get("storage_path") or "").replace("\\", "/").strip("/")
    parts = [p for p in raw.split("/") if p]
    if len(parts) < 2:
        parts = ["riders", str(row["rider_id"]), row["file"]]
    parts = [safe_name(p) if i == len(parts) - 1 else p for i, p in enumerate(parts)]
    key = "/".join(parts)
    if key in existing:
        stem, dot, ext = parts[-1].rpartition(".")
        n = 2
        while True:
            nxt = f"{stem}-{n}.{ext}" if dot else f"{parts[-1]}-{n}"
            cand = "/".join([*parts[:-1], nxt])
            if cand not in existing:
                key = cand
                break
            n += 1
    return key


def append_log(path: Path, row: dict[str, Any]) -> None:
    new = not path.exists()
    with path.open("a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=LOG_FIELDS)
        if new:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in LOG_FIELDS})


def existing_keys(client: Client) -> set[tuple[str, int, str, int]]:
    out: set[tuple[str, int, str, int]] = set()
    start = 0
    while True:
        rows = client.pg(
            "GET",
            "attachments",
            params=f"?select=entity_type,entity_id,source_path,file_size&source_path=not.is.null&offset={start}&limit=1000",
            prefer="count=exact",
        ) or []
        for r in rows:
            out.add((str(r["entity_type"]), int(r["entity_id"]), str(r["source_path"]), int(r["file_size"])))
        if len(rows) < 1000:
            break
        start += 1000
    return out


def existing_storage_paths(client: Client) -> set[str]:
    out: set[str] = set()
    start = 0
    while True:
        rows = client.pg(
            "GET",
            "attachments",
            params=f"?select=storage_path&offset={start}&limit=1000",
        ) or []
        for r in rows:
            if r.get("storage_path"):
                out.add(str(r["storage_path"]))
        if len(rows) < 1000:
            break
        start += 1000
    return out


def retry(fn, times=3):
    last = None
    for i in range(times):
        try:
            return fn()
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last  # type: ignore


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--manifest", default=str(HERE / "load_manifest.csv"))
    p.add_argument("--zroot", default=SOURCE_ROOT_LABEL)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--revert", metavar="LOAD_BATCH")
    p.add_argument("--resume", action="store_true")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--riders", default="")
    args = p.parse_args()
    if not args.apply and not args.revert:
        args.dry_run = True
    if args.apply and args.dry_run:
        args.dry_run = False

    load_dotenv(HERE / ".env")
    if not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        load_dotenv(HERE.parent / ".env.local")
    url = os.environ.get("SUPABASE_URL") or ""
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in script/.env", file=sys.stderr)
        return 2
    client = Client(url, key)

    log_path = HERE / "load_log.csv"
    state_path = HERE / "load_state.json"

    if args.revert:
        return revert(client, args.revert, log_path)

    zroot = Path(args.zroot)
    if not zroot.exists():
        print(f"ZROOT not found: {zroot}", file=sys.stderr)
        return 2

    with open(args.manifest, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    rider_filter = {x.strip().upper() for x in args.riders.split(",") if x.strip()}
    if rider_filter:
        rows = [r for r in rows if str(r.get("rider_code", "")).upper() in rider_filter]

    print(f"checking existing attachments at {url.split('://', 1)[-1][:40]}…", flush=True)
    loaded = existing_keys(client) if (args.apply or args.dry_run) else set()
    storage_used = existing_storage_paths(client) if args.apply else set()
    print(f"existing attachment keys: {len(loaded)}", flush=True)

    counts = {
        "to_load": 0,
        "already_loaded": 0,
        "missing": 0,
        "size_changed": 0,
        "over_limit": 0,
        "loaded": 0,
        "error": 0,
    }
    preview: list[dict[str, Any]] = []
    work: list[dict[str, str]] = []

    for r in rows:
        rel = r["z_relative_path"]
        try:
            path = resolve_under(zroot, rel)
        except RuntimeError as e:
            counts["error"] += 1
            preview.append({"status": "error", "source_path": rel, "message": str(e)})
            continue
        size_m = int(r["size_bytes"])
        key = ("rider", int(r["rider_id"]), rel, size_m)
        if key in loaded:
            counts["already_loaded"] += 1
            preview.append({"status": "already_loaded", "source_path": rel, "rider_code": r["rider_code"]})
            continue
        if size_m > LIMIT_BYTES:
            counts["over_limit"] += 1
            preview.append({"status": "over_limit", "source_path": rel, "size": size_m})
            continue
        if not path.is_file():
            counts["missing"] += 1
            preview.append({"status": "missing", "source_path": rel, "rider_code": r["rider_code"]})
            continue
        disk = path.stat().st_size
        if disk != size_m:
            counts["size_changed"] += 1
            preview.append({"status": "size_changed", "source_path": rel, "manifest": size_m, "disk": disk})
            continue
        counts["to_load"] += 1
        work.append(r)
        preview.append({"status": "to_load", "source_path": rel, "rider_code": r["rider_code"], "size": size_m})

    if args.limit and args.limit > 0:
        work = work[: args.limit]

    print("dry-run" if args.dry_run else "apply", flush=True)
    print(f"manifest rows after rider filter: {len(rows)}")
    print(f"to_load={counts['to_load']} already_loaded={counts['already_loaded']} missing={counts['missing']} size_changed={counts['size_changed']} over_limit={counts['over_limit']}")
    print("first 20:")
    for row in preview[:20]:
        print(" ", row)
    if args.dry_run:
        print(f"would upload {len(work)} files this run")
        return 0

    batch = None
    if args.resume and state_path.exists():
        try:
            batch = json.loads(state_path.read_text(encoding="utf-8")).get("load_batch")
        except json.JSONDecodeError:
            batch = None
    if not batch:
        batch = str(uuid.uuid4())
    state_path.write_text(json.dumps({"load_batch": batch, "started_at": datetime.now(timezone.utc).isoformat()}, indent=2), encoding="utf-8")
    print(f"load_batch={batch} uploading {len(work)}")

    for r in work:
        rel = r["z_relative_path"]
        path = resolve_under(zroot, rel)
        size_m = int(r["size_bytes"])
        st_key = storage_key_from_manifest(r, storage_used, rel)
        status = "error"
        msg = ""
        try:
            def _read(p=path):
                with open(p, "rb") as fh:
                    return fh.read()
            blob = retry(_read)
            if len(blob) != size_m:
                status = "skipped_size_changed"
                msg = f"read size {len(blob)} != {size_m}"
            else:
                ctype = mime_for(r.get("ext") or path.suffix)
                code, resp = retry(lambda: client.storage_upload(st_key, blob, ctype, upsert=False))
                if code in (409, 400) and "already" in resp.lower() or code == 409:
                    info = client.storage_info(st_key)
                    if info and int(info.get("size") or 0) == size_m:
                        msg = "reused existing object"
                    else:
                        storage_used.add(st_key)
                        st_key = storage_key_from_manifest(r, storage_used, rel)
                        code, resp = retry(lambda: client.storage_upload(st_key, blob, ctype, upsert=False))
                        if code >= 400:
                            raise RuntimeError(f"upload {code}: {resp[:300]}")
                elif code >= 400:
                    raise RuntimeError(f"upload {code}: {resp[:300]}")
                row_body = {
                    "entity_type": "rider",
                    "entity_id": int(r["rider_id"]),
                    "master_lease_id": int(r["master_lease_id"]) if r.get("master_lease_id") else None,
                    "file_name": r["file"],
                    "file_size": size_m,
                    "mime_type": ctype,
                    "storage_path": st_key,
                    "uploaded_by": ACTOR,
                    "source_module": "lease_contracts",
                    "source": SOURCE_ROOT_LABEL,
                    "source_path": rel,
                    "source_modified": (r.get("modified") or None),
                    "doc_class": r.get("doc_class") or "likely_executed",
                    "load_batch": batch,
                    "notes": r.get("class_reason") or None,
                }
                ins = client.pg("POST", "attachments", body=row_body, prefer="return=representation")
                att = ins[0] if isinstance(ins, list) else ins
                client.pg(
                    "POST",
                    "activity_log",
                    body={
                        "entity_type": "rider",
                        "entity_id": int(r["rider_id"]),
                        "rider_id": int(r["rider_id"]),
                        "action": "contract_load",
                        "actor": ACTOR,
                        "source": SOURCE_ROOT_LABEL,
                        "table_name": "attachments",
                        "row_pk": att["id"],
                        "before": {},
                        "after": att,
                        "detail": {"op": "insert", "storage_path": st_key},
                        "undoable": True,
                        "change_group": batch,
                    },
                )
                storage_used.add(st_key)
                loaded.add(("rider", int(r["rider_id"]), rel, size_m))
                status = "loaded"
                counts["loaded"] += 1
                counts["to_load"] -= 1
        except Exception as e:
            status = "error"
            msg = str(e)[:400]
            counts["error"] += 1
        append_log(log_path, {
            "ts": datetime.now(timezone.utc).isoformat(),
            "load_batch": batch,
            "rider_code": r.get("rider_code"),
            "source_path": rel,
            "storage_path": st_key,
            "size": size_m,
            "status": status,
            "message": msg,
        })
        print(f"  {status} {r.get('rider_code')} {rel} {msg}")

    print(f"done loaded={counts['loaded']} errors={counts['error']} batch={batch}")
    return 1 if counts["error"] else 0


def revert(client: Client, batch: str, log_path: Path) -> int:
    rows = client.pg("GET", "attachments", params=f"?select=id,storage_path&load_batch=eq.{batch}&limit=2000") or []
    keys = [str(r["storage_path"]) for r in rows if r.get("storage_path")]
    if keys:
        client.storage_remove(keys)
    try:
        client.rpc("rlms_undo_change_group", {"p_group": batch, "p_actor": ACTOR})
    except Exception as e:
        print(f"undo rpc: {e}", file=sys.stderr)
        for r in rows:
            client.pg("DELETE", "attachments", params=f"?id=eq.{r['id']}")
    left = client.pg("GET", "attachments", params=f"?select=id&load_batch=eq.{batch}") or []
    append_log(log_path, {
        "ts": datetime.now(timezone.utc).isoformat(),
        "load_batch": batch,
        "rider_code": "",
        "source_path": "",
        "storage_path": "",
        "size": "",
        "status": "reverted",
        "message": f"rows_left={len(left)} objects_removed={len(keys)}",
    })
    print(f"revert batch={batch} removed_objects={len(keys)} rows_left={len(left)}")
    return 0 if not left else 1


if __name__ == "__main__":
    raise SystemExit(main())
