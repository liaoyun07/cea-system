"""Execute inside runtime image against an isolated disposable MySQL test database."""
import json
import os
import threading
import unittest
from core import Store


class SqlIntegration(unittest.TestCase):
    def test_shared_records_short_connections_and_atomic_patch(self):
        store = Store(json.loads(os.environ["TEST_DATABASE"]))
        store.initialize()
        store.save_run({"id": "oil-123456789abc", "state": "SENDING"})
        store.add({"id": "task", "runId": "oil-123456789abc", "owner": "edge-a", "state": "UPLOADING", "bytes": 50_000_000})
        errors = []
        def update(i):
            try: store.patch("task", {"stage" + str(i): i})
            except Exception as error: errors.append(error)
        threads = [threading.Thread(target=update, args=(i,)) for i in range(30)]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        self.assertEqual([], errors)
        store.patch("task", {"state": "SUCCESS", "result": {"samples": 5000000}})
        record = store.task("task")
        self.assertEqual("SUCCESS", record["state"])
        for i in range(30): self.assertEqual(i, record["stage" + str(i)])
        self.assertEqual(1, len(store.tasks("oil-123456789abc")))
        self.assertEqual("SENDING", store.run("oil-123456789abc")["state"])
        self.assertEqual(3, store.pool.qsize())
        self.assertEqual("SUCCESS", store.sql("SELECT state FROM offlab_tasks WHERE id='task'")[0]["state"])


if __name__ == '__main__': unittest.main()
