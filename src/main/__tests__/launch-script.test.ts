import { generateLaunchScript, ILaunchScriptParams } from '../server';
import { EngineType } from '../config/settings';

function baseParams(
  overrides: Partial<ILaunchScriptParams> = {}
): ILaunchScriptParams {
  return {
    engineType: EngineType.Docker,
    port: 8888,
    token: 'jlab:srvr:abc123',
    tag: '2024-01-01',
    platform: 'linux',
    workingDirectory: '',
    cvmfsMode: 'false',
    overrideDefaultServerArgs: false,
    tinyrangePath: '/usr/local/bin/tinyrange',
    osVersion: '2204',
    containerName: 'neurodeskapp',
    ...overrides
  };
}

describe('generateLaunchScript', () => {
  // ── Docker tests ──

  describe('Docker engine', () => {
    it('includes --privileged flag', () => {
      const script = generateLaunchScript(baseParams());
      expect(script).toContain('--privileged');
    });

    it('includes --shm-size=1gb', () => {
      const script = generateLaunchScript(baseParams());
      expect(script).toContain('--shm-size=1gb');
    });

    it('uses provided containerName', () => {
      const script = generateLaunchScript(
        baseParams({ port: 9999, containerName: 'neurodeskapp' })
      );
      expect(script).toContain('--name neurodeskapp');
    });

    it('falls back to base name when containerName not provided', () => {
      const script = generateLaunchScript(
        baseParams({ port: 9999, containerName: undefined })
      );
      expect(script).toContain('--name neurodeskapp');
      expect(script).not.toContain('--name neurodeskapp-9999');
    });

    it('includes port mapping', () => {
      const script = generateLaunchScript(baseParams({ port: 9999 }));
      expect(script).toContain('-p 127.0.0.1:9999:8888');
    });

    it('includes NEURODESKTOP_VERSION env var', () => {
      const script = generateLaunchScript(baseParams({ tag: '2024-05-01' }));
      expect(script).toContain('-e NEURODESKTOP_VERSION=2024-05-01');
    });

    it('includes CVMFS_DISABLE=false for Stream mode', () => {
      const script = generateLaunchScript(baseParams({ cvmfsMode: 'false' }));
      expect(script).toContain('-e CVMFS_DISABLE=false');
    });

    it('includes CVMFS_DISABLE=true for Download mode', () => {
      const script = generateLaunchScript(baseParams({ cvmfsMode: 'true' }));
      expect(script).toContain('-e CVMFS_DISABLE=true');
    });

    it('includes docker run -d --rm', () => {
      const script = generateLaunchScript(baseParams());
      expect(script).toContain('docker run -d --rm');
    });

    it('uses --mount source for home volume (not -v)', () => {
      const script = generateLaunchScript(baseParams());
      expect(script).toContain(
        '--mount source=neurodesk-home,target=/home/jovyan'
      );
    });

    it('includes --mac-address flag', () => {
      const script = generateLaunchScript(baseParams());
      expect(script).toContain('--mac-address=88:75:56:ef:3e:d6');
    });

    it('includes NB_UID and NB_GID on linux', () => {
      const script = generateLaunchScript(baseParams({ platform: 'linux' }));
      expect(script).toContain('-e NB_UID="$(id -u)"');
      expect(script).toContain('-e NB_GID="$(id -g)"');
    });

    it('uses -v syntax on windows instead of NB_UID/NB_GID', () => {
      const script = generateLaunchScript(baseParams({ platform: 'win32' }));
      expect(script).toContain(
        '-v C://neurodesktop-storage:/neurodesktop-storage'
      );
      expect(script).not.toContain('NB_UID');
    });

    it('includes server launch args with token and port', () => {
      const script = generateLaunchScript(
        baseParams({
          port: 8888,
          token: 'jlab:srvr:testtoken123'
        })
      );
      expect(script).toContain("--ServerApp.token='jlab:srvr:testtoken123'");
      expect(script).toContain('--ServerApp.port=8888');
    });

    it('omits default server args when overrideDefaultServerArgs is true', () => {
      const script = generateLaunchScript(
        baseParams({
          overrideDefaultServerArgs: true
        })
      );
      expect(script).not.toContain('--ServerApp.token=');
      expect(script).not.toContain('--ServerApp.port=');
    });
  });

  // ── Platform-specific tests ──

  describe('platform differences', () => {
    it('generates bash script for linux', () => {
      const script = generateLaunchScript(baseParams({ platform: 'linux' }));
      expect(script).toContain('if [[');
      expect(script).toContain('fi');
    });

    it('generates bash script for mac', () => {
      const script = generateLaunchScript(baseParams({ platform: 'darwin' }));
      expect(script).toContain('if [[');
    });

    it('generates batch script for windows', () => {
      const script = generateLaunchScript(baseParams({ platform: 'win32' }));
      expect(script).toContain('setlocal enabledelayedexpansion');
      expect(script).toContain('SET ERRORCODE=0');
    });
  });

  // ── AppArmor tests ──

  describe('AppArmor', () => {
    it('includes apparmor for Docker containers on >= 2310', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Docker,
          osVersion: '2310'
        })
      );
      expect(script).toContain('--security-opt apparmor=neurodeskapp');
    });

    it('includes apparmor for Docker containers on 2404', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Docker,
          osVersion: '2404'
        })
      );
      expect(script).toContain('--security-opt apparmor=neurodeskapp');
    });

    it('does not include apparmor for osVersion < 2310', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Docker,
          osVersion: '2204'
        })
      );
      expect(script).not.toContain('--security-opt apparmor=');
    });

    it('does not include apparmor for Podman even with osVersion >= 2310', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Podman,
          osVersion: '2310'
        })
      );
      expect(script).not.toContain('--security-opt apparmor=');
    });
  });

  // ── Podman tests ──

  describe('Podman engine', () => {
    it('uses podman run command', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Podman
        })
      );
      expect(script).toContain('podman run -d --rm');
    });

    it('uses -v for home volume (not --mount)', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Podman
        })
      );
      expect(script).toContain('-v neurodesk-home:/home/jovyan');
    });

    it('includes bridge network config', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Podman
        })
      );
      expect(script).toContain(
        '--network bridge:ip=10.88.0.10,mac=88:75:56:ef:3e:d6'
      );
    });

    it('includes volume create check', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Podman
        })
      );
      expect(script).toContain('podman volume exists neurodesk-home');
      expect(script).toContain('podman volume create neurodesk-home');
    });
  });

  // ── TinyRange tests ──

  describe('TinyRange engine', () => {
    it('uses tinyrange login command', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange,
          tinyrangePath: '/opt/tinyrange/tinyrange'
        })
      );
      expect(script).toContain('/opt/tinyrange/tinyrange login');
    });

    it('includes --forward with port', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange,
          port: 7777
        })
      );
      expect(script).toContain('--forward 7777');
    });

    it('includes --mount-rw for neurodesktop-storage', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange
        })
      );
      expect(script).toContain(
        '--mount-rw ~/neurodesktop-storage:/neurodesktop-storage'
      );
    });

    it('includes --auto-scale', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange
        })
      );
      expect(script).toContain('--auto-scale');
    });

    it('does not include docker/podman run command', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange
        })
      );
      expect(script).not.toContain('docker run');
      expect(script).not.toContain('podman run');
    });

    it('includes -E with env vars and fuse chmod when not overriding args', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange,
          overrideDefaultServerArgs: false
        })
      );
      expect(script).toContain('chmod 777 /dev/fuse');
    });
  });

  // ── WSL tests (Windows only) ──

  function wslParams(overrides: Partial<ILaunchScriptParams> = {}) {
    return baseParams({
      engineType: EngineType.WSL,
      platform: 'win32',
      ...overrides
    });
  }

  describe('WSL engine', () => {
    it('uses the wslc run command', () => {
      const script = generateLaunchScript(wslParams());
      expect(script).toContain('wslc run -d --rm');
    });

    it('includes --shm-size=1G', () => {
      const script = generateLaunchScript(wslParams());
      expect(script).toContain('--shm-size=1G');
    });

    it('references the fully-qualified docker.io image', () => {
      const script = generateLaunchScript(wslParams({ tag: '2026-06-04' }));
      expect(script).toContain('docker.io/vnmd/neurodesktop:2026-06-04');
    });

    it('includes GRANT_SUDO and CVMFS_DISABLE env vars', () => {
      const script = generateLaunchScript(wslParams({ cvmfsMode: 'false' }));
      expect(script).toContain('-e GRANT_SUDO=yes');
      expect(script).toContain('-e CVMFS_DISABLE=false');
    });

    it('maps the requested port to 8888', () => {
      const script = generateLaunchScript(wslParams({ port: 61723 }));
      expect(script).toContain('-p 127.0.0.1:61723:8888');
    });

    it('includes the default server launch args', () => {
      const script = generateLaunchScript(
        wslParams({ token: 'jlab:srvr:xyz' })
      );
      expect(script).toContain("--ServerApp.token='jlab:srvr:xyz'");
      expect(script).toContain('--ServerApp.port=8888');
    });

    it('pulls the image and streams logs', () => {
      const script = generateLaunchScript(wslParams());
      expect(script).toContain('wslc pull docker.io/vnmd/neurodesktop');
      expect(script).toContain('wslc logs -f neurodeskapp');
    });

    it('does not include docker/podman-specific flags', () => {
      const script = generateLaunchScript(wslParams());
      expect(script).not.toContain('--privileged');
      expect(script).not.toContain('--mac-address');
      expect(script).not.toContain('--add-host');
    });

    it('mounts the neurodesktop-storage and home volumes', () => {
      const script = generateLaunchScript(wslParams());
      expect(script).toContain(
        '-v C://neurodesktop-storage:/neurodesktop-storage'
      );
      expect(script).toContain('-v neurodesk-home:/home/jovyan');
    });
  });

  // ── Working directory tests ──

  describe('working directory', () => {
    it('adds /data volume mount when workingDirectory is set (Docker)', () => {
      const script = generateLaunchScript(
        baseParams({
          workingDirectory: '/tmp'
        })
      );
      // resolveWorkingDirectory may resolve the path; just check :/data mount is present
      expect(script).toContain(':/data');
      expect(script).toContain('--volume');
    });

    it('adds --mount-rw for /data when using TinyRange', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange,
          workingDirectory: '/tmp'
        })
      );
      expect(script).toContain(':/data');
      expect(script).toContain('--mount-rw');
    });

    it('does not mount /data when working directory is invalid', () => {
      const script = generateLaunchScript(
        baseParams({
          workingDirectory: '/nonexistent/path/abc123'
        })
      );
      expect(script).not.toContain(':/data');
    });

    it('does not add /data mount when workingDirectory is empty', () => {
      const script = generateLaunchScript(
        baseParams({
          workingDirectory: ''
        })
      );
      expect(script).not.toContain(':/data');
    });

    it('uses --mount-rw for TinyRange working dir on windows', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange,
          platform: 'win32',
          workingDirectory: '/tmp'
        })
      );
      expect(script).toContain('--mount-rw');
      expect(script).toContain(':/data');
    });
  });

  // ── NFS working directory tests ──

  describe('NFS working directory', () => {
    it('mounts NFS dir at /data without statSync validation', () => {
      // NFS dirs skip statSync to avoid hanging on stale mounts
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Docker,
          workingDirectory: '/nfs/tpolk/mind',
          isNfsWorkingDirectory: true
        })
      );
      expect(script).toContain(':/data');
    });

    it('does not mount NFS dir at native path (only /data)', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Docker,
          workingDirectory: '/tmp',
          isNfsWorkingDirectory: true
        })
      );
      expect(script).toContain(':/data');
      // NFS dirs should only get the /data mount, not a duplicate native-path mount
      const nativeVolumeMounts =
        script.match(/--volume\s+"[^"]+":"[^"]+"/g) || [];
      expect(nativeVolumeMounts.length).toBe(0);
    });

    it('does not mount native path for non-NFS dirs', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Docker,
          workingDirectory: '/tmp',
          isNfsWorkingDirectory: false
        })
      );
      expect(script).toContain(':/data');
      const volumeMounts = script.match(/--volume\s+"[^"]+":"[^"]+"/g) || [];
      expect(volumeMounts.length).toBe(0);
    });

    it('does not mount native path for TinyRange even with NFS', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange,
          workingDirectory: '/tmp',
          isNfsWorkingDirectory: true
        })
      );
      expect(script).toContain(':/data');
      const nativeVolumeMounts =
        script.match(/--volume\s+"[^"]+":"[^"]+"/g) || [];
      expect(nativeVolumeMounts.length).toBe(0);
    });

    it('includes NFS mount pre-check for NFS + Docker', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Docker,
          workingDirectory: '/tmp',
          isNfsWorkingDirectory: true
        })
      );
      expect(script).toContain('timeout 5 ls -ld');
      expect(script).toContain('NFS mount may be stale');
      expect(script).toContain('NFS mount check passed');
    });

    it('does not include NFS mount pre-check for non-NFS', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Docker,
          workingDirectory: '/tmp',
          isNfsWorkingDirectory: false
        })
      );
      expect(script).not.toContain('NFS mount may be stale');
    });
  });

  // ── docker run timeout tests ──

  describe('docker run timeout', () => {
    it('wraps docker run with timeout 300 on Linux', () => {
      const script = generateLaunchScript(
        baseParams({ platform: 'linux' })
      );
      expect(script).toContain('timeout 300');
      expect(script).toMatch(/CONTAINER_ID=\$\(timeout 300\s/);
    });

    it('wraps docker pull with timeout 300 on Linux', () => {
      const script = generateLaunchScript(
        baseParams({ platform: 'linux' })
      );
      expect(script).toContain('timeout 300 docker pull');
    });

    it('includes timeout exit code handling on Linux', () => {
      const script = generateLaunchScript(
        baseParams({ platform: 'linux' })
      );
      expect(script).toContain('LAUNCH_EXIT -eq 124');
      expect(script).toContain('timed out after 300s');
    });

    it('does not wrap docker run with timeout on Windows', () => {
      const script = generateLaunchScript(
        baseParams({ platform: 'win32' })
      );
      expect(script).not.toContain('timeout 300');
    });

    it('does not use timeout command on macOS', () => {
      const script = generateLaunchScript(
        baseParams({ platform: 'darwin' })
      );
      expect(script).not.toContain('timeout 300');
      expect(script).not.toContain('timeout 30');
    });

    it('wraps docker rm -f with timeout 30 on Linux', () => {
      const script = generateLaunchScript(
        baseParams({ platform: 'linux' })
      );
      expect(script).toContain('timeout 30 docker rm -f');
    });
  });

  // ── Image registry ──

  describe('image registry', () => {
    it('uses correct image tag', () => {
      const script = generateLaunchScript(baseParams({ tag: '2024-07-15' }));
      expect(script).toContain('vnmd/neurodesktop:2024-07-15');
    });

    it('pulls from docker.io when image does not exist', () => {
      const script = generateLaunchScript(baseParams());
      expect(script).toContain('docker.io/vnmd/neurodesktop:');
    });
  });

  // ── Custom storage directory ──

  describe('custom storage directory', () => {
    it('uses default neurodesktop-storage when storageDirectory is empty', () => {
      const script = generateLaunchScript(baseParams({ storageDirectory: '' }));
      expect(script).toContain(
        '-v ~/neurodesktop-storage:/neurodesktop-storage'
      );
    });

    it('uses custom storageDirectory for Docker mount', () => {
      const script = generateLaunchScript(
        baseParams({ storageDirectory: '/mnt/data/nd-storage' })
      );
      expect(script).toContain(
        '-v /mnt/data/nd-storage:/neurodesktop-storage'
      );
      expect(script).not.toContain('~/neurodesktop-storage');
    });

    it('uses custom storageDirectory for TinyRange mount', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange,
          storageDirectory: '/mnt/data/nd-storage'
        })
      );
      expect(script).toContain(
        '--mount-rw /mnt/data/nd-storage:/neurodesktop-storage'
      );
      expect(script).not.toContain('~/neurodesktop-storage');
    });

    it('normalizes Windows paths for TinyRange', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.TinyRange,
          platform: 'win32',
          storageDirectory: 'D:\\neurodata\\storage'
        })
      );
      expect(script).toContain(
        '--mount-rw D://neurodata//storage:/neurodesktop-storage'
      );
    });

    it('uses custom storageDirectory for Podman mount', () => {
      const script = generateLaunchScript(
        baseParams({
          engineType: EngineType.Podman,
          storageDirectory: '/opt/neuro-storage'
        })
      );
      expect(script).toContain(
        '-v /opt/neuro-storage:/neurodesktop-storage'
      );
    });
  });
});
