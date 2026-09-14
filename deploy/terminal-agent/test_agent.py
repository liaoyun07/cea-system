import json
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import Mock

from agent import Agent, Rejected


class AgentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.agent = Agent.__new__(Agent)
        self.agent.config = {"registryHosts": ["registry:5000"], "storageHosts": ["store:9000"]}
        self.agent.data = root / "data"
        self.agent.work = root / "work"
        self.agent.state = root / "state"
        for folder in (self.agent.data, self.agent.work, self.agent.state):
            folder.mkdir()
        self.agent.engine = Mock()
        self.agent.container = Mock(return_value=None)
        self.agent.grant = Mock(return_value=b"downloaded")
        self.file = {"fileId": str(uuid.uuid4()), "bytes": 4}
        (self.agent.data / self.file["fileId"]).write_bytes(b"data")
        self.name = "cea-" + str(uuid.uuid4()) + "-a1"
        self.request = {"name": self.name, "spec": {"image": "registry:5000/demo@sha256:" + "a" * 64,
            "command": ["python", "/app.py"], "environment": {}, "inputs": ["raw"], "outputs": ["result.json"]},
            "localFiles": {"raw": self.file}, "grants": {"inputs": {}, "inline": {}, "outputs": {"result.json": "http://store:9000/output"}}}

    def test_local_file_rejects_paths_size_changes_and_symlinks(self):
        self.assertEqual(b"data", self.agent.local_file(self.file).read_bytes())
        for value in ({**self.file, "bytes": 3}, {**self.file, "fileId": "../../etc/passwd"}, {**self.file, "bytes": True}):
            with self.assertRaises(Rejected):
                self.agent.local_file(value)
        path = self.agent.data / self.file["fileId"]
        path.unlink()
        path.symlink_to("/etc/passwd")
        with self.assertRaises(Rejected):
            self.agent.local_file(self.file)

    def test_local_start_does_not_transfer_raw_file(self):
        container = Mock(status="created")
        self.agent.engine.containers.create.return_value = container
        self.assertEqual("RUNNING", self.agent.step(self.request)["state"])
        self.agent.grant.assert_not_called()
        self.assertEqual(b"data", (self.agent.work / self.name / "in/raw").read_bytes())
        options = self.agent.engine.containers.create.call_args.kwargs
        self.assertEqual("none", options["network_mode"])
        self.assertTrue(options["read_only"])
        container.start.assert_called_once()

    def test_repeat_step_reuses_existing_container(self):
        container = Mock(status="running")
        self.agent.container.return_value = container
        self.assertEqual("RUNNING", self.agent.step(self.request)["state"])
        self.assertEqual("RUNNING", self.agent.step(self.request)["state"])
        self.agent.engine.containers.create.assert_not_called()
        container.start.assert_not_called()
        self.request["spec"]["command"] = ["other"]
        with self.assertRaises(Rejected):
            self.agent.step(self.request)

    def test_cancel_before_create_is_durable(self):
        self.assertEqual("CANCELLED", self.agent.cancel(self.name)["state"])
        self.assertEqual("CANCELLED", self.agent.step(self.request)["state"])
        self.agent.engine.containers.create.assert_not_called()

    def test_cancel_waits_until_actual_stop(self):
        container = Mock(status="running")
        container.stop.side_effect = lambda **kw: setattr(container, "status", "exited")
        self.agent.container.return_value = container
        self.assertEqual("CANCELLED", self.agent.cancel(self.name)["state"])
        container.stop.assert_called_once_with(timeout=5)

    def test_only_successful_bounded_json_is_published(self):
        container = Mock(status="exited", attrs={"State": {"ExitCode": 0}})
        self.agent.container.return_value = container
        path = self.agent.work / self.name / "out"
        path.mkdir(parents=True)
        (path / "result.json").write_text('{"count":4}')
        self.assertEqual("SUCCESS", self.agent.step(self.request)["state"])
        self.assertEqual("PUT", self.agent.grant.call_args.args[1])
        self.agent.grant.reset_mock()
        (path / "result.json").write_text("x" * 262145)
        self.assertEqual("FAILED", self.agent.step(self.request)["state"])
        self.agent.grant.assert_not_called()
        container.attrs["State"]["ExitCode"] = 7
        self.assertEqual("FAILED", self.agent.step(self.request)["state"])


if __name__ == "__main__":
    unittest.main()
