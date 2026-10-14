"""Explicit retry of a completed experiment's cleanup, never changing task outcomes."""
import json
from pathlib import Path
import sys
import time
from core import Store, TERMINAL, rpc

config = json.loads(Path('/setup/controller.json').read_text())
store = Store(config['database'])
run = store.run(sys.argv[1])
assert run['state'] in ('FINISHED', 'ERROR')
assert all(t['state'] in TERMINAL for t in store.tasks(run['id']))
counts = {'terminals': [], 'nodes': []}
for terminal in config['terminals']:
    counts['terminals'].append(rpc(terminal['url'], config['token'], '/cleanup', {'runId': run['id']}))
for node in config['nodes']:
    counts['nodes'].append(rpc(node, config['token'], '/cleanup', {'runId': run['id']}, timeout=120))
run.update(cleanup='DONE', cleanupCounts=counts, cleanupRetriedAt=time.time())
store.save_run(run)
print(json.dumps(counts))
