import importlib.util
import json
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT_SCRIPT = ROOT / "scripts" / "design-contract.py"
INSPECT_SCRIPT = ROOT / "scripts" / "inspect-project.py"
PREVIEW_SCRIPT = ROOT / "scripts" / "run-preview.py"
VERIFY_SCRIPT = ROOT / "scripts" / "verify-ui.py"
VISUAL_SCRIPT = ROOT / "scripts" / "visual-diff.py"


def load_module(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ProjectIntelligenceTest(unittest.TestCase):
    def test_detects_stack_structure_and_risks(self) -> None:
        module = load_module("inspect_project", INSPECT_SCRIPT)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "name": "fixture",
                        "dependencies": {"react": "latest", "zustand": "latest"},
                        "devDependencies": {"vite": "latest", "@playwright/test": "latest"},
                        "scripts": {"lint": "eslint .", "typecheck": "tsc --noEmit"},
                    }
                ),
                encoding="utf-8",
            )
            (root / "package-lock.json").touch()
            component = root / "src" / "components" / "ReviewPanel.tsx"
            component.parent.mkdir(parents=True)
            component.write_text("export const ReviewPanel = () => null;", encoding="utf-8")
            route = root / "src" / "routes" / "review.tsx"
            route.parent.mkdir(parents=True)
            route.write_text("export default null;", encoding="utf-8")
            (root / "src" / "theme.ts").write_text("export const theme = {};", encoding="utf-8")

            report = module.scan_project(root)

        self.assertTrue(report["package"]["present"])
        self.assertEqual(report["package"]["packageManager"], "npm")
        self.assertEqual(report["capabilities"]["frameworks"], ["React", "Vite"])
        self.assertEqual(report["capabilities"]["stateLibraries"], ["Zustand"])
        self.assertIn("src/components/ReviewPanel.tsx", report["structure"]["components"])
        self.assertIn("src/routes/review.tsx", report["structure"]["routes"])
        self.assertIn("no accessibility engine detected", report["risks"])

    def test_empty_package_json_is_still_present(self) -> None:
        module = load_module("inspect_project_empty", INSPECT_SCRIPT)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            (root / "package.json").write_text("{}", encoding="utf-8")
            report = module.scan_project(root)
        self.assertTrue(report["package"]["present"])

    def test_non_object_package_json_is_reported_instead_of_crashing(self) -> None:
        module = load_module("inspect_project_list", INSPECT_SCRIPT)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            (root / "package.json").write_text("[]", encoding="utf-8")
            report = module.scan_project(root)
        self.assertIn("package.json could not be parsed", report["risks"])


