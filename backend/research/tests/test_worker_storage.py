"""R2 storage wrapper: missing-object semantics and error mapping."""
from __future__ import annotations

import io

import pytest
from botocore.exceptions import ClientError

from research_worker.storage import R2Storage, StorageError


def client_error(code):
    return ClientError({"Error": {"Code": code, "Message": "x"}}, "GetObject")


class FakeS3:
    def __init__(self, objects=None, error=None):
        self.objects = dict(objects or {})
        self.error = error
        self.puts = []
        self.deletes = []

    def get_object(self, Bucket, Key):
        if self.error:
            raise self.error
        if Key not in self.objects:
            raise client_error("NoSuchKey")
        return {"Body": io.BytesIO(self.objects[Key])}

    def head_object(self, Bucket, Key):
        if self.error:
            raise self.error
        if Key not in self.objects:
            raise client_error("404")
        return {}

    def put_object(self, Bucket, Key, Body, ContentType):
        self.puts.append((Key, Body, ContentType))
        self.objects[Key] = Body

    def delete_object(self, Bucket, Key):
        self.deletes.append(Key)
        self.objects.pop(Key, None)


def test_get_missing_returns_none():
    storage = R2Storage(bucket="b", client=FakeS3())
    assert storage.get_bytes("projects/p1/pdf/x.pdf") is None
    assert storage.exists("projects/p1/jobs/j/cancel") is False


def test_put_get_roundtrip():
    s3 = FakeS3()
    storage = R2Storage(bucket="b", client=s3)
    storage.put_bytes("projects/p1/jobs/j/result.json", b"{}")
    assert storage.get_bytes("projects/p1/jobs/j/result.json") == b"{}"
    assert storage.exists("projects/p1/jobs/j/result.json") is True
    assert s3.puts[0][2] == "application/json"


def test_other_errors_raise_storage_error():
    storage = R2Storage(bucket="b", client=FakeS3(error=client_error("AccessDenied")))
    with pytest.raises(StorageError):
        storage.get_bytes("k")
    with pytest.raises(StorageError):
        storage.exists("k")


def test_delete_missing_is_ok():
    s3 = FakeS3()
    storage = R2Storage(bucket="b", client=s3)
    storage.delete("absent")
    assert s3.deletes == ["absent"]