import copy
import importlib
import math
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "terminal-agent"))
sys.modules["legacy_load"] = importlib.import_module("load")
from core import Ledger, UploadLedger, choose, state_vector, trace, Store
from controller import Controller, summary
from execution import result_from_logs, Kubernetes, Docker
from terminal import PacedFile
from node import Node


class ProtocolTest(unittest.TestCase):
    def test_paired_poisson_trace(self):
        a = trace(31, "sim-terminal-001", 90, 10, ["small", "medium", "large"], [.6, .38, .02])
        self.assertEqual(a, trace(31, "sim-terminal-001", 90, 10, ["small", "medium", "large"], [.6, .38, .02]))
        self.assertNotEqual(a, trace(31, "sim-terminal-002", 90, 10, ["small", "medium", "large"], [.6, .38, .02]))
        self.assertTrue(all(0 < t["offset"] < 90 for t in a))
        self.assertEqual(sorted(x["offset"] for x in a), [x["offset"] for x in a])

    def test_random_does_not_exclude_large_files(self):
        places = {choose("RANDOM", {"seed": 31, "terminal": "t", "index": i, "bytes": 500_000_000}, [0] * 5) for i in range(60)}
        self.assertEqual({"TERMINAL", "EDGE", "CLOUD"}, places)
        self.assertEqual("TERMINAL", choose("LOCAL", {}, [0] * 5))

    def test_five_dimensions_and_no_old_weight_fallback(self):
        self.assertEqual([math.log1p(v) for v in [5, 10, 3, 50, 500]], state_vector(5e6, 10e6, 3, 50e6, 500e6))
        with self.assertRaises(ValueError):
            choose("DQN", {}, [0] * 5, {"stateSchema": "measured-offload-log1p-v1"})
        model = {"stateSchema": "offload-five-v1", "weights1": [[1] * 5], "bias1": [0], "weights2": [[0], [1], [0]], "bias2": [0, 0, 0]}
        self.assertEqual("EDGE", choose("DQN", {}, [1e6] * 5, model))
        model["weights1"][0].append(1)
        with self.assertRaises(ValueError):
            choose("DQN", {}, [0] * 5, model)

    def test_backlog_concurrent_and_reservation_release(self):
        ledger = Ledger()
        threads = [threading.Thread(target=ledger.accept, args=(str(i), 500)) for i in range(50)]
        for t in threads: t.start()
        for t in threads: t.join()
        ledger.accept("1", 500)
        self.assertEqual(25000, ledger.total())
        for i in range(50): ledger.finish(str(i))
        self.assertEqual(0, ledger.total())

    def test_single_upload_wait_counts_bytes_and_distance(self):
        link = UploadLedger(10)
        link.add("edge", 100, 1)
        link.add("cloud", 50, 5)
        self.assertEqual(21, link.wait())
        link.sent("edge", 40)
        self.assertEqual(17, link.wait())
        link.finish("edge")
        self.assertEqual(10, link.wait())

    def test_real_file_stream_paced_without_full_buffer(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "input"
            path.write_bytes(b"a" * 100)
            link = UploadLedger(100)
            link.add("task", 100, 0)
            with patch("terminal.time.sleep") as sleeping, patch("terminal.time.monotonic", return_value=5):
                stream = PacedFile(path, "task", link, 100)
                self.assertEqual(100, len(stream))
                self.assertEqual(b"a" * 40, stream.read(40))
                self.assertAlmostEqual(.4, sleeping.call_args.args[0])
                self.assertAlmostEqual(.6, link.wait())
                stream.stream.close()

    def test_end_to_end_and_stage_accounting_excludes_failures(self):
        task = {"state": "SUCCESS", "destination": "EDGE", "requestedAt": 10, "decidedAt": 11, "uploadStartedAt": 13,
                "uploadFinishedAt": 18, "readyAt": 18, "dispatchedAt": 20, "submittedAt": 21, "finishedAt": 31,
                "result": {"measurement": {"computeStartedAt": 24, "computeFinishedAt": 30}}}
        report = summary([task, {"state": "FAILED", "requestedAt": 12}])
        self.assertEqual(21, report["meanSeconds"])
        self.assertEqual(21, report["totalTaskSeconds"])
        self.assertEqual(1, report["failed"])
        self.assertEqual(3, report["stageMeanSeconds"]["startup"])
        self.assertEqual(6, report["stageMeanSeconds"]["compute"])

    def test_node_reserves_before_upload_and_releases_on_accept_error(self):
        node = Node.__new__(Node)
        node.config = {"id": "edge-a", "publicUrl": "http://edge"}
        node.ledger, node.store, node.url = Ledger(), Mock(), Mock(return_value="http://storage/input")
        answer = node.accept({"id": "t", "bytes": 500})
        self.assertEqual(500, node.ledger.total())
        self.assertEqual("UPLOADING", node.store.add.call_args.args[0]["state"])
        self.assertEqual("http://edge", answer["ownerUrl"])
        node.store.add.side_effect = ValueError("database unavailable")
        with self.assertRaises(ValueError): node.accept({"id": "u", "bytes": 100})
        self.assertEqual(500, node.ledger.total())

    def test_controller_saves_results_then_cleans_once_after_drain(self):
        controller = Controller.__new__(Controller)
        controller.config = {"terminals": [], "nodes": ["edge"], "token": "test"}
        controller.lock = threading.RLock()
        controller.pool = Mock()
        controller.pool.map.return_value = []
        controller.store = Mock()
        controller.store.tasks.return_value = []
        calls = []
        controller.store.save_run.side_effect = lambda r: calls.append(("save", r["state"], r["cleanup"]))
        controller.fleet = lambda path, data=None: calls.append((path,)) or []
        run = {"id": "oil-123456789abc", "state": "SENDING", "cleanup": "PENDING", "expected": 0}
        with patch("controller.rpc", side_effect=lambda *a, **k: calls.append(("node-clean",)) or {}):
            controller.drive(run)
        saved = calls.index(("save", "FINISHED", "PENDING"))
        self.assertLess(saved, calls.index(("/cleanup",)))
        self.assertLess(saved, calls.index(("node-clean",)))
        self.assertEqual("DONE", run["cleanup"])

    def test_worker_result_is_required(self):
        self.assertEqual({"samples": 10}, result_from_logs('diagnostic\nOFFLAB_RESULT={"samples":10}\n'))
        with self.assertRaises(RuntimeError): result_from_logs("completed")

    def test_live_strategy_change_and_stop_preserve_existing_task_records(self):
        controller = Controller.__new__(Controller)
        controller.lock = threading.RLock()
        controller.active = {"id": "oil-123456789abc", "strategy": "LOCAL", "changes": []}
        controller.store, controller.fleet = Mock(), Mock()
        controller.store.run.return_value = controller.active
        controller.handle("POST", "/runs/oil-123456789abc/strategy", {"strategy": "RANDOM"})
        controller.fleet.assert_called_with("/strategy", {"strategy": "RANDOM"})
        self.assertEqual("RANDOM", controller.active["strategy"])
        self.assertEqual(1, len(controller.active["changes"]))
        controller.handle("POST", "/runs/oil-123456789abc/stop", {})
        controller.fleet.assert_called_with("/stop", {})
        self.assertIn("stopRequestedAt", controller.active)
        controller.store.patch.assert_not_called()
        with self.assertRaises(ValueError):
            controller.handle("POST", "/runs/oil-123456789abc/strategy", {"strategy": "DQN"})

    def test_kubernetes_result_uses_pod_status_without_log_permission(self):
        node = Kubernetes.__new__(Kubernetes)
        node.ns = "test"
        node.config = {"taskTimeoutSeconds": 60, "image": "test:1", "cpuPerJob": .5, "memory": "512Mi"}
        node.call = Mock(side_effect=[{}, {"status": {"succeeded": 1}}, {"items": [{"status": {"containerStatuses": [
            {"name": "work", "state": {"terminated": {"message": '{"measurement":{"finishedAt":10}}'}}}
        ]}}]}])
        result = node.run({"id": "test-1", "runId": "oil-123456789abc"}, "http://input", "http://output", Mock())
        self.assertEqual(10, result["measurement"]["finishedAt"])
        self.assertTrue(all('/log' not in call.args[1] for call in node.call.call_args_list))
        spec = node.call.call_args_list[0].args[2]
        self.assertIn({"name": "TERMINATION_MESSAGE_PATH", "value": "/dev/termination-log"}, spec["spec"]["template"]["spec"]["containers"][0]["env"])

    def test_shared_docker_cleanup_scopes_both_run_and_terminal(self):
        with tempfile.TemporaryDirectory() as folder:
            node = Docker.__new__(Docker)
            node.config = {"id": "terminal-1", "work": folder}
            node.client = Mock()
            node.client.containers.list.return_value = []
            self.assertEqual(0, node.cleanup("oil-123456789abc"))
            labels = node.client.containers.list.call_args.kwargs["filters"]["label"]
            self.assertIn("cea.offload-terminal=terminal-1", labels)
            self.assertIn("cea.offload-run=oil-123456789abc", labels)

    def test_sql_connection_not_held_after_operation(self):
        import queue
        store = Store.__new__(Store)
        store.pool = queue.Queue()
        connection = Mock()
        cursor = Mock(description=None, rowcount=1)
        context = Mock()
        context.__enter__ = Mock(return_value=cursor)
        context.__exit__ = Mock(return_value=False)
        connection.cursor.return_value = context
        store.pool.put(connection)
        store.patch("task", {"state": "SUCCESS", "finishedAt": 10})
        self.assertEqual(1, store.pool.qsize())
        sql, args = cursor.execute.call_args.args
        self.assertIn("JSON_SET", sql)
        self.assertIn("state=%s", sql)
        self.assertEqual("task", args[-1])


if __name__ == "__main__":
    unittest.main()
