import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import Mock

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent / 'hpa'))
spec = importlib.util.spec_from_file_location('platform_adapter', HERE / 'adapter.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AdapterTest(unittest.TestCase):
    def service(self, pool='pool1', replicas=1):
        return {'metadata': {'name': 'demo', 'uid': 'service1', 'generation': 1}, 'spec': {'replicas': replicas, 'poolName': pool}}

    def test_claim_binds_only_business_pod_and_tracks_pool(self):
        claim = adapter.claim(self.service(), 'demo-000')
        self.assertEqual('pool1', claim['spec']['warmPoolRef']['name'])
        self.assertEqual('true', claim['spec']['additionalPodMetadata']['labels'][adapter.ONLINE])
        self.assertEqual('service1', claim['metadata']['ownerReferences'][0]['uid'])
        self.assertTrue(all(key.startswith('sandbox.users.io/') for key in claim['spec']['additionalPodMetadata']['labels']))

    def test_configuration_update_replaces_claim_without_reusing_old_template(self):
        k = Mock()
        controller = adapter.Adapter(k)
        old = adapter.claim(self.service(), 'demo-000')
        controller.services([self.service('pool2')], [old], [])
        self.assertTrue(any(c.args[1] == 'DELETE' for c in k.call.call_args_list))
        self.assertFalse(any(c.args[1] == 'POST' for c in k.call.call_args_list))
        controller.workers.shutdown()

    def test_new_service_uid_does_not_count_previous_pods(self):
        pod = {'metadata': {'labels': {adapter.POOL: 'pool1', adapter.ONLINE: 'true', adapter.SERVICE_UID: 'old'}}}
        self.assertEqual([], adapter.current_pods(self.service(), [pod]))

    def test_priority_uses_measured_cold_time_and_real_demand(self):
        from core import allocate
        apps = {'quick': {'coldSeconds': 1, 'memoryMiB': 128}, 'slow': {'coldSeconds': 12, 'memoryMiB': 512}}
        self.assertEqual({'quick': 0, 'slow': 0}, allocate(apps, {}, 1024, 4)[0])
        self.assertEqual({'quick': 0, 'slow': 2}, allocate(apps, {'quick': 3, 'slow': 2}, 1024, 4)[0])

    def test_cold_time_is_ready_minus_creation(self):
        pod = {'metadata': {'creationTimestamp': '2026-10-18T00:00:00Z'}, 'status': {'conditions': [{'type': 'Ready', 'status': 'True', 'lastTransitionTime': '2026-10-18T00:00:12Z'}]}}
        self.assertEqual(12, adapter.cold_seconds(pod))

    def test_memory_budget_accepts_kubernetes_decimal_and_binary_quantities(self):
        for value, expected in [('512Mi', 512 * 2**20), ('1G', 1e9), ('1e9', 1e9), ('1Ti', 2**40)]:
            self.assertEqual(expected, adapter.quantity(value))


if __name__ == '__main__':
    unittest.main()
