"""R2 storage via the S3-compatible API (boto3).

Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
Keys are project-scoped by contract (retention.md); callers must check the
project prefix before reading. Missing objects return None, never an
exception, so idempotency and cancel checks stay simple.
"""
from __future__ import annotations

import os

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

_MISSING = ("NoSuchKey", "404", "NotFound")


class StorageError(Exception):
    """R2 call failed for a reason other than a missing object."""


def _is_missing(exc: ClientError) -> bool:
    return str(exc.response.get("Error", {}).get("Code", "")) in _MISSING


class R2Storage:
    def __init__(
        self,
        endpoint: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        bucket: str | None = None,
        *,
        client=None,
    ):
        self.bucket = bucket or os.environ["R2_BUCKET"]
        if client is not None:
            self._s3 = client
        else:
            self._s3 = boto3.client(
                "s3",
                endpoint_url=endpoint or os.environ["R2_ENDPOINT"],
                aws_access_key_id=access_key_id or os.environ["R2_ACCESS_KEY_ID"],
                aws_secret_access_key=secret_access_key or os.environ["R2_SECRET_ACCESS_KEY"],
                region_name="auto",
                config=Config(
                    signature_version="s3v4",
                    retries={"max_attempts": 3, "mode": "standard"},
                    connect_timeout=10,
                    read_timeout=120,
                ),
            )

    def get_bytes(self, key: str) -> bytes | None:
        try:
            resp = self._s3.get_object(Bucket=self.bucket, Key=key)
            return resp["Body"].read()
        except ClientError as exc:
            if _is_missing(exc):
                return None
            raise StorageError(f"r2 get failed for {key}") from exc

    def exists(self, key: str) -> bool:
        try:
            self._s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as exc:
            if _is_missing(exc):
                return False
            raise StorageError(f"r2 head failed for {key}") from exc

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/json") -> None:
        try:
            self._s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        except ClientError as exc:
            raise StorageError(f"r2 put failed for {key}") from exc

    def delete(self, key: str) -> None:
        try:
            self._s3.delete_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if not _is_missing(exc):
                raise StorageError(f"r2 delete failed for {key}") from exc