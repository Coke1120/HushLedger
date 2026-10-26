import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import stat
import struct
import tempfile
import unittest
import urllib.error
import urllib.request
import zipfile

spec = importlib.util.spec_from_file_location("release_macos", Path(__file__).with_name("release-macos.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
TAG = "v0.1.0-beta.4"
COMMIT = "a" * 40
STEM = "HushLedger-0.1.0-beta.4-macos-arm64"


class Fixture:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.root = "HushLedger.app/Contents/"
        self.resources = self.root + "Resources/"
        worker = b"synthetic worker fixture"
        self.manifest = {
            "version": "0.1.0", "releaseVersion": TAG[1:], "sourceCommit": COMMIT,
            "sourceRef": TAG, "sourceDirty": False, "sourceTreeSha256": "b" * 64,
            "architecture": "arm64", "signing": "ad-hoc", "notarized": False,
            "minimumMacOS": "13.5", "workerSha256": hashlib.sha256(worker).hexdigest(),
        }
        executable = b"\xcf\xfa\xed\xfe" + struct.pack("<I", 0x0100000C) + b"synthetic executable"
        plist = {
            "CFBundleIdentifier": "app.hushledger.desktop", "CFBundleExecutable": "HushLedger",
            "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "0.1.0",
            "HushLedgerReleaseVersion": TAG[1:], "LSMinimumSystemVersion": "13.5",
        }
        self.entries = {
            self.root + "Info.plist": plistlib.dumps(plist),
            self.root + "_CodeSignature/CodeResources": b"synthetic signature fixture",
            self.root + "MacOS/HushLedger": executable,
            self.resources + "bin/node": executable,
            self.resources + "server/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd": executable,
            self.resources + "build.json": json.dumps(self.manifest).encode(),
            self.resources + "server/worker/custom-worker.js": worker,
        }
        for name in ("AppIcon.icns", "messages.json", "server.mjs", "lifecycle.mjs", "LICENSE",
                     "server/config.json", "server/scripts/private-local-state.cjs",
                     "server/node_modules/wrangler/bin/wrangler.js",
                     "server/migrations/0022_paste_approvals.sql", "server/assets/index.html"):
            self.entries[self.resources + name] = b"synthetic required resource"
        self.non_executable = set()
        self.write()

    def checksums(self):
        paths = [self.directory / (STEM + suffix) for suffix in (".zip", ".build.json", ".README.txt")]
        (self.directory / (STEM + ".sha256")).write_text("".join(release.file_digest(path) + "  " + path.name + "\n" for path in paths))

    def write(self):
        with zipfile.ZipFile(self.directory / (STEM + ".zip"), "w") as archive:
            for name, data in self.entries.items():
                item = zipfile.ZipInfo(name)
                item.create_system = 3
                mode = 0o644 if name in self.non_executable else 0o755
                item.external_attr = (stat.S_IFREG | mode) << 16
                archive.writestr(item, data)
        (self.directory / (STEM + ".build.json")).write_text(json.dumps(self.manifest))
        (self.directory / (STEM + ".README.txt")).write_text("This ad-hoc signed preview is not notarized.")
        self.checksums()


class FakeGitHub:
    def __init__(self, fixture):
        self.fixture = fixture
        self.calls = []
        self.assets = []
        self.remote_commit = COMMIT
        self.draft = True
        self.bad_download = False
        self.downloads = 0
        self.exists = True
        self.listed_draft = False
        self.source_checks_pass = True

    def tag_commit(self, tag):
        return self.remote_commit

    def json(self, method, endpoint, value=None):
        self.calls.append((method, endpoint, value))
        if endpoint == "/git/ref/heads/main":
            return {"object": {"sha": COMMIT}}
        if endpoint.endswith("/check-runs?per_page=100"):
            return {"check_runs": [{"name": "verify", "head_sha": COMMIT, "status": "completed",
                                   "conclusion": "success" if self.source_checks_pass else "failure"}]}
        if endpoint == "/releases/tags/" + TAG:
            if not self.exists:
                raise urllib.error.HTTPError("https://api.github.com/synthetic", 404, "missing", {}, None)
            return {"id": 1, "draft": self.draft}
        if endpoint == "/releases?per_page=100":
            return [{"id": 1, "draft": True, "tag_name": TAG}] if self.listed_draft else []
        if method == "POST" and endpoint == "/releases":
            if value["draft"] is not True:
                raise AssertionError("Release was not created as a draft")
            return {"id": 1, "draft": True}
        if endpoint == "/releases/1/assets?per_page=100":
            return self.assets
        if method == "PATCH":
            if self.downloads != 4:
                raise AssertionError("Publication occurred before all four downloads were checked")
            return {"html_url": "https://github.com/Coke1120/HushLedger/releases/tag/" + TAG}
        raise AssertionError((method, endpoint))

    def upload(self, release_id, path):
        self.calls.append(("UPLOAD", path.name, None))
        asset = {"id": len(self.assets) + 1, "name": path.name, "state": "uploaded",
                 "size": path.stat().st_size, "digest": "sha256:" + release.file_digest(path)}
        self.assets.append(asset)
        return asset

    def downloaded_digest(self, asset):
        self.downloads += 1
        if self.bad_download:
            return "0" * 64, asset["size"]
        return release.file_digest(self.fixture.directory / asset["name"]), asset["size"]


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.fixture = Fixture(self.temporary.name)

    def verify(self):
        return release.verify(self.fixture.directory, TAG, COMMIT)

    def test_complete_app_and_provenance(self):
        self.assertEqual(len(self.verify()), 4)

    def test_source_zip_is_rejected(self):
        self.fixture.entries = {"README.md": b"source archive"}
        self.fixture.write()
        with self.assertRaisesRegex(ValueError, "actual complete"):
            self.verify()

    def test_missing_resource_is_rejected(self):
        del self.fixture.entries[self.fixture.resources + "AppIcon.icns"]
        self.fixture.write()
        with self.assertRaisesRegex(ValueError, "actual complete"):
            self.verify()

    def test_x86_executable_is_rejected(self):
        self.fixture.entries[self.fixture.root + "MacOS/HushLedger"] = b"\xcf\xfa\xed\xfe" + struct.pack("<I", 0x01000007)
        self.fixture.write()
        with self.assertRaisesRegex(ValueError, "arm64 Mach-O"):
            self.verify()

    def test_executable_permission_is_required(self):
        self.fixture.non_executable.add(self.fixture.resources + "bin/node")
        self.fixture.write()
        with self.assertRaisesRegex(ValueError, "executable mode"):
            self.verify()

    def test_worker_integrity_is_independent_of_zip_checksum(self):
        self.fixture.entries[self.fixture.resources + "server/worker/custom-worker.js"] = b"changed"
        self.fixture.write()
        with self.assertRaisesRegex(ValueError, "Worker checksum"):
            self.verify()

    def test_dirty_or_wrong_source_is_rejected(self):
        for key, value in (("sourceDirty", True), ("sourceCommit", "c" * 40), ("sourceRef", "v0.1.0-beta.3")):
            with self.subTest(key=key):
                original = self.fixture.manifest[key]
                self.fixture.manifest[key] = value
                self.fixture.write()
                with self.assertRaises(ValueError):
                    self.verify()
                self.fixture.manifest[key] = original

    def test_embedded_provenance_must_match(self):
        self.fixture.entries[self.fixture.resources + "build.json"] = b"{}"
        self.fixture.write()
        with self.assertRaisesRegex(ValueError, "Embedded provenance"):
            self.verify()

    def test_plist_version_must_match(self):
        data = plistlib.loads(self.fixture.entries[self.fixture.root + "Info.plist"])
        data["HushLedgerReleaseVersion"] = "0.1.0-beta.3"
        self.fixture.entries[self.fixture.root + "Info.plist"] = plistlib.dumps(data)
        self.fixture.write()
        with self.assertRaisesRegex(ValueError, "release version"):
            self.verify()

    def test_download_checksum_is_enforced(self):
        (self.fixture.directory / (STEM + ".README.txt")).write_text("changed")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            self.verify()

    def test_unsafe_archive_path_is_rejected(self):
        self.fixture.entries["HushLedger.app/../../outside"] = b"invalid"
        self.fixture.write()
        with self.assertRaisesRegex(ValueError, "Unsafe ZIP"):
            self.verify()

    def test_publication_follows_all_download_checks(self):
        api = FakeGitHub(self.fixture)
        result = release.publish(self.fixture.directory, TAG, COMMIT, api, "synthetic notes")
        self.assertIn(TAG, result["html_url"])
        self.assertEqual(api.downloads, 4)
        self.assertEqual(api.calls[-1], ("PATCH", "/releases/1", {"draft": False}))

    def test_corrupt_download_never_publishes(self):
        api = FakeGitHub(self.fixture)
        api.bad_download = True
        with self.assertRaisesRegex(ValueError, "Downloaded release"):
            release.publish(self.fixture.directory, TAG, COMMIT, api, "synthetic notes")
        self.assertFalse(any(method == "PATCH" for method, _, _ in api.calls))

    def test_new_release_is_created_as_a_draft(self):
        api = FakeGitHub(self.fixture)
        api.exists = False
        release.publish(self.fixture.directory, TAG, COMMIT, api, "synthetic notes")
        creations = [value for method, _, value in api.calls if method == "POST"]
        self.assertEqual(len(creations), 1)
        self.assertTrue(creations[0]["draft"])

    def test_draft_can_be_resumed_when_tag_endpoint_omits_it(self):
        api = FakeGitHub(self.fixture)
        api.exists = False
        api.listed_draft = True
        release.publish(self.fixture.directory, TAG, COMMIT, api, "synthetic notes")
        self.assertFalse(any(method == "POST" for method, _, _ in api.calls))

    def test_changed_tag_never_mutates_a_release(self):
        api = FakeGitHub(self.fixture)
        api.remote_commit = "c" * 40
        with self.assertRaisesRegex(ValueError, "tag moved"):
            release.publish(self.fixture.directory, TAG, COMMIT, api, "synthetic notes")
        self.assertEqual(api.calls, [])

    def test_failed_source_ci_never_creates_or_uploads_a_release(self):
        api = FakeGitHub(self.fixture)
        api.source_checks_pass = False
        with self.assertRaisesRegex(ValueError, "complete CI"):
            release.publish(self.fixture.directory, TAG, COMMIT, api, "synthetic notes")
        self.assertFalse(any(method in ("POST", "UPLOAD", "PATCH") for method, _, _ in api.calls))

    def test_published_release_is_not_overwritten(self):
        api = FakeGitHub(self.fixture)
        api.draft = False
        with self.assertRaisesRegex(ValueError, "already published"):
            release.publish(self.fixture.directory, TAG, COMMIT, api, "synthetic notes")
        self.assertFalse(any(method in ("PATCH", "POST", "UPLOAD") for method, _, _ in api.calls))

    def test_redirect_does_not_forward_github_token_to_storage(self):
        request = urllib.request.Request("https://api.github.com/asset", headers={"Authorization": "Bearer synthetic"})
        redirected = release.SafeRedirect().redirect_request(request, None, 302, "", {}, "https://release-assets.githubusercontent.com/asset")
        self.assertIsNone(redirected.get_header("Authorization"))


if __name__ == "__main__":
    unittest.main()
