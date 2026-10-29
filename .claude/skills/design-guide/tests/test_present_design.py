import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "present-design.py"


class PresentDesignIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp_dir.name)
        self.first = self.root / "Direction A v0.html"
        self.second = self.root / "方向 B v0.html"
        self.first.write_text("<h1>Direction A</h1>", encoding="utf-8")
        self.second.write_text("<h1>Direction B</h1>", encoding="utf-8")
        self.state = self.root / "presentation.json"

    def tearDown(self) -> None:
        subprocess.run(
            [sys.executable, str(SCRIPT), "stop", "--state", str(self.state)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
        self.temp_dir.cleanup()

    def run_script(self, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            capture_output=True,
            text=True,
            timeout=8,
            env=env,
            check=False,
        )

    def test_open_multiple_files_returns_without_browser(self) -> None:
        result = self.run_script(
            "open",
            str(self.first),
            str(self.second),
            "--browser",
            "never",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Direction%20A%20v0.html", result.stdout)
        self.assertIn("%E6%96%B9%E5%90%91%20B%20v0.html", result.stdout)
        self.assertIn("Browser: skipped", result.stdout)

    def test_auto_browser_skips_remote_environment(self) -> None:
        env = os.environ.copy()
        for marker in (
            "CI",
            "CODESPACES",
            "REMOTE_CONTAINERS",
            "SSH_CLIENT",
            "SSH_CONNECTION",
            "SSH_TTY",
        ):
            env.pop(marker, None)
        env["SSH_CONNECTION"] = "127.0.0.1 1 127.0.0.1 2"
        result = self.run_script("open", str(self.first), env=env)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("remote/headless marker SSH_CONNECTION is set", result.stdout)

    def test_auto_browser_recognizes_ci_environment(self) -> None:
        env = os.environ.copy()
        env["CI"] = "true"
        result = self.run_script("open", str(self.first), env=env)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("remote/headless marker CI is set", result.stdout)

    def test_managed_server_serves_multiple_files_and_stops(self) -> None:
        start = self.run_script(
            "serve",
            str(self.first),
            str(self.second),
            "--browser",
            "never",
            "--state",
            str(self.state),
        )

        self.assertEqual(start.returncode, 0, start.stderr)
        self.assertIn("Server: running in background", start.stdout)
        state = json.loads(self.state.read_text(encoding="utf-8"))
        self.assertEqual(len(state["urls"]), 2)

        control_url = f"http://127.0.0.1:{state['port']}/__design_guide__/status"
        with self.assertRaises(urllib.error.HTTPError) as unauthorized:
            urllib.request.urlopen(control_url, timeout=2)
        self.assertEqual(unauthorized.exception.code, 403)

        bodies = []
        for url in state["urls"]:
            with urllib.request.urlopen(url, timeout=2) as response:
                self.assertEqual(response.status, 200)
                bodies.append(response.read().decode("utf-8"))
        self.assertEqual(bodies, ["<h1>Direction A</h1>", "<h1>Direction B</h1>"])

        status = self.run_script("status", "--state", str(self.state))
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertIn("Requested: Direction A v0.html", status.stdout)
        self.assertIn("Requested: 方向 B v0.html", status.stdout)

        stop = self.run_script("stop", "--state", str(self.state))
        self.assertEqual(stop.returncode, 0, stop.stderr)
        self.assertIn("Server: stopped", stop.stdout)
        self.assertFalse(self.state.exists())


if __name__ == "__main__":
    unittest.main()