class DesignContractTest(unittest.TestCase):
    def run_contract(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(CONTRACT_SCRIPT), *args],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )

    def test_init_creates_valid_draft_but_approval_gate_blocks(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            contract = root / "contract.json"
            initialized = self.run_contract("init", "--out", str(contract))
            valid = self.run_contract("validate", str(contract), "--project-root", str(root))
            blocked = self.run_contract(
                "validate",
                str(contract),
                "--project-root",
                str(root),
                "--require-approved",
            )
        self.assertEqual(initialized.returncode, 0, initialized.stderr)
        self.assertEqual(valid.returncode, 0, valid.stdout)
        self.assertEqual(blocked.returncode, 1)
        self.assertIn("contract is not approved", blocked.stdout)

    def test_missing_state_coverage_is_rejected(self) -> None:
        module = load_module("design_contract", CONTRACT_SCRIPT)
        contract = module.contract_template()
        contract["requiredStates"].append("forbidden")
        errors = module.semantic_validate(contract, ROOT, False)
        self.assertIn("required states without flow coverage: forbidden", errors)

    def test_approved_contract_requires_evidence(self) -> None:
        module = load_module("design_contract_approval", CONTRACT_SCRIPT)
        contract = module.contract_template()
        contract["contractStatus"] = "approved"
        errors = module.semantic_validate(contract, ROOT, True)
        self.assertIn("approved contracts require approval.direction", errors)
        self.assertIn("approved contracts require at least one approval artifact", errors)

    def test_malformed_collection_fields_report_errors_without_crashing(self) -> None:
        module = load_module("design_contract_malformed", CONTRACT_SCRIPT)
        contract = module.contract_template()
        contract["flows"] = 1
        contract["breakpoints"] = "wide"
        contract["dataContracts"] = {}
        schema_errors = module.fallback_validate(contract)
        semantic_errors = module.semantic_validate(contract, ROOT, False)
        self.assertTrue(schema_errors)
        self.assertIsInstance(semantic_errors, list)


@unittest.skipUnless(shutil.which("python3"), "python3 is required")
class ManagedPreviewTest(unittest.TestCase):
    def test_process_identity_rejects_a_mismatched_start_marker(self) -> None:
        module = load_module("run_preview", PREVIEW_SCRIPT)
        self.assertFalse(module.process_matches({"pid": 1, "processStart": "wrong"}))

    def test_start_status_stop_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            (root / "index.html").write_text("<h1>Preview</h1>", encoding="utf-8")
            state = root / "preview.json"
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            command = f"{sys.executable} -m http.server {port} --bind 127.0.0.1"
            base = [sys.executable, str(PREVIEW_SCRIPT)]
            start = subprocess.run(
                [
                    *base,
                    "start",
                    "--command",
                    command,
                    "--url",
                    f"http://127.0.0.1:{port}",
                    "--cwd",
                    str(root),
                    "--state",
                    str(state),
                    "--browser",
                    "never",
                    "--wait",
                    "5",
                ],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            try:
                status = subprocess.run(
                    [*base, "status", "--state", str(state)],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                )
            finally:
                stop = subprocess.run(
                    [*base, "stop", "--state", str(state)],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                )
        self.assertEqual(start.returncode, 0, start.stderr)
        self.assertIn("Preview: running", start.stdout)
        self.assertEqual(status.returncode, 0, status.stdout)
        self.assertEqual(stop.returncode, 0, stop.stderr)
        self.assertIn("Preview: stopped", stop.stdout)

    def test_start_rejects_an_unhealthy_url_and_cleans_up(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            state = root / "preview.json"
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            command = f"{sys.executable} -m http.server {port} --bind 127.0.0.1"
            result = subprocess.run(
                [
                    sys.executable,
                    str(PREVIEW_SCRIPT),
                    "start",
                    "--command",
                    command,
                    "--url",
                    f"http://127.0.0.1:{port}/missing",
                    "--cwd",
                    str(root),
                    "--state",
                    str(state),
                    "--browser",
                    "never",
                    "--wait",
                    "0.3",
                ],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            state_exists = state.exists()
        self.assertEqual(result.returncode, 1)
        self.assertIn("health check timed out", result.stderr)
        self.assertFalse(state_exists)


class VisualDiffTest(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("PIL"), "Pillow is required")
    def test_pixel_tolerance_and_difference_ratio(self) -> None:
        from PIL import Image

        module = load_module("visual_diff", VISUAL_SCRIPT)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            baseline = root / "baseline.png"
            current = root / "current.png"
            diff = root / "diff.png"
            Image.new("RGB", (10, 10), "white").save(baseline)
            image = Image.new("RGB", (10, 10), "white")
            image.putpixel((0, 0), (0, 0, 0))
            image.save(current)
            result = module.compare_images(baseline, current, diff, pixel_threshold=16)
            diff_exists = diff.exists()
        self.assertTrue(result["comparable"])
        self.assertEqual(result["differentPixels"], 1)
        self.assertAlmostEqual(result["ratio"], 0.01)
        self.assertTrue(diff_exists)


class VerifyUiSurfaceTest(unittest.TestCase):
    def test_help_does_not_require_playwright(self) -> None:
        result = subprocess.run(
            [sys.executable, str(VERIFY_SCRIPT), "--help"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("contract-driven frontend", result.stdout)

    def test_local_file_flow_joining(self) -> None:
        module = load_module("verify_ui", VERIFY_SCRIPT)
        base = (ROOT / "tests" / "fixtures" / "quality" / "index.html").as_uri()
        self.assertEqual(module.join_target(base, "/"), base)
        self.assertEqual(module.join_target(base, "/?state=loading"), f"{base}?state=loading")
        self.assertTrue(module.join_target(base, "other.html").endswith("/other.html"))

    def test_accessible_name_rules_are_enforced_independently(self) -> None:
        module = load_module("verify_ui_names", VERIFY_SCRIPT)
        result = {
            "violations": [
                {"id": "button-name"},
                {"id": "color-contrast"},
                {"id": "link-name"},
            ]
        }
        self.assertEqual(
            module.accessible_name_violations(result),
            ["button-name", "link-name"],
        )

    def test_missing_explicit_lighthouse_command_is_not_treated_as_available(self) -> None:
        module = load_module("verify_ui_lighthouse", VERIFY_SCRIPT)
        self.assertIsNone(module.resolve_command("/definitely/missing/lighthouse", "lighthouse"))

    def test_lighthouse_spawn_failure_returns_structured_result(self) -> None:
        module = load_module("verify_ui_lighthouse_spawn", VERIFY_SCRIPT)
        with tempfile.TemporaryDirectory() as temp_dir:
            result = module.run_lighthouse(
                "/definitely/missing/lighthouse",
                "http://127.0.0.1:1",
                pathlib.Path(temp_dir) / "report.json",
            )
        self.assertFalse(result["available"])
        self.assertFalse(result["passed"])
        self.assertIn("No such file", result["error"])


if __name__ == "__main__":
    unittest.main()
