# Native CrumbleCracker sessions

Select **CrumbleCracker** in Settings. Saved TinyRange selections migrate to it;
existing TinyRange files and Docker/Podman volumes are not deleted or automatically
converted. Docker and Podman remain separate choices.

A native session first starts authenticated JupyterLab. **Desktop** in the top bar
or **Native desktop → Desktop** in each Jupyter launcher starts Xorg/LXDE and opens
the native Glass window in the same VM. Closing Glass leaves Jupyter running.
Closing the app requests graceful shutdown of its own backend child; it never
kills other VM processes by name.

**GPU-accelerated native desktop** is opt-in and applied to the next session.
The windowless accelerated path currently requires Apple Silicon. It uses the
guest virtio/virgl driver and host OpenGL renderer, not nested scientific GPU
containers. Unsupported configurations fail; acceptance requires virgl, not
silent llvmpipe fallback.

## Development

Build/sign `crumblecracker/build/NeurodeskAppX` from the companion local checkout.
Set `NEURODESK_CC_BINARY` to that absolute binary path, and `NEURODESK_CC_IMAGE` to
`docker-archive:/absolute/candidate.tar` to test a local candidate. Archives must
contain one native Linux image. Allow disk space for the content-addressed tar
snapshot plus indexed layers. No published-image fallback occurs.

The image must include Jupyter-first Glass preparation (`neurodesktop-prepare.service`).
Without an override, the app selects its configured Neurodesktop image version;
older images lacking that service are incompatible with Jupyter-first startup.
`NEURODESK_CC_CVMFS=0` disables host CVMFS for isolated tests.

Caches and persistent homes live under the app profile's
`crumblecracker/workspace-<directory-hash>`. Storage and the additional folder
remain host-owned shares. Custom shell launch arguments are unsupported for this
API backend. Backend credentials never enter renderer IPC. Jupyter uses its own
private generated token; authentication and XSRF protections remain enabled.

## Native acceptance

After building the app and signing the runtime:

```sh
NEURODESK_CC_BINARY=/absolute/crumblecracker/build/NeurodeskAppX node scripts/crumblecracker-e2e.js /absolute/local-candidate.tar gpu
```

Use `software` for the unaccelerated variant. The harness creates a separate
`build/cc-*` profile/storage/cache, exercises real application/session/server
classes, checks authenticated Jupyter before Xorg, clicks both desktop controls,
checks the guest renderer, and retains `jupyter.png`, `desktop.png`, and
`report.json`. Arbitrary guest/application output is not persisted because it can
contain credentials. It shuts down only its own child. Unit tests and builds
alone do not establish native UI or GPU acceptance.

## Packaging

The installer workflow builds CrumbleCracker from the immutable source revision in
`.github/actions/build-crumblecracker/action.yml`, on a native runner for each
architecture. For local packaging, stage the matching built/signed `NeurodeskAppX`
(or `NeurodeskAppX.exe`) in `crumblecracker/arm64/` or `crumblecracker/x64/`.
Package only the staged architecture, for example `yarn dist:mac --arm64` or
`yarn dist:mac --x64`. macOS DMG/ZIP targets inherit the requested architecture
rather than expanding each native CI job into a dual-architecture build.
The packaging hook refuses a missing or empty backend. No TinyRange distribution
is downloaded or bundled. Native test caches and backend sources are excluded
from app payloads. Packaging configuration is not installer runtime acceptance.

The acceptance harness keeps the native display awake, foregrounds its window,
and rejects uniform framebuffer captures. Software mode opens the desktop from
the launcher; GPU mode opens it from the top bar. An optional fourth argument
selects an existing `build/cc-*` test directory for a same-candidate retry; do not
reuse one while its previous process is running. Reports describe the requested
rendering mode, not the directory name. No normal user profile is reused.
