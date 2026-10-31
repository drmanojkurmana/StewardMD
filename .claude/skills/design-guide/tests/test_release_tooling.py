import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCTOR = ROOT / "scripts" / "design-guide-doctor.py"
SECRET_SCAN = ROOT / "scripts" / "check-secrets.py"
JOURNEYS = ROOT / "scripts" / "verify-product-journeys.py"
SMOKE = ROOT / "scripts" / "smoke-aides.py"


def fake_openai_key() -> str:
    return "sk" + "-" + "abcdefghijklmnopqrstuvwxyz123456"


def load_module(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class VersionManifestTest(unittest.TestCase):
    def test_version_sources_and_release_notes_agree(self) -> None:
        version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
        manifest = json.loads((ROOT / "design-guide.json").read_text(encoding="utf-8"))
        self.assertEqual(version, manifest["version"])
        self.assertIn(f"## [{version}]", (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"))
        self.assertIn(f"v{version}", (ROOT / "RELEASE_NOTES.md").read_text(encoding="utf-8"))
        for relative in manifest["requiredFiles"]:
            self.assertTrue((ROOT / relative).is_file(), relative)


class SecretScanTest(unittest.TestCase):
    def test_token_rule_ignores_normal_prose_and_flags_long_keys(self) -> None:
        module = load_module("check_secrets", SECRET_SCAN)
        rule = module.RULES["OpenAI-style API key"]
        self.assertIsNone(rule.search("task-based review workflow"))
        self.assertIsNone(rule.search("sk-short-placeholder"))
        self.assertIsNotNone(rule.search(fake_openai_key()))

    def test_candidate_files_include_untracked_nonignored_files(self) -> None:
        module = load_module("check_secrets_candidates", SECRET_SCAN)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            (root / ".gitignore").write_text("ignored.txt\n", encoding="utf-8")
            (root / "untracked.txt").write_text("public\n", encoding="utf-8")
            (root / "ignored.txt").write_text("ignored\n", encoding="utf-8")
            candidates = {path.name for path in module.candidate_files(root)}
        self.assertIn("untracked.txt", candidates)
        self.assertNotIn("ignored.txt", candidates)

    def test_scan_does_not_skip_credentials_in_readme(self) -> None:
        module = load_module("check_secrets_readme", SECRET_SCAN)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            (root / "README.md").write_text(fake_openai_key() + "\n", encoding="utf-8")
            findings = module.scan(root)
        self.assertTrue(any("OpenAI-style API key" in finding for finding in findings))

    def test_scan_works_without_git_metadata(self) -> None:
        module = load_module("check_secrets_non_git", SECRET_SCAN)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            (root / "README.md").write_text(fake_openai_key() + "\n", encoding="utf-8")
            findings = module.scan(root)
        self.assertTrue(any("OpenAI-style API key" in finding for finding in findings))


class DoctorTest(unittest.TestCase):
    def test_doctor_detects_and_recovers_stale_mirrors(self) -> None:
        module = load_module("design_guide_doctor", DOCTOR)
        with tempfile.TemporaryDirectory() as temp_dir:
            target_home = pathlib.Path(temp_dir)
            for aide, relative in module.AIDE_PATHS.items():
                target = target_home / relative
                shutil.copytree(
                    ROOT,
                    target,
                    ignore=shutil.ignore_patterns(".git", ".github", ".codex", "promo", "__pycache__", "*.pyc"),
                )
            healthy = module.report(ROOT, target_home)
            stale_skill = target_home / module.AIDE_PATHS["cursor"] / "SKILL.md"
            stale_skill.write_text(stale_skill.read_text(encoding="utf-8") + "\nstale\n", encoding="utf-8")
            stale = module.report(ROOT, target_home)
        self.assertTrue(healthy["healthy"])
        self.assertFalse(stale["healthy"])
        cursor = next(item for item in stale["targets"] if item["aide"] == "cursor")
        self.assertFalse(cursor["synchronized"])

    def test_doctor_help_is_dependency_free(self) -> None:
        result = subprocess.run(
            [sys.executable, str(DOCTOR), "--help"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_doctor_rejects_version_file_manifest_drift(self) -> None:
        module = load_module("design_guide_doctor_version", DOCTOR)
        with tempfile.TemporaryDirectory() as temp_dir:
            source = pathlib.Path(temp_dir) / "source"
            shutil.copytree(ROOT, source, ignore=shutil.ignore_patterns(".git", ".codex", "__pycache__", "*.pyc"))
            (source / "VERSION").write_text("9.9.9\n", encoding="utf-8")
            data = module.report(source, pathlib.Path(temp_dir) / "targets")
        self.assertFalse(data["versionConsistent"])
        self.assertFalse(data["healthy"])


class JourneyContractTest(unittest.TestCase):
    def test_three_journeys_and_automation_are_documented(self) -> None:
        content = (ROOT / "references" / "end-to-end-journeys.md").read_text(encoding="utf-8")
        for required in (
            "Journey 1: New Product",
            "Journey 2: Existing Page Review",
            "Journey 3: Install, Synchronize, And Invoke Across AIDEs",
            "Release Gate",
            "verify-product-journeys.py",
        ):
            self.assertIn(required, content)
        self.assertTrue(JOURNEYS.is_file())

    def test_provider_smoke_requires_explicit_quota_consent(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SMOKE), "--aide", "codex"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("yes-consume-provider-quota", result.stderr)


class WorkflowRegressionTest(unittest.TestCase):
    def test_gitee_tag_sync_never_updates_main(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "sync-to-gitee.yml").read_text(encoding="utf-8")
        self.assertIn('if [[ "$GITHUB_REF_TYPE" == "branch" && "$GITHUB_REF_NAME" == "main" ]]', workflow)
        self.assertIn("git push gitee HEAD:refs/heads/main --force", workflow)
        self.assertIn("refs/tags/${GITHUB_REF_NAME}:refs/tags/${GITHUB_REF_NAME}", workflow)
        tag_section = workflow.split('elif [[ "$GITHUB_REF_TYPE" == "tag" ]]', 1)[1]
        self.assertNotIn("refs/heads/main", tag_section.split("else", 1)[0])


if __name__ == "__main__":
    unittest.main()
