import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('production', Path(__file__).resolve().parents[1] / 'production.py')
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)

class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.sha = 'a' * 40
        self.ready = {'pid': 100, 'version': self.sha, 'failure': False, 'active': 2,
                      'ready': True, 'databaseReady': True, 'runnerRunning': True, 'draining': False}

    def test_ready_requires_exact_pid_sha_runner_and_database(self):
        profile.validate(self.ready, 100, self.sha)
        for key, value in [('pid', 101), ('version', 'b' * 40), ('failure', True), ('ready', False),
                           ('databaseReady', False), ('runnerRunning', False), ('draining', True), ('active', -1), ('active', True)]:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                profile.validate({**self.ready, key: value}, 100, self.sha)

    def test_drained_requires_no_active_handler_or_polling(self):
        state = {**self.ready, 'active': 0, 'ready': False, 'runnerRunning': False, 'draining': True}
        profile.validate(state, 100, self.sha, drained=True)
        for key, value in [('active', 1), ('runnerRunning', True), ('draining', False), ('ready', True)]:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                profile.validate({**state, key: value}, 100, self.sha, drained=True)

if __name__ == '__main__':
    unittest.main()
