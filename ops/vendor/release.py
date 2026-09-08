#!/usr/bin/env python3
"""Build and verify immutable application artifacts; never execute artifact hooks.

Python 3.10+ standard library only. See --help for the small command interface.
Deployment callers must download the artifact from the expected successful CI run.
"""
import argparse
import contextlib
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile


class ReleaseError(Exception):
    pass


IDENTITY = ("schemaVersion", "app", "gitSha", "runId", "platform", "arch", "bunVersion")
MAX_FILES = 200000
MAX_BYTES = 8 * 1024 * 1024 * 1024


def digest_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical(data):
    return (json.dumps(data, sort_keys=True, separators=(",", ":")) + "\n").encode()


def check_identity(data):
    if data.get("schemaVersion") != 1:
        raise ReleaseError("unsupported manifest schema")
    for key, pattern in (("app", r"[a-z0-9][a-z0-9-]{0,63}"),
                         ("gitSha", r"[0-9a-f]{40}"), ("runId", r"[0-9]+"),
                         ("bunVersion", r"[0-9]+\.[0-9]+\.[0-9]+")):
        if not re.fullmatch(pattern, str(data.get(key, ""))):
            raise ReleaseError("invalid " + key)
    if data.get("platform") != "linux" or data.get("arch") not in ("x64", "arm64"):
        raise ReleaseError("unsupported target platform/architecture")


def safe_path(name):
    if not isinstance(name, str) or not name or "\\" in name or "\x00" in name:
        raise ReleaseError("invalid archive path")
    p = PurePosixPath(name)
    if p.is_absolute() or any(x in ("", ".", "..") for x in name.split("/")):
        raise ReleaseError("unsafe archive path: " + name)
    if any(x == ".git" or x == ".env" or x.startswith(".env.") for x in p.parts):
        raise ReleaseError("runtime secrets/Git metadata are not release payloads")
    return p


def normalized_link(name, target):
    if not isinstance(target, str) or not target or target.startswith("/") or "\\" in target or "\x00" in target:
        raise ReleaseError("unsafe symlink: " + name)
    parts = list(PurePosixPath(name).parent.parts)
    for part in target.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if not parts:
                raise ReleaseError("escaping symlink: " + name)
            parts.pop()
        else:
            parts.append(part)
    return "/".join(parts)


def validate_links(entries):
    def resolve(name, seen):
        parts = name.split("/") if name else []
        for i in range(1, len(parts) + 1):
            prefix = "/".join(parts[:i])
            e = entries.get(prefix)
            if e and e["type"] == "symlink":
                if prefix in seen or len(seen) > 40:
                    raise ReleaseError("cyclic symlink: " + prefix)
                dest = normalized_link(prefix, e["target"])
                tail = "/".join(parts[i:])
                return resolve("/".join(x for x in (dest, tail) if x), seen | {prefix})
        if name and name not in entries:
            raise ReleaseError("dangling symlink target: " + name)
        return name
    for name, entry in entries.items():
        for parent in PurePosixPath(name).parents:
            if str(parent) != "." and entries.get(str(parent), {}).get("type") != "directory":
                raise ReleaseError("non-directory archive parent: " + name)
        if entry["type"] == "symlink":
            resolve(name, set())


def inventory(source):
    entries = {}
    for current, dirs, files in os.walk(source, followlinks=False):
        for name in sorted(dirs + files):
            p = Path(current) / name
            relative = p.relative_to(source).as_posix()
            safe_path(relative)
            if relative == "manifest.json":
                raise ReleaseError("manifest.json is reserved")
            mode = p.lstat().st_mode
            entry = {"path": relative, "mode": stat.S_IMODE(mode) & 0o777}
            if stat.S_ISLNK(mode):
                entry.update(type="symlink", target=os.readlink(p))
            elif stat.S_ISDIR(mode):
                entry.update(type="directory")
            elif stat.S_ISREG(mode):
                entry.update(type="file", size=p.stat().st_size, sha256=digest_file(p))
            else:
                raise ReleaseError("unsupported source file: " + relative)
            entries[relative] = entry
    validate_links(entries)
    return entries


