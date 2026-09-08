#!/usr/bin/env python3
"""Trusted host adapter: drain proven work before restarting a Node bot.

Installed root-owned outside the artifact. No application code runs as root.
Missing/stale readiness is a stop condition, including an uninstrumented baseline.
"""
import http.client
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path, timeout=5):
        super().__init__('localhost', timeout=timeout)
        self.socket_path = path
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


def request(path, endpoint, method='GET', timeout=5):
    conn = UnixHTTP(path, timeout)
    try:
        conn.request(method, endpoint)
        response = conn.getresponse()
        result = json.loads(response.read(65536))
        if response.status != 200:
            raise RuntimeError('Lifecycle endpoint is not ready')
        return result
    finally:
        conn.close()


def validate(state, pid, sha, drained=False):
    if not re.fullmatch(r'[a-f0-9]{40}', sha) or pid <= 0:
        raise RuntimeError('Invalid expected process identity')
    if state.get('pid') != pid or state.get('version') != sha or state.get('failure') is not False:
        raise RuntimeError('Stale or failed lifecycle identity')
    if type(state.get('active')) is not int or state['active'] < 0:
        raise RuntimeError('Invalid active-handler counter')
    if drained:
        if state.get('draining') is not True or state['active'] != 0 or state.get('runnerRunning') is not False or state.get('ready') is not False:
            raise RuntimeError('Bot has not finished draining')
    elif state.get('ready') is not True or state.get('databaseReady') is not True or state.get('runnerRunning') is not True or state.get('draining') is not False:
        raise RuntimeError('Bot dependencies are not ready')


def systemd(unit, prop):
    return subprocess.check_output(['systemctl', 'show', unit, '-p', prop, '--value'], text=True).strip()


def identity(root, unit):
    if systemd(unit, 'ActiveState') != 'active':
        raise RuntimeError('Bot unit must be running before normal deployment')
    return int(systemd(unit, 'MainPID')), (root / 'current' / 'RELEASE_SHA').read_text().strip()


def drain(root, unit, socket_path):
    pid, sha = identity(root, unit)
    validate(request(socket_path, '/ready'), pid, sha)
    validate(request(socket_path, '/drain', 'POST', 120), pid, sha, drained=True)
    if int(systemd(unit, 'MainPID')) != pid:
        raise RuntimeError('Bot process changed during drain')


def main():
    # This file is installed under an app-specific root-owned directory.
    app = Path(__file__).resolve().parent.name
    if not re.fullmatch(r'[a-z][a-z0-9-]{1,40}', app):
        raise RuntimeError('Invalid installed app profile')
    root = Path('/opt') / app
    unit = app + '.service'
    socket_path = '/run/' + app + '/lifecycle.sock'
    action = sys.argv[1]
    release = Path(os.environ['RELEASE_DIR']).resolve()
    sha = os.environ['RELEASE_SHA']
    if release.parent != (root / 'releases').resolve():
        raise RuntimeError('Release escaped app root')
    if action == 'preflight':
        if os.geteuid() != 0:
            raise RuntimeError('Trusted profile requires root supervisor access')
        if systemd(unit, 'User') != 'mahhis':
            raise RuntimeError('Unexpected runtime user')
        if subprocess.check_output(['/usr/bin/node', '--version'], text=True).strip() != 'v20.20.2':
            raise RuntimeError('Node runtime does not match CI')
        runtime = json.loads((release / 'runtime.json').read_text())
        if runtime != {'schemaVersion': 1, 'name': 'node', 'version': '20.20.2', 'platform': 'linux', 'arch': 'x64', 'artifactTool': {'name': 'bun', 'version': '1.2.21'}}:
            raise RuntimeError('Invalid runtime contract')
        if (release / 'RELEASE_SHA').read_text().strip() != sha:
            raise RuntimeError('Payload identity differs from manifest')
        for name in ('dist/app.js', 'dist/helpers/lifecycle.js', 'locales', 'package.json', 'node_modules', '.env'):
            if not (release / name).exists():
                raise RuntimeError('Missing runtime path: ' + name)
        for prop, value in (('SendSIGKILL', 'no'), ('KillSignal', '15')):
            if systemd(unit, prop) != value:
                raise RuntimeError('Unsafe systemd termination policy')
    elif action == 'before-switch':
        drain(root, unit, socket_path)
    elif action == 'restart':
        # Re-check the old process counter after current changes. POST drain was
        # acknowledged before switch, so this cannot kill an active bot handler.
        state = request(socket_path, '/status')
        pid = int(systemd(unit, 'MainPID'))
        old_sha = (Path(os.environ['PREVIOUS_RELEASE']) / 'RELEASE_SHA').read_text().strip()
        validate(state, pid, old_sha, drained=True)
        subprocess.run(['systemctl', 'restart', unit], check=True, timeout=90)
    elif action == 'health':
        deadline = time.monotonic() + 60
        while True:
            try:
                pid = int(systemd(unit, 'MainPID'))
                validate(request(socket_path, '/ready'), pid, sha)
                if Path('/proc', str(pid), 'cwd').resolve() != release:
                    raise RuntimeError('Runtime working directory differs from candidate')
                return
            except (OSError, ValueError, RuntimeError, http.client.HTTPException):
                if time.monotonic() >= deadline:
                    raise RuntimeError('Candidate did not become ready; no automatic rollback or kill')
                time.sleep(1)
    else:
        raise RuntimeError('Unknown deployment hook')


if __name__ == '__main__':
    main()
