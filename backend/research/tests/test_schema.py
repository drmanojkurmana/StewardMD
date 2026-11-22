from pathlib import Path
import sqlite3


def test_research_d1_schema_executes_and_has_pilot_tables():
    repo_root = Path(__file__).resolve().parents[3]
    schema = repo_root / "functions" / "db" / "research_schema.sql"
    connection = sqlite3.connect(":memory:")
    connection.executescript(schema.read_text(encoding="utf-8"))
    names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"research_projects", "research_members", "research_jobs", "research_meta_analyses",
            "research_artifacts", "research_audit_events"}.issubset(names)
    connection.close()