def stage(source, output, includes):
    """Copy an explicit runtime allowlist from a clean CI checkout, never its env."""
    source, output = Path(source).resolve(), Path(output).resolve()
    if not source.is_dir() or output.exists() or output.is_symlink():
        raise ReleaseError("staging requires an existing source and a new output directory")
    selected = []
    for name in includes:
        safe_path(name)
        p = source / name
        if not p.exists() and not p.is_symlink():
            raise ReleaseError("required runtime path missing: " + name)
        if output.is_relative_to(p) or any(p.is_relative_to(old) or old.is_relative_to(p) for old in selected):
            raise ReleaseError("overlapping staging paths")
        selected.append(p)
    output.mkdir(parents=True)
    def ignored(directory, names):
        return [name for name in names if name in (".git", ".DS_Store", "__pycache__", ".cache", ".env") or name.startswith(".env.")]
    for p in selected:
        destination = output / p.relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if p.is_symlink():
            destination.symlink_to(os.readlink(p))
        elif p.is_dir():
            shutil.copytree(p, destination, symlinks=True, ignore=ignored)
        else:
            shutil.copy2(p, destination)


def pack(source, output, identity):
    check_identity(identity)
    source, output = Path(source).resolve(), Path(output).resolve()
    if not source.is_dir() or output.is_relative_to(source):
        raise ReleaseError("output must be outside an existing staging directory")
    entries = inventory(source)
    if not entries:
        raise ReleaseError("empty release")
    manifest = {**identity, "files": [entries[k] for k in sorted(entries)]}
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=output.parent, prefix=".pack-")
    try:
        with os.fdopen(fd, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as gz, tarfile.open(fileobj=gz, mode="w|") as archive:
            payload = canonical(manifest)
            info = tarfile.TarInfo("manifest.json")
            info.size, info.mode = len(payload), 0o644
            archive.addfile(info, io.BytesIO(payload))
            for name in sorted(entries):
                e = entries[name]
                info = tarfile.TarInfo(name)
                info.mode = e["mode"]
                if e["type"] == "directory":
                    info.type = tarfile.DIRTYPE
                    archive.addfile(info)
                elif e["type"] == "symlink":
                    info.type, info.linkname = tarfile.SYMTYPE, e["target"]
                    archive.addfile(info)
                else:
                    info.size = e["size"]
                    with open(source / name, "rb") as stream:
                        archive.addfile(info, stream)
        os.replace(temporary, output)
        descriptor = {**identity, "archive": output.name, "sha256": digest_file(output)}
        output.with_name("release.json").write_bytes(canonical(descriptor))
        # Detect source changes during packing and validate our own output format.
        verify(output, descriptor, identity["app"], identity["gitSha"], identity["runId"], identity["arch"], identity["bunVersion"])
        return descriptor
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def verify(archive_path, descriptor, app, sha, run_id, expected_arch=None, expected_bun="1.2.21"):
    check_identity(descriptor)
    for key, expected in (("app", app), ("gitSha", sha), ("runId", str(run_id))):
        if descriptor[key] != expected:
            raise ReleaseError("artifact " + key + " does not match expected CI identity")
    if expected_arch and descriptor["arch"] != expected_arch:
        raise ReleaseError("artifact architecture differs from deployment target")
    if expected_bun and descriptor["bunVersion"] != expected_bun:
        raise ReleaseError("artifact Bun version differs from deployment target")
    if not re.fullmatch(r"[0-9a-f]{64}", str(descriptor.get("sha256", ""))):
        raise ReleaseError("invalid archive checksum")
    if Path(archive_path).name != descriptor.get("archive"):
        raise ReleaseError("archive filename mismatch")
    if digest_file(archive_path) != descriptor["sha256"]:
        raise ReleaseError("archive checksum mismatch")
    with tarfile.open(archive_path, "r:gz") as archive:
        members = {}
        size = 0
        for member in archive:
            name = member.name.rstrip("/") if member.isdir() else member.name
            safe_path(name)
            if name in members or len(members) >= MAX_FILES:
                raise ReleaseError("duplicate or excessive archive entries")
            if not (member.isfile() or member.isdir() or member.issym()):
                raise ReleaseError("unsupported archive entry: " + name)
            if member.mode & ~0o777:
                raise ReleaseError("unsafe file mode: " + name)
            size += member.size
            if size > MAX_BYTES or member.size < 0:
                raise ReleaseError("archive exceeds size limit")
            members[name] = member
        item = members.pop("manifest.json", None)
        if not item or not item.isfile() or item.size > 64 * 1024 * 1024:
            raise ReleaseError("missing or invalid manifest")
        try:
            manifest = json.load(archive.extractfile(item))
        except (ValueError, TypeError) as exc:
            raise ReleaseError("invalid manifest JSON") from exc
        if any(manifest.get(k) != descriptor[k] for k in IDENTITY):
            raise ReleaseError("manifest identity differs from external descriptor")
        entries = {}
        for entry in manifest.get("files", []):
            name = entry.get("path")
            safe_path(name)
            if name in entries:
                raise ReleaseError("duplicate manifest entry")
            entries[name] = entry
        if set(entries) != set(members):
            raise ReleaseError("archive contents differ from manifest")
        for name, e in entries.items():
            m = members[name]
            kind = "file" if m.isfile() else "directory" if m.isdir() else "symlink"
            if e.get("type") != kind or e.get("mode") != m.mode:
                raise ReleaseError("entry type/mode mismatch: " + name)
            if kind == "symlink" and e.get("target") != m.linkname:
                raise ReleaseError("symlink mismatch: " + name)
            if kind == "file":
                h = hashlib.sha256()
                stream = archive.extractfile(m)
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    h.update(chunk)
                if e.get("size") != m.size or e.get("sha256") != h.hexdigest():
                    raise ReleaseError("file checksum/size mismatch: " + name)
        validate_links(entries)
        return manifest


@contextlib.contextmanager
def locked(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    with open(root / ".release.lock", "a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ReleaseError("another release operation holds the lock") from exc
        yield


def check_existing(path, manifest, shared_paths=None):
    shared_paths = shared_paths or {}
    expected = {e["path"]: e for e in manifest["files"]}
    actual = {}
    for current, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            p = Path(current) / name
            rel = p.relative_to(path).as_posix()
            if rel in shared_paths:
                if not p.is_symlink() or os.readlink(p) != shared_paths[rel]:
                    raise ReleaseError("shared path binding changed")
                continue
            if rel == "manifest.json":
                continue
            actual[rel] = p
    for rel in shared_paths:
        if not (path / rel).is_symlink():
            raise ReleaseError("shared path binding is missing")
    if set(actual) != set(expected):
        raise ReleaseError("existing release contents changed")
    for rel, p in actual.items():
        e = expected[rel]
        mode = p.lstat().st_mode
        if e["type"] == "file":
            good = stat.S_ISREG(mode) and p.stat().st_size == e["size"] and digest_file(p) == e["sha256"]
        elif e["type"] == "directory":
            good = stat.S_ISDIR(mode)
        else:
            good = stat.S_ISLNK(mode) and os.readlink(p) == e["target"]
        if not good or (not p.is_symlink() and stat.S_IMODE(mode) != e["mode"]):
            raise ReleaseError("existing release changed: " + rel)


def prepare(archive, descriptor, root, app, sha, run_id, expected_arch=None, expected_bun="1.2.21"):
    manifest = verify(archive, descriptor, app, sha, run_id, expected_arch, expected_bun)
    root = Path(root).resolve()
    with locked(root):
        releases = root / "releases"
        releases.mkdir(exist_ok=True)
        destination = releases / (sha + "-" + descriptor["sha256"][:20])
        if destination.exists():
            if destination.is_symlink() or json.loads((destination / "manifest.json").read_text()) != manifest:
                raise ReleaseError("existing release identity changed")
            check_existing(destination, manifest, read_bindings(root, destination))
            return destination
        staging = Path(tempfile.mkdtemp(prefix=".staging-", dir=releases))
        try:
            with tarfile.open(archive, "r:gz") as source:
                entries = {e["path"]: e for e in manifest["files"]}
                for name, e in entries.items():
                    p = staging / name
                    if e["type"] == "directory":
                        p.mkdir(parents=True, exist_ok=True)
                for name, e in entries.items():
                    p = staging / name
                    if e["type"] == "file":
                        with open(p, "xb") as target, source.extractfile(name) as stream:
                            shutil.copyfileobj(stream, target)
                        p.chmod(e["mode"])
                for name, e in entries.items():
                    if e["type"] == "symlink":
                        (staging / name).symlink_to(e["target"])
                for name, e in sorted(entries.items(), reverse=True):
                    if e["type"] == "directory":
                        (staging / name).chmod(e["mode"])
            (staging / "manifest.json").write_bytes(canonical(manifest))
            check_existing(staging, manifest)
            staging.chmod(0o755)
            os.rename(staging, destination)
            return destination
        finally:
            if staging.exists():
                shutil.rmtree(staging)


def read_bindings(root, release):
    location = root / ".bindings" / (release.name + ".json")
    return json.loads(location.read_text()) if location.exists() else {}


def bind(root, release, links):
    root, release = Path(root).resolve(), Path(release).resolve()
    if release.parent != root / "releases" or not release.is_dir():
        raise ReleaseError("bindings require a prepared release")
    with locked(root):
        manifest = json.loads((release / "manifest.json").read_text())
        existing = read_bindings(root, release)
        check_existing(release, manifest, existing)
        desired = dict(existing)
        for value in links:
            name, separator, target = value.partition("=")
            if not separator or not name or "\\" in name or any(x in ("", ".", "..") for x in name.split("/")) or name.startswith("/"):
                raise ReleaseError("invalid shared link")
            if name in ("manifest.json", ".git") or name.startswith(".git/"):
                raise ReleaseError("reserved shared link")
            p, target_path = release / name, Path(target)
            if not target_path.is_absolute() or not target_path.exists() or target_path.resolve().is_relative_to(root / "releases"):
                raise ReleaseError("shared target must exist outside releases")
            if p.parent != release and not p.parent.is_dir():
                raise ReleaseError("shared link parent must already exist in payload")
            if p.parent.resolve() != p.parent or (p.exists() or p.is_symlink()) and name not in existing:
                raise ReleaseError("shared link would overwrite release payload")
            if name in existing and existing[name] != str(target_path):
                raise ReleaseError("existing release bindings are immutable")
            desired[name] = str(target_path)
        # Validate all additions before changing any path.
        for name, target in desired.items():
            if name not in existing:
                (release / name).symlink_to(target)
        directory = root / ".bindings"
        directory.mkdir(exist_ok=True)
        location = directory / (release.name + ".json")
        temporary = directory / (release.name + ".tmp")
        temporary.write_bytes(canonical(desired))
        os.replace(temporary, location)


def switch(current, target):
    if current.exists() and not current.is_symlink():
        raise ReleaseError("current must be a symlink, not an existing checkout")
    temporary = current.with_name(".current-" + str(os.getpid()))
    try:
        temporary.symlink_to(target)
        os.replace(temporary, current)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def save_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    with open(temporary, "wb") as stream:
        stream.write(canonical(value))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def finish(root, pending, outcome):
    save_json(root / "last-release.json", {**pending, "outcome": outcome})
    (root / "pending-release.json").unlink()


def status(root):
    root = Path(root)
    current = root / "current"
    return {"current": str(current.resolve()) if current.is_symlink() else None,
            "pending": json.loads((root / "pending-release.json").read_text()) if (root / "pending-release.json").exists() else None,
            "lastRelease": json.loads((root / "last-release.json").read_text()) if (root / "last-release.json").exists() else None}


def promote(root, release, hook_dir, rollback_policy="auto", hook_timeout=1800):
    root, release, hook_dir = Path(root).resolve(), Path(release).resolve(), Path(hook_dir).resolve()
    if release.parent != root / "releases" or not release.is_dir():
        raise ReleaseError("release must be a prepared child of releases")
    if hook_dir.is_relative_to(root / "releases") or not hook_dir.is_dir():
        raise ReleaseError("hooks must be trusted files outside release artifacts")
    for required in ("restart", "health"):
        if not (hook_dir / required).is_file():
            raise ReleaseError("missing trusted hook: " + required)
    with locked(root):
        if (root / "pending-release.json").exists():
            raise ReleaseError("unresolved pending release; inspect status and explicitly recover")
        current = root / "current"
        previous = current.resolve() if current.is_symlink() else None
        if previous and not previous.is_dir():
            raise ReleaseError("current target is missing")
        if current.exists() and not current.is_symlink():
            raise ReleaseError("current must be a symlink")
        manifest = json.loads((release / "manifest.json").read_text())
        check_identity(manifest)
        check_existing(release, manifest, read_bindings(root, release))
        env = {**os.environ, "RELEASE_ROOT": str(root), "RELEASE_DIR": str(release),
               "PREVIOUS_RELEASE": str(previous or ""), "RELEASE_SHA": manifest["gitSha"]}
        def hook(name, required=False):
            path = hook_dir / name
            if not path.exists() and not required:
                return
            if not path.is_file() or not os.access(path, os.X_OK) or path.is_symlink():
                raise ReleaseError("hook must be an executable regular file: " + name)
            subprocess.run([str(path)], env=env, check=True, timeout=hook_timeout)
        hook("preflight")
        if previous == release:
            hook("health", True)
            return
        pending = {"release": str(release), "previous": str(previous or ""),
                   "gitSha": manifest["gitSha"], "app": manifest["app"],
                   "rollbackPolicy": rollback_policy}
        save_json(root / "pending-release.json", pending)
        # A migration can partially succeed. If this hook fails/interruption occurs,
        # leave pending for explicit recovery instead of guessing DB compatibility.
        hook("before-switch")
        switched = False
        try:
            switch(current, release)
            switched = True
            hook("restart", True)
            hook("health", True)
            finish(root, pending, "healthy")
        except (subprocess.SubprocessError, OSError, ReleaseError) as exc:
            if switched and rollback_policy == "auto" and previous:
                switch(current, previous)
                env.update(RELEASE_DIR=str(previous), FAILED_RELEASE=str(release))
                previous_manifest = previous / "manifest.json"
                if previous_manifest.exists():
                    env["RELEASE_SHA"] = json.loads(previous_manifest.read_text())["gitSha"]
                try:
                    hook("rollback")
                    hook("restart", True)
                    hook("health", True)
                except (subprocess.SubprocessError, OSError, ReleaseError) as recovery:
                    raise ReleaseError("release failed; previous files restored but recovery hook failed") from recovery
                finish(root, pending, "rolled-back")
                raise ReleaseError("release failed; previous release restored and healthy") from exc
            if switched:
                raise ReleaseError("release failed; rollback unavailable/forbidden, roll forward or maintenance required") from exc
            raise


def recover(root, hook_dir, strategy, hook_timeout=1800):
    """Explicit operator action after checking migration compatibility; never automatic."""
    root, hook_dir = Path(root).resolve(), Path(hook_dir).resolve()
    if hook_dir.is_relative_to(root / "releases") or not hook_dir.is_dir():
        raise ReleaseError("recovery hooks must be outside artifacts")
    with locked(root):
        state = status(root)
        pending = state["pending"]
        if not pending:
            raise ReleaseError("no pending release to recover")
        candidate = Path(pending["release"])
        previous = Path(pending["previous"]) if pending["previous"] else None
        if state["current"] not in (str(candidate), str(previous) if previous else None):
            raise ReleaseError("current changed outside the pending operation")
        if strategy == "rollback" and (pending["rollbackPolicy"] != "auto" or not previous):
            raise ReleaseError("rollback forbidden/unavailable; roll forward after DB review")
        target = previous if strategy == "rollback" else candidate
        if target.parent != root / "releases" or not target.is_dir():
            raise ReleaseError("recovery target is not a prepared release")
        manifest = json.loads((target / "manifest.json").read_text())
        check_identity(manifest)
        check_existing(target, manifest, read_bindings(root, target))
        env = {**os.environ, "RELEASE_ROOT": str(root), "RELEASE_DIR": str(target),
               "PREVIOUS_RELEASE": str(previous or ""), "RELEASE_SHA": manifest["gitSha"],
               "FAILED_RELEASE": str(candidate)}
        for name in ("restart", "health"):
            p = hook_dir / name
            if not p.is_file() or p.is_symlink() or not os.access(p, os.X_OK):
                raise ReleaseError("missing trusted recovery hook: " + name)
        switch(root / "current", target)
        for name in (["rollback"] if strategy == "rollback" and (hook_dir / "rollback").exists() else []) + ["restart", "health"]:
            p = hook_dir / name
            if not p.is_file() or p.is_symlink() or not os.access(p, os.X_OK):
                raise ReleaseError("invalid trusted recovery hook: " + name)
            subprocess.run([str(p)], env=env, check=True, timeout=hook_timeout)
        finish(root, pending, "recovered-" + strategy)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("stage")
    p.add_argument("--source", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--include", action="append", required=True)
    p = commands.add_parser("pack")
    p.add_argument("--source", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--app", required=True)
    p.add_argument("--git-sha", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument("--platform", default="linux")
    p.add_argument("--arch", choices=("x64", "arm64"), required=True)
    p.add_argument("--bun-version", default="1.2.21")
    for command in ("verify", "prepare"):
        p = commands.add_parser(command)
        p.add_argument("--archive", required=True)
        p.add_argument("--descriptor", required=True)
        p.add_argument("--app", required=True)
        p.add_argument("--expected-sha", required=True)
        p.add_argument("--expected-run-id", required=True)
        p.add_argument("--expected-arch", choices=("x64", "arm64"))
        p.add_argument("--expected-bun-version", default="1.2.21")
        if command == "prepare":
            p.add_argument("--root", required=True)
    p = commands.add_parser("promote")
    p.add_argument("--root", required=True)
    p.add_argument("--release", required=True)
    p.add_argument("--hook-dir", required=True)
    p.add_argument("--rollback-policy", choices=("auto", "forbid"), default="auto")
    p.add_argument("--hook-timeout", type=int, default=1800)
    p = commands.add_parser("bind")
    p.add_argument("--root", required=True)
    p.add_argument("--release", required=True)
    p.add_argument("--link", action="append", required=True)
    p = commands.add_parser("status")
    p.add_argument("--root", required=True)
    p = commands.add_parser("recover", description="Explicit recovery only after reviewing migration compatibility; before-switch is not rerun.")
    p.add_argument("--root", required=True)
    p.add_argument("--hook-dir", required=True)
    p.add_argument("--strategy", choices=("rollback", "accept"), required=True)
    p.add_argument("--hook-timeout", type=int, default=1800)
    args = parser.parse_args()
    try:
        if args.command == "stage":
            stage(args.source, args.output, args.include)
            print("staged")
        elif args.command == "pack":
            result = pack(args.source, args.output, dict(schemaVersion=1, app=args.app, gitSha=args.git_sha,
                          runId=args.run_id, platform=args.platform, arch=args.arch, bunVersion=args.bun_version))
            print(json.dumps(result, sort_keys=True))
        elif args.command in ("verify", "prepare"):
            descriptor = json.loads(Path(args.descriptor).read_text())
            values = (args.archive, descriptor, args.app, args.expected_sha, args.expected_run_id, args.expected_arch, args.expected_bun_version)
            if args.command == "verify":
                verify(*values)
                print("verified")
            else:
                print(prepare(args.archive, descriptor, args.root, *values[2:]))
        elif args.command == "bind":
            bind(args.root, args.release, args.link)
            print("bound")
        elif args.command == "status":
            print(json.dumps(status(args.root), indent=2))
        elif args.command == "recover":
            recover(args.root, args.hook_dir, args.strategy, args.hook_timeout)
            print("recovered")
        else:
            promote(args.root, args.release, args.hook_dir, args.rollback_policy, args.hook_timeout)
            print("healthy")
    except (ReleaseError, OSError, ValueError, tarfile.TarError, subprocess.SubprocessError) as exc:
        print("release: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
