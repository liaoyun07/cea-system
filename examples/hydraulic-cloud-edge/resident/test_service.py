import unittest
import numpy as np
from app import GROUPS
from service import State, pack, unpack, reference_for


class ResidentTest(unittest.TestCase):
    def setUp(self):
        self.ids = np.array([0, 1])
        self.reference = dict(cycle_ids=np.arange(3), center=np.ones((6,17,5)),
                              scale=np.ones((6,17,5)), calibration_ids=np.array([0]),
                              stable=np.ones(3, dtype=bool), healthy=np.ones(3, dtype=bool), unique_cycles=np.array(3))
        self.state = State('cloud', self.reference)

    def part(self, group):
        return dict(cycle_ids=self.ids, **{k: np.ones((2,6,5)) for k in GROUPS[group]})

    def test_waits_for_three_actual_parts_and_counts_once(self):
        for i, group in enumerate(GROUPS):
            self.state.add_part('a', group, self.part(group), 10)
            self.assertEqual(self.state.completed, int(i == 2))
        self.assertEqual(self.state.raw_bytes, 30)
        self.assertEqual(len(unpack(self.state.take('a', True))['cycle_ids']), 2)
        self.assertEqual(len(self.state.results), 0)
        with self.assertRaises(KeyError):
            self.state.take('a')

    def test_duplicate_part_rejected(self):
        self.state.add_part('a', 'edge-a', self.part('edge-a'), 10)
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.state.add_part('a', 'edge-a', self.part('edge-a'), 10)

    def test_unknown_cycle_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unknown'):
            reference_for(self.reference, np.array([9]))

    def test_mismatched_cycles_not_completed(self):
        self.state.add_part('a', 'edge-a', self.part('edge-a'), 10)
        self.state.add_part('a', 'edge-b', self.part('edge-b'), 10)
        part = self.part('edge-c'); part['cycle_ids'] = np.array([1, 0])
        with self.assertRaises(ValueError):
            self.state.add_part('a', 'edge-c', part, 10)
        self.assertEqual(self.state.completed, 0)

    def test_binary_round_trip(self):
        part = self.part('edge-a')
        actual = unpack(pack(part))
        for key in part:
            np.testing.assert_array_equal(actual[key], part[key])


if __name__ == '__main__':
    unittest.main()
