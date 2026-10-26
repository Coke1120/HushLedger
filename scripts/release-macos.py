"""Validate actual macOS app downloads, then publish a fully populated release."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import stat
import struct
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import zipfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def version_for(tag):
    require(re.fullmatch(r"v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?", tag), "Invalid release tag")
    return tag[1:]


def digest(stream):
    result = hashlib.sha256()
    count = 0
    while chunk := stream.read(1024 * 1024):
        result.update(chunk)
        count += len(chunk)
    return result.hexdigest(), count


def file_digest(path):
    with path.open("rb") as stream:
        return digest(stream)[0]


def arm64(header):
    magic = header[:4]
    if magic in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf"):
        endian = "<" if magic == b"\xcf\xfa\xed\xfe" else ">"
        return struct.unpack(endian + "I", header[4:8])[0] == 0x0100000C
    return False


def verify(directory, tag, commit, preview=False):
    version = version_for(tag)
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "Expected a full source commit")
    directory = Path(directory)
    stem = "HushLedger-" + version + "-macos-arm64"
    paths = [directory / (stem + suffix) for suffix in (".zip", ".build.json", ".README.txt", ".sha256")]
    require(all(path.is_file() and not path.is_symlink() for path in paths), "Missing release download or sidecar")
    require(all(0 < path.stat().st_size <= 512 * 1024 * 1024 for path in paths), "Invalid release download size")
    checksums = {}
    for line in paths[3].read_text().splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9._-]+)", line)
        require(match and match[2] not in checksums, "Invalid or duplicate checksum entry")
        checksums[match[2]] = match[1]
    require(set(checksums) == {path.name for path in paths[:3]}, "Checksum manifest must cover exactly the ZIP, metadata and README")
    require(all(file_digest(path) == checksums[path.name] for path in paths[:3]), "Release download checksum mismatch")
    manifest = json.loads(paths[1].read_text())
    require(manifest.get("releaseVersion") == version and manifest.get("version") == version.split("-")[0], "Build version mismatch")
    require(manifest.get("sourceCommit") == commit, "Build source does not match expected commit")
    require(manifest.get("sourceRef") == tag or (preview and manifest.get("sourceRef") is None), "Build source does not match release tag")
    require(manifest.get("sourceDirty") is False, "Release source must be clean")
    require(re.fullmatch(r"[0-9a-f]{64}", manifest.get("sourceTreeSha256", "")), "Missing source tree provenance")
    require(manifest.get("architecture") == "arm64", "Expected an arm64 build")
    require(manifest.get("signing") == "ad-hoc" and manifest.get("notarized") is False, "Unexpected signing policy")
    require("ad-hoc" in paths[2].read_text() and "notariz" in paths[2].read_text(), "Missing distribution limitations")
    root = "HushLedger.app/Contents/"
    resources = root + "Resources/"
    executables = [
        root + "MacOS/HushLedger",
        resources + "bin/node",
        resources + "server/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd",
    ]
    required = set(executables + [
        root + "Info.plist", root + "_CodeSignature/CodeResources",
        resources + "build.json", resources + "AppIcon.icns", resources + "messages.json",
        resources + "server.mjs", resources + "lifecycle.mjs", resources + "LICENSE",
        resources + "server/config.json", resources + "server/worker/custom-worker.js",
        resources + "server/node_modules/wrangler/bin/wrangler.js",
        resources + "server/scripts/private-local-state.cjs",
        resources + "server/migrations/0022_paste_approvals.sql",
    ])
    with zipfile.ZipFile(paths[0]) as archive:
        entries = archive.infolist()
        require(len(entries) <= 100_000 and sum(item.file_size for item in entries) <= 2 * 1024**3, "App archive exceeds limits")
        names = {item.filename for item in entries}
        require(len(names) == len(entries) and required <= names, "ZIP must contain the actual complete HushLedger.app")
        require(all(archive.getinfo(name).file_size > 0 for name in required), "Empty required app resource")
        for item in entries:
            name = PurePosixPath(item.filename)
            require(not name.is_absolute() and ".." not in name.parts and "\\" not in item.filename, "Unsafe ZIP path")
            require(item.filename.startswith("HushLedger.app/") and not stat.S_ISLNK(item.external_attr >> 16), "Unexpected ZIP entry")
            require(item.file_size <= 512 * 1024 * 1024, "Oversized app resource")
        for executable in executables:
            require(archive.getinfo(executable).external_attr >> 16 & 0o111, "App executable lost its executable mode")
            with archive.open(executable) as stream:
                require(arm64(stream.read(8)), "Executable is not an arm64 Mach-O binary")
        require(archive.getinfo(root + "Info.plist").file_size <= 64 * 1024, "Oversized app metadata")
        plist = plistlib.loads(archive.read(root + "Info.plist"))
        require(plist.get("CFBundleIdentifier") == "app.hushledger.desktop" and plist.get("CFBundleExecutable") == "HushLedger", "App identity mismatch")
        require(plist.get("CFBundlePackageType") == "APPL" and plist.get("CFBundleShortVersionString") == version.split("-")[0], "App bundle version mismatch")
        require(plist.get("HushLedgerReleaseVersion") == version, "App release version mismatch")
        require(plist.get("LSMinimumSystemVersion") == manifest.get("minimumMacOS") == "13.5", "Minimum macOS mismatch")
        require(archive.getinfo(resources + "build.json").file_size <= 64 * 1024, "Oversized build metadata")
        require(json.loads(archive.read(resources + "build.json")) == manifest, "Embedded provenance differs from download sidecar")
        with archive.open(resources + "server/worker/custom-worker.js") as stream:
            require(digest(stream)[0] == manifest.get("workerSha256"), "Bundled Worker checksum mismatch")
        require(any(name.startswith(resources + "server/assets/") and not name.endswith("/") for name in names), "Missing bundled web assets")
        require(archive.testzip() is None, "Corrupt app ZIP")
    return {path.name: {"path": path, "sha256": file_digest(path), "size": path.stat().st_size} for path in paths}


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        require(urllib.parse.urlsplit(url).scheme == "https", "Refusing a non-HTTPS download redirect")
        redirected = super().redirect_request(request, response, code, message, headers, url)
        if urllib.parse.urlsplit(request.full_url).netloc != urllib.parse.urlsplit(url).netloc:
            redirected.remove_header("Authorization")
        return redirected


class GitHub:
    def __init__(self, repository, token):
        require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository), "Invalid repository")
        require(token, "GITHUB_TOKEN is required for publication")
        self.base = "https://api.github.com/repos/" + repository
        self.upload_base = "https://uploads.github.com/repos/" + repository
        self.headers = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "HushLedger-release"}
        self.opener = urllib.request.build_opener(SafeRedirect())

    def json(self, method, endpoint, value=None):
        headers = dict(self.headers)
        data = None
        if value is not None:
            data = json.dumps(value).encode()
            headers["Content-Type"] = "application/json"
        with self.opener.open(urllib.request.Request(self.base + endpoint, data=data, headers=headers, method=method), timeout=120) as response:
            return json.load(response)

    def tag_commit(self, tag):
        item = self.json("GET", "/git/ref/tags/" + urllib.parse.quote(tag, safe=""))["object"]
        for _ in range(5):
            if item["type"] == "commit":
                return item["sha"]
            require(item["type"] == "tag", "Release tag must resolve to a commit")
            item = self.json("GET", "/git/tags/" + item["sha"])["object"]
        raise ValueError("Release tag nesting exceeds limit")

    def upload(self, release_id, path):
        headers = dict(self.headers, **{"Content-Type": "application/zip" if path.suffix == ".zip" else "application/octet-stream"})
        url = self.upload_base + "/releases/" + str(release_id) + "/assets?name=" + urllib.parse.quote(path.name, safe="")
        with self.opener.open(urllib.request.Request(url, data=path.read_bytes(), headers=headers, method="POST"), timeout=300) as response:
            return json.load(response)

    def downloaded_digest(self, asset):
        headers = dict(self.headers, Accept="application/octet-stream")
        with self.opener.open(urllib.request.Request(self.base + "/releases/assets/" + str(asset["id"]), headers=headers), timeout=300) as response:
            return digest(response)


def publish(directory, tag, commit, api, notes):
    files = verify(directory, tag, commit)
    require(api.tag_commit(tag) == commit, "Remote release tag moved")
    require(api.json("GET", "/git/ref/heads/main")["object"]["sha"] == commit, "Release source must be current main")
    checks = api.json("GET", "/commits/" + commit + "/check-runs?per_page=100")["check_runs"]
    require(any(item["name"] == "verify" and item["head_sha"] == commit
                and item["status"] == "completed" and item["conclusion"] == "success"
                for item in checks), "Current main must pass its complete CI verify gate")
    try:
        release = api.json("GET", "/releases/tags/" + tag)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        drafts = [item for item in api.json("GET", "/releases?per_page=100") if item["tag_name"] == tag]
        require(len(drafts) <= 1, "Ambiguous existing release")
        release = drafts[0] if drafts else api.json("POST", "/releases", {
            "tag_name": tag, "target_commitish": commit, "name": "HushLedger " + tag,
            "draft": True, "prerelease": "-" in version_for(tag), "body": notes,
        })
    require(release["draft"], "Refusing to modify an already published release")
    release_id = release["id"]
    assets = api.json("GET", "/releases/" + str(release_id) + "/assets?per_page=100")
    require(len({asset["name"] for asset in assets}) == len(assets), "Duplicate remote asset names")
    require({asset["name"] for asset in assets} <= set(files), "Unexpected assets in draft release")
    existing = {asset["name"]: asset for asset in assets}
    for name, expected in files.items():
        asset = existing.get(name) or api.upload(release_id, expected["path"])
        require(asset["state"] == "uploaded" and asset["size"] == expected["size"], "Incomplete uploaded release asset")
        require(asset.get("digest") in (None, "sha256:" + expected["sha256"]), "Remote release digest mismatch")
        actual_digest, actual_size = api.downloaded_digest(asset)
        require(actual_digest == expected["sha256"] and actual_size == expected["size"], "Downloaded release asset differs from verified build")
    # Confirm the tag and main source again after the uploads.
    require(api.tag_commit(tag) == commit, "Remote release tag moved during upload")
    require(api.json("GET", "/git/ref/heads/main")["object"]["sha"] == commit, "Main moved during release upload")
    return api.json("PATCH", "/releases/" + str(release_id), {"draft": False})


def preflight(tag):
    version = version_for(tag)
    git = lambda *args: subprocess.check_output(["git", *args], text=True).strip()
    commit = git("rev-parse", "HEAD")
    require(git("rev-parse", "refs/tags/" + tag + "^{commit}") == commit, "Checkout does not match release tag")
    require(git("rev-parse", "origin/main") == commit, "Only current main can be released")
    require(git("status", "--porcelain") == "", "Release checkout must be clean")
    package = json.loads(Path("package.json").read_text())
    require(package["version"] == version, "Tag does not match package.json")
    require(all(name in package["scripts"] for name in ("package:macos", "archive:macos", "smoke:macos", "test:macos")), "Approved macOS packaging source must be merged first")
    return commit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("source", "verify", "verify-preview", "publish"))
    parser.add_argument("--tag")
    parser.add_argument("--commit")
    parser.add_argument("--directory", default="dist/macos")
    args = parser.parse_args()
    if args.mode == "verify-preview":
        tag = "v" + json.loads(Path("package.json").read_text())["version"]
        files = verify(args.directory, tag, args.commit, preview=True)
        print("Verified preview app ZIP and provenance:", ", ".join(files))
        return
    require(args.tag is not None, "A release tag is required")
    if args.mode == "source":
        commit = preflight(args.tag)
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write("source_sha=" + commit + "\ntag=" + args.tag + "\n")
        print("Verified release source", args.tag, commit)
    elif args.mode == "verify":
        files = verify(args.directory, args.tag, args.commit)
        print(json.dumps({name: {key: value for key, value in info.items() if key != "path"} for name, info in files.items()}, indent=2))
    else:
        version = version_for(args.tag)
        notes = Path("docs/releases/" + version + ".md").read_text()
        repository = os.environ["GITHUB_REPOSITORY"]
        notes += "\n\nVerified source: https://github.com/" + repository + "/commit/" + args.commit + "\n"
        result = publish(args.directory, args.tag, args.commit, GitHub(repository, os.environ["GITHUB_TOKEN"]), notes)
        print("Published verified app release:", result["html_url"])


if __name__ == "__main__":
    main()
