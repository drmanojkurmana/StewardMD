import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
CAPTURE_SCRIPT = ROOT / "scripts" / "capture-audit.py"
DETECT_SCRIPT = ROOT / "scripts" / "detect-frontend-env.sh"
SYNC_SCRIPT = ROOT / "scripts" / "sync-aide.sh"


def load_capture_module():
    spec = importlib.util.spec_from_file_location("capture_audit", CAPTURE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load capture-audit.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CaptureAuditTest(unittest.TestCase):
    def test_normalize_target_preserves_urls_and_resolves_files(self) -> None:
        module = load_capture_module()
        self.assertEqual(
            module.normalize_target("https://example.com/review"),
            "https://example.com/review",
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            artifact = pathlib.Path(temp_dir) / "Direction A.html"
            artifact.write_text("<h1>Direction A</h1>", encoding="utf-8")
            self.assertEqual(module.normalize_target(str(artifact)), artifact.as_uri())

    def test_help_does_not_require_playwright(self) -> None:
        result = subprocess.run(
            [sys.executable, str(CAPTURE_SCRIPT), "--help"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Capture desktop, tablet, and mobile screenshots", result.stdout)


class DetectFrontendEnvironmentTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node is required")
    def test_detects_package_tools_config_and_source_hints(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project = pathlib.Path(temp_dir)
            package = {
                "dependencies": {
                    "react": "latest",
                    "lucide-react": "latest",
                },
                "devDependencies": {
                    "vite": "latest",
                    "tailwindcss": "latest",
                },
                "scripts": {"dev": "vite", "build": "vite build"},
            }
            (project / "package.json").write_text(
                json.dumps(package), encoding="utf-8"
            )
            (project / "package-lock.json").touch()
            (project / "vite.config.ts").touch()
            (project / "src").mkdir()
            (project / "components").mkdir()

            result = subprocess.run(
                ["bash", str(DETECT_SCRIPT), str(project)],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("frameworks/tools: React, Vite, Tailwind", result.stdout)
        self.assertIn("icon libraries: lucide-react", result.stdout)
        self.assertIn("package manager: npm", result.stdout)
        self.assertIn("- vite.config.ts", result.stdout)
        self.assertIn("- src/", result.stdout)
        self.assertIn("- components/", result.stdout)


@unittest.skipUnless(shutil.which("rsync"), "rsync is required")
class SyncAideTest(unittest.TestCase):
    def test_syncs_all_targets_and_removes_private_or_generated_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            source = root / "source"
            target_home = root / "targets"
            source.mkdir()
            (source / "SKILL.md").write_text("# Test Skill\n", encoding="utf-8")
            (source / "public.txt").write_text("current\n", encoding="utf-8")
            for private_path in (
                source / ".git" / "config",
                source / ".codex" / "review.html",
                source / ".design-guide" / "profile.md",
                source / "__pycache__" / "cache.pyc",
            ):
                private_path.parent.mkdir(parents=True, exist_ok=True)
                private_path.write_text("private\n", encoding="utf-8")

            stale_target = target_home / ".claude" / "skills" / "design-guide"
            stale_target.mkdir(parents=True)
            (stale_target / "stale.txt").write_text("stale\n", encoding="utf-8")

            env = os.environ.copy()
            env["DESIGN_GUIDE_SRC"] = str(source)
            env["DESIGN_GUIDE_TARGET_HOME"] = str(target_home)
            result = subprocess.run(
                ["bash", str(SYNC_SCRIPT)],
                capture_output=True,
                text=True,
                timeout=10,
                env=env,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            for aide in (".codex", ".claude", ".cursor", ".qwen"):
                target = target_home / aide / "skills" / "design-guide"
                self.assertEqual(
                    (target / "SKILL.md").read_text(encoding="utf-8"),
                    "# Test Skill\n",
                )
                self.assertEqual(
                    (target / "public.txt").read_text(encoding="utf-8"),
                    "current\n",
                )
                self.assertFalse((target / ".git").exists())
                self.assertFalse((target / ".codex").exists())
                self.assertFalse((target / ".design-guide" / "profile.md").exists())
                self.assertFalse((target / "__pycache__").exists())
            self.assertFalse((stale_target / "stale.txt").exists())


if __name__ == "__main__":
    unittest.main()
