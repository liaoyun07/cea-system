"""Replace only idle terminals owned by this new lab; preserve all files and cgroups."""
import json
from pathlib import Path
import docker
import requests
from concurrent.futures import ThreadPoolExecutor

root = Path('/sim/offload-lab')
config = json.loads((root / 'bootstrap.json').read_text())
client = docker.from_env()
containers = []
for item in config['terminals']:
    container = client.containers.get(item['id'])
    if container.labels.get('cea.offload-lab') != 'terminal':
        raise RuntimeError('unexpected owner')
    settings = json.loads((root / 'terminals' / (item['id'] + '.json')).read_text())
    address = container.attrs['NetworkSettings']['IPAddress']
    response = requests.get(f'http://{address}:8080/status', headers={'Authorization': 'Bearer ' + settings['token']}, timeout=10)
    response.raise_for_status()
    state = response.json()
    if state['sending'] or state['pending']:
        raise RuntimeError('terminal still has active work')
    containers.append(container)
def replace(container):
    container.stop(timeout=10)
    container.remove()
with ThreadPoolExecutor(max_workers=6) as pool:
    list(pool.map(replace, containers))
print('Removed only idle lab agent containers; their files and cgroups remain for replacement.')
