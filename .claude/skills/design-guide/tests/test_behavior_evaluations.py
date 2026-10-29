import importlib.util
import json
import pathlib
import subprocess
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "evaluate-review-output.py"
FIXTURES = ROOT / "tests" / "fixtures" / "review-behavior"


def load_module():
    spec = importlib.util.spec_from_file_location("evaluate_review_output", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load review evaluator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReviewBehaviorEvaluationTest(unittest.TestCase):
    def test_compliant_image_review_passes_without_inherited_goals(self) -> None:
        module = load_module()
        case = json.loads((FIXTURES / "image-review-isolated.json").read_text(encoding="utf-8"))
        response = (FIXTURES / "image-review-isolated-pass.md").read_text(encoding="utf-8")
        self.assertEqual(module.evaluate(case, response), [])

    def test_inherited_mobile_and_wechat_goals_fail(self) -> None:
        module = load_module()
        case = json.loads((FIXTURES / "image-review-isolated.json").read_text(encoding="utf-8"))
        response = (FIXTURES / "image-review-inherited-fail.md").read_text(encoding="utf-8")
        errors = module.evaluate(case, response)
        self.assertTrue(any("公众号" in error for error in errors))
        self.assertTrue(any("390x844" in error for error in errors))

    def test_desktop_url_contract_is_runnable_from_cli(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                str(FIXTURES / "desktop-url-isolated.json"),
                str(FIXTURES / "desktop-url-isolated-pass.md"),
                "--json",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(json.loads(result.stdout)["passed"])


if __name__ == "__main__":
    unittest.main()
