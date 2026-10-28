import json
import os
import pathlib
import subprocess
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def load_i18n():
    import importlib.util

    path = SCRIPTS / "i18n.py"
    spec = importlib.util.spec_from_file_location("design_guide_i18n", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class I18nContractTest(unittest.TestCase):
    def test_supported_catalogs_have_identical_keys(self) -> None:
        english = json.loads((ROOT / "locales/en.json").read_text(encoding="utf-8"))
        chinese = json.loads((ROOT / "locales/zh-CN.json").read_text(encoding="utf-8"))
        self.assertEqual(set(english), set(chinese))
        self.assertTrue(all(isinstance(value, str) and value for value in chinese.values()))

    def test_locale_precedence_and_aliases(self) -> None:
        i18n = load_i18n()
        self.assertEqual(i18n.resolve_locale(["--locale", "zh-CN"], {"DESIGN_GUIDE_LOCALE": "en"}), "zh-CN")
        self.assertEqual(i18n.resolve_locale([], {"DESIGN_GUIDE_LOCALE": "zh"}), "zh-CN")
        self.assertEqual(i18n.resolve_locale([], {"LANG": "en_US.UTF-8"}), "en")
        self.assertEqual(i18n.resolve_locale([], {"DESIGN_GUIDE_LOCALE": "fr"}), "en")

    def test_message_translation_and_fallback(self) -> None:
        i18n = load_i18n()
        self.assertEqual(i18n.t("Preview: running", "zh-CN"), "预览：运行中")
        self.assertEqual(i18n.t("untranslated message", "zh-CN"), "untranslated message")

    def test_cli_help_can_be_selected_in_chinese(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "present-design.py"), "--locale", "zh-CN", "--help"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("呈现本地 HTML 设计产物供用户评审", result.stdout)
        self.assertIn("输出语言", result.stdout)

    def test_json_mode_keeps_machine_keys_stable(self) -> None:
        env = os.environ.copy()
        env["DESIGN_GUIDE_LOCALE"] = "zh-CN"
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "design-guide-doctor.py"), "--json", "--source", str(ROOT), "--target-home", "/tmp/design-guide-i18n-test-home"],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertIn("versionConsistent", payload)
        self.assertIn("targets", payload)


if __name__ == "__main__":
    unittest.main()
