# Troubleshooting Neurodesk App

Understanding how Neurodesk App (JLD) works will greatly help in troubleshooting issues. Check out the [How Neurodesk App works section in User Guide](user-guide.md#How-JupyterLab-Desktop-works) first.

Below are detailed information on topics which commonly come up in questions and issues reported about Neurodesk App. Please read through the topics relavant to the issues you are experiencing. You might be able to resolve the issues on your own.

- [Settings locations and resetting](#Settings-locations-and-resetting)
- [Logs](#Logs)
- [Installation Paths](#Installation-Paths)
- [After Neurodesk App update, why there is still the old JupyterLab Web Application version?](#after-jupyterlab-desktop-update-why-there-is-still-the-old-jupyterlab-web-application-version)
- [macOS write permission issues](#macOS-write-permission-issues)
- [Windows uninstall issues](#Windows-uninstall-issues)
- [Double clicking .ipynb files not launching Neurodesk App](#double-clicking-ipynb-files-not-launching-neurodesk-app)
- [Debugging application launch issues](#Debugging-application-launch-issues)
- [Linux docker permission denied](#linux-docker-permission-denied)
- [Debug Podman on relaunch](#debug-podman-on-relaunch)
- [FATAL:setuid_sandbox_host.cc(158)](#fatalsetuid_sandbox_hostcc158)
- [Running Neurodesk App with Podman on restricted Linux systems](#running-neurodesk-app-with-podman-on-restricted-linux-systems)

## Settings locations and resetting

JLD stores user settings, project settings and application data in different locations as JSON files. You can see [configuration and data files section in User Guide](user-guide.md#Configuration-and-data-files) for the locations in different systems. It is safe to delete these files or keys in these files to reset specific configurations.

## Logs

Neurodesk App saves logs in the following locations. Information about crashes, warnings and additional information might be available in logs. For troubleshooting purposes, it is recommended to set log level to Debug.

- On Windows: `%APPDATA%\neurodeskapp\logs\main.log`
- On macOS `~/Library/Logs/neurodeskapp/main.log`
- On Linux: `~/.config/neurodeskapp/logs/main.log` or `$XDG_CONFIG_HOME/neurodeskapp/logs/main.log`

You can change the log level from the Settings dialog. Setting log level to `Debug` will provide most detailed logs, while setting to `Error` will configure the app to log only when errors occur. Changing log level requires application restart.

<img src="media/set-log-level.png" alt="Set log level" width=350 />

Log level can also be set using CLI or by specifying in `settings.json` file. In order to set log level temporarily via CLI, run the jlab CLI command with parameter `--log-level` as shown below. Checkout `jlab --help` for all log level options and other CLI parameters.

```bash
neurodeskapp --log-level debug
```

In order to set log level via `settings.json` file, add the `logLevel` key with the level value as shown below.

```json
{
  "logLevel": "debug"
  // ...other settings
}
```

## Installation Paths

Neurodesk App installers use the following paths for application. It is recommended to use these default paths. However, if these paths resolve to absolute paths that have spaces and / or special characters on your system, then you need to use a different path for `neurodesktop-storage` in Settings.

Application install paths:

- On Windows: `C:\NeurodeskApp\`
- On macOS: `/Applications/NeurodeskApp.app`
- On Linux: `/opt/NeurodeskApp`

Bundled TinyRange installers are located in:

- On Windows: `C:\NeurodeskApp\resources\app\tinyrange`
- On macOS: `/Applications/NeurodeskApp.app/Contents/Resources/app/tinyrange`
- On Linux: `/opt/NeurodeskApp/resources/app/tinyrange`

Bundled TinyRange is installed to:

- On Windows: `C:\neurodesktop-storage\build`
- On macOS: `~/neurodesktop-storage/build`
- On Linux: `~/neurodesktop-storage/build`


## macOS write permission issues

JLD installers for Windows and Linux create `neurodeskapp` CLI command as part of the installation process. However, macOS application creates this command at first launch and after updates. This command creation might sometimes fail if the user doesn't have the right permissions. This command is created as a symlink at `/usr/local/bin/neurodeskapp`. The symlink points to `/Applications/NeurodeskApp.app/Contents/Resources/app/neurodeskapp` script that launches the desktop application. If you are having issues with running `neurodeskapp` command on macOS. Try these:

- Make sure you can launch JLD from desktop launcher links
- Make sure you have write access to `/usr/local/bin/` directory
- If you are still having issues make sure `/Applications/NeurodeskApp.app/Contents/Resources/app/neurodeskapp` is executable. You can run the command below to enable execution.

```bash
chmod 755 /Applications/NeurodeskApp.app/Contents/Resources/app/neurodeskapp
```

- If you get `Operation not permitted` errors with the command above then you will need to allow Terminal to update other applications. In order to do that, go to `Settings` -> `Privacy & Security` -> `App Management` on your macOS and toggle Terminal in the list. Restart Terminal and try the command above again.

## Windows uninstall issues

Installing and uninstalling multiple versions might leave dangling install metadata in the registry. You can clean these records by following these steps.

1. Make sure no Neurodesk App or server instance is running (rebooting Windows should terminate them if any)
2. If you want to uninstall any existing Neurodesk App and/or Server installation, go to Add / Remove Programs and remove all of the related installations.
3. If there are any dangling installations that cannot be removed from Add / Remove Programs then remove those dangling ones by following [the instructions here](https://support.microsoft.com/en-us/topic/removing-invalid-entries-in-the-add-remove-programs-tool-0dae27c1-0b06-2559-311b-635cd532a6d5) with care.
4. The instructions in the link above may need to be followed also for: HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall

## Double clicking .ipynb files not launching Neurodesk App

Neurodesk App installers automatically associate `.ipynb` files with the application. If you are still having issues with launch by double clicking `.ipynb` files, you can fix it by right clicking the file and changing the default opener. Use the system specific `Open with...` dialog to set Neurodesk App as the default application to open `.ipynb` files with.

## Debugging application launch issues

Application launch might fail for various reasons and it is best to check logs for the source of the error. Try the following to debug launch issues.

1. Set log level to `debug` by following the instructions [here](#Logs).
2. Retry launching and check logs.
3. Try removing custom environment settings from `settings.json` and/or `desktop-settings.json`. You can see [configuration and data files section in User Guide](user-guide.md#Configuration-and-data-files) for the locations of these files in different systems. Retry launch and check logs.
4. Try removing application cache data from `app-data.json`. Retry launch and check logs.
5. Try to launch using `neurodeskapp --log-level debug` CLI command to check if there are any logs output in system Terminal.

## Linux docker permission denied

If you get this error in the session startup screen

`docker: permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Post "http://%2Fvar%2Frun%2Fdocker.sock/v1.24/containers/create?name=neurodeskapp-40549": dial unix /var/run/docker.sock: connect: permission denied.`

try to fix it by running this in terminal:

```bash
sudo chmod 666 /var/run/docker.sock
```

## Debug Podman on relaunch

podman start container but failed to fuse mount cvmfs and exited with code 0 (supposed to happen only when child process exit without error)

error can only be seen from `podman logs container-name`

so the app starts another container, found it exists for a sec and exited, so it still tries to rm container

The app was hanging on relaunch because of [zombie process](https://unix.stackexchange.com/questions/223201/defunct-process-is-it-always-a-child-process) where `this._nbServer`, a child process, is killed on close but still waiting for the Promise to waitUntilServerIsUp and waitForDuration for 15 mins.

```
autofs is NOT running - attempting to mount manually:
CernVM-FS: running with credentials 107:115
CernVM-FS: loading Fuse module... Failed to initialize shared lru cache (12 - quota init failure)
```

This has been resolved in the process itself to catch unresolved promise.

## FATAL:setuid_sandbox_host.cc(158)

If you see the error "FATAL:setuid_sandbox_host.cc(158)] The SUID sandbox helper binary was found, but is not configured correctly. Rather than run without sandboxing I'm aborting now. You need to make sure that /opt/NeurodeskApp/chrome-sandbox is owned by root and has mode 4755.
Trace/breakpoint trap (core dumped)" this is caused by a recent change in Ubuntu 24.04.

A temporary workaround: Create the file /etc/apparmor.d/neurodeskapp
 With this content:

```
# This profile allows everything and only exists to give the
# application a name instead of having the label "unconfined"

abi <abi/4.0>,
include <tunables/global>

profile neurodeskapp "/opt/NeurodeskApp/neurodeskapp" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/neurodeskapp>
}
```

Then restart your computer. Then try to start the neurodesk app again.

## Running Neurodesk App with Podman on restricted Linux systems

{{< alert color="warning" >}}
This is an **advanced** guide for getting the Neurodesk App working with **Podman** (instead of Docker) on locked-down Linux machines — for example, hosts that use **Active Directory (AD)** accounts, an **NFS-mounted** home or data directory, and where image pulls through the App tend to time out. On a standard desktop with Docker or rootful Podman you should **not** need any of this.

The steps below were validated with **Podman 3.4.4 on Ubuntu 22**. Replace every `<placeholder>` with your own values.
{{< /alert >}}

**1. Install the Podman shim script**

Some environments need a wrapper around `podman` to fix an NFS volume-mount bug and to sanitize the UID/GID that the App passes to the container. Create an executable file named `podman` in `~/.local/bin/` (owned by your user), so it is found on `PATH` before the real binary:

```bash
#!/bin/bash

CURRENT_UID=$(id -u)
CURRENT_GID=$(id -g)

NEW_ARGS=()
for arg in "$@"; do
    # 1. Fix the NFS volume-mount bug by appending the overlay override option (:O)
    if [[ "$arg" == *"/nfs/<mount>"* ]]; then
        arg="${arg//\/nfs\/<mount>:\/data/\/nfs\/<mount>:\/data:O}"
    fi

    # 2. Sanitize the network IDs
    if [[ "$arg" == *"NB_UID=${CURRENT_UID}"* ]]; then
        arg="${arg//NB_UID=${CURRENT_UID}/NB_UID=1000}"
    fi
    if [[ "$arg" == *"NB_GID=${CURRENT_GID}"* ]]; then
        arg="${arg//NB_GID=${CURRENT_GID}/NB_GID=100}"
    fi
    NEW_ARGS+=("$arg")
done

exec /usr/bin/podman "${NEW_ARGS[@]}"
```

Then make it executable:

```bash
chmod +x ~/.local/bin/podman
```

{{< alert color="info" >}}
Replace `<mount>` with your NFS mount point. If you are **not** using an NFS mount, you can omit the overlay (`:O`) fix entirely.

The UID/GID sanitizing is only needed for **non-person AD accounts** that are not assigned a UID/GID. If your organization uses AD with a normal person account that has an assigned UID and GID, you most likely do **not** need this and can skip the shim.
{{< /alert >}}

If you do need the UID workaround, add your account to `/etc/subuid` and `/etc/subgid` (this is why the shim above uses `1000`):

```
# /etc/subuid
<USERNAME>:1000:65536

# /etc/subgid
<USERNAME>:100000:65536
```
