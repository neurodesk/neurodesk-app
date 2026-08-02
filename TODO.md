# TODO: WSL Engine (wslc) Support

Deferred from v2.0.0 release. To be revisited when vmsh replaces wslc + TinyRange.

## Summary

WSL engine support via `wslc` was prototyped but removed from v2.0.0 due to
fundamental limitations that prevent neurodesk tools from running inside the
container.

## Issues Found

### 1. CVMFS bind-mount does not work with wslc

`wslc` runs in its own isolated WSL session, separate from the user's Ubuntu
WSL distro where CVMFS is installed. Bind-mounting `/cvmfs` from wslc's session
yields an empty directory because CVMFS is not mounted in that session.

```
--mount type=bind,source=/cvmfs,target=/cvmfs,readonly,bind-propagation=rslave
```

This flag is also unsupported by `wslc` (`rslave` propagation not available).

### 2. CVMFS cannot run inside the wslc container

CVMFS needs `/dev/fuse` access, which requires either `--privileged` or
`--device /dev/fuse`. Neither is supported by `wslc`.

### 3. Module files alone are insufficient

Copying module definition files (`.lua`) from WSL's CVMFS into
`/neurodesktop-storage/containers/modules/` makes `module avail` show tools,
but `module load <tool>` fails because:

- The CVMFS module files assume the tool is already installed. They simply
  prepend a path like `/neurodesktop-storage/containers/<tool_version>/` to
  `PATH`.
- That directory should contain wrapper scripts and the `.simg` container
  image, but neither exists — only the `.lua` module file was copied.
- The download-mode modules (installed via the Application menu) use
  `run_transparent_singularity.sh` which downloads the `.simg` on first use.
  The CVMFS modules do not trigger this download.

### 4. Container images cannot be copied or symlinked from WSL CVMFS

- **Copying all `.simg` files** is impractical — each is several GB, there are
  dozens of tools, and it would take too long on first launch.
- **Symlinks** from neurodesktop-storage (NTFS via `/mnt/c/`) to `/cvmfs/...`
  do not work because NTFS symlinks cannot target WSL Linux paths, and the
  wslc container cannot see the WSL Ubuntu distro's filesystem.

### 5. Batch script escaping issues

Running complex bash commands via `wsl -- bash -c "..."` inside a Windows
batch script (cmd.exe) causes escaping problems:

- `$()` command substitution is mangled by cmd.exe
- `-exec ... ;` in `find` has `;` consumed by cmd.exe
- Nested quoting (single inside double) is unreliable
- Workaround: use simple `wsl -- <command>` calls without `bash -c`, or use
  cmd.exe `for /f` loops with separate `wsl` invocations.

### 6. SINGULARITY_BINDPATH mismatch

The WSL launch args set `SINGULARITY_BINDPATH='/neurodesktop-storage,/mnt,/home'`
but the container's `environment_variables.sh` expects
`APPTAINER_BINDPATH=/data,/mnt,/neurodesktop-storage,/tmp,/cvmfs`.
The `/cvmfs` entry fails since CVMFS is not available inside the container.

## What Worked

- Basic container startup via `wslc run` with port mapping, env vars, and
  volume mounts.
- JupyterLab UI loads and is functional.
- `neurodesktop-storage` volume mount works (Windows path accessible to wslc).
- Starting CVMFS in the WSL Ubuntu distro via `wsl -u root -- bash -c "cvmfs_config wsl2_start"` works.
- Copying files from WSL's CVMFS to neurodesktop-storage works (with
  `--no-preserve=ownership,mode` for NTFS compatibility).

## Reverted Commits

The following commits were reverted from the `release-v2.0.0` branch:

- `eed0bd0` — add wsl option in settings for windows
- `8f87387` — add logs for debugging wsl
- `153c318` — lint (wsl-related)
- `05ee2f3` — update wslc command to mount local /cvmfs and set profile.d
- `1a72dbd` — add wsl install instruction in settings
- `d2f9f70` — runs the command as root inside WSL without sudo to start cvmfs
- `56336e3` — check modules dir if autofs mount exists
- `2c14691` — copy neurodesk modules to neurodesktop-storage
- `897c844` — cp each subdir content in modules
- `118d9ee` — cp subdir modules to neurodesktop-storage
- `05784d8` — fix engineHint event (WSL-specific UI)
- `bfc7c60` — fix engine selection only applied when restart (WSL-specific UI)

## Recommended Long-term Solution

Replace `wslc` + TinyRange with **vmsh** — a full VM with kernel access where
CVMFS can run natively. This avoids all the isolation issues since the VM has
direct access to FUSE and can mount CVMFS like any Linux host.
