import * as path from 'path';
import {
  ContainerConfigParser,
  VariableContext
} from '../config/containerConfigParser';
import { EngineType } from '../config/settings';

const baseConfigPath = path.join(
  __dirname,
  '../config/baseContainerConfig.yml'
);
const containerConfigPath = path.join(
  __dirname,
  '../../../container_installer/neurodesk.yml'
);

function makeContext(
  overrides: Partial<VariableContext> = {}
): VariableContext {
  return {
    port: '9999',
    serverPort: '8888',
    token: 'jlab:srvr:abc123',
    cvmfsDisable: 'false',
    tinyrangePath: '/usr/local/bin/tinyrange',
    buildDir: '~/neurodesktop-storage/build',
    storageDir: '~/neurodesktop-storage',
    additionalDir: '',
    volumeMount: 'neurodesk-home',
    ...overrides
  };
}

function buildParser(): ContainerConfigParser {
  return new ContainerConfigParser(baseConfigPath, containerConfigPath);
}

describe('ContainerConfigParser', () => {
  let parser: ContainerConfigParser;

  beforeAll(() => {
    parser = buildParser();
  });

  // ── Config accessors ──

  it('reads container name from config', () => {
    expect(parser.getContainerName()).toBe('neurodeskapp');
  });

  it('reads image registry from config', () => {
    expect(parser.getImageRegistry()).toBe('docker.io/vnmd/neurodesktop');
  });

  it('builds a fully qualified image name from registry and version', () => {
    expect(parser.getImageName()).toBe(
      `docker.io/vnmd/neurodesktop:${parser.getImageVersion()}`
    );
  });

  it('reads image version (defaultVersion) from config', () => {
    expect(parser.getImageVersion()).toBeTruthy();
  });

  it('image version matches YYYY-MM-DD format', () => {
    expect(parser.getImageVersion()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reads volume mount from config', () => {
    expect(parser.getVolumeMount()).toBe('neurodesk-home');
  });

  // ── Docker unix args ──

  describe('Docker unix', () => {
    let args: string[];
    let joined: string;

    beforeAll(() => {
      args = parser.parseArgs(EngineType.Docker, makeContext(), 'unix');
      joined = args.join(' ');
    });

    it('includes docker run -d --rm', () => {
      expect(joined).toContain('docker run -d --rm');
    });

    it('includes --privileged', () => {
      expect(joined).toContain('--privileged');
    });

    it('includes --shm-size=1gb', () => {
      expect(joined).toContain('--shm-size=1gb');
    });

    it('includes --user=root', () => {
      expect(joined).toContain('--user=root');
    });

    it('includes --name with container name from config', () => {
      expect(joined).toContain('--name neurodeskapp');
    });

    it('includes port mapping to container port 8888', () => {
      expect(joined).toContain('-p 127.0.0.1:9999:8888');
    });

    it('includes NEURODESKTOP_VERSION env var', () => {
      expect(joined).toContain('-e NEURODESKTOP_VERSION=');
    });

    it('includes CVMFS_DISABLE env var', () => {
      expect(joined).toContain('-e CVMFS_DISABLE=false');
    });

    it('includes GRANT_SUDO env var', () => {
      expect(joined).toContain('-e GRANT_SUDO=yes');
    });

    it('includes NEURODESKTOP_CVMFS_STARTUP_MODE env var', () => {
      expect(joined).toContain('-e NEURODESKTOP_CVMFS_STARTUP_MODE=eager');
    });

    it('includes NB_UID and NB_GID with id commands', () => {
      expect(joined).toContain('NB_UID="$(id -u)"');
      expect(joined).toContain('NB_GID="$(id -g)"');
    });

    it('includes neurodesktop-storage mount', () => {
      expect(joined).toContain(
        '-v ~/neurodesktop-storage:/neurodesktop-storage'
      );
    });

    it('includes --mount source for home volume with --mac-address', () => {
      expect(joined).toContain(
        '--mount source=neurodesk-home,target=/home/jovyan'
      );
      expect(joined).toContain('--mac-address=88:75:56:ef:3e:d6');
    });

    it('includes --add-host and OLLAMA_HOST', () => {
      expect(joined).toContain('--add-host=host.docker.internal:');
      expect(joined).toContain('OLLAMA_HOST=');
    });

    it('leaves the image out of the run flags', () => {
      // The image is positional for Docker/Podman, so buildLaunchArgs appends
      // it after every flag rather than parseArgs emitting it inline.
      expect(joined).not.toContain('vnmd/neurodesktop:');
    });

    it('buildLaunchArgs puts the image after the last run flag', () => {
      const args = parser.buildLaunchArgs(EngineType.Docker, makeContext(), {
        platform: 'unix',
        additionalDir: '/mnt/scratch',
        osVersion: '2404'
      });
      const imageIdx = args.indexOf(parser.getImageName());
      expect(imageIdx).toBeGreaterThan(-1);
      const flagsBefore = args.slice(0, imageIdx).join(' ');
      const after = args.slice(imageIdx + 1).join(' ');
      expect(flagsBefore).toContain('--security-opt apparmor=neurodeskapp');
      expect(flagsBefore).toContain('--volume "/mnt/scratch":/data');
      // Only the container command may follow the image.
      expect(after.startsWith('start.sh jupyter lab')).toBe(true);
    });
  });

  // ── Docker windows args ──

  describe('Docker windows', () => {
    let joined: string;

    beforeAll(() => {
      const args = parser.parseArgs(
        EngineType.Docker,
        makeContext({ storageDir: 'C://neurodesktop-storage' }),
        'windows'
      );
      joined = args.join(' ');
    });

    it('uses literal NB_UID=1000 NB_GID=1000 on windows', () => {
      expect(joined).toContain('NB_UID=1000');
      expect(joined).toContain('NB_GID=1000');
      expect(joined).not.toContain('id -u');
    });

    it('uses C:// storage path on windows', () => {
      expect(joined).toContain(
        '-v C://neurodesktop-storage:/neurodesktop-storage'
      );
    });

    it('uses !HOST_GATEWAY_IP! batch variable on windows', () => {
      expect(joined).toContain('!HOST_GATEWAY_IP!');
    });
  });

  // ── Podman unix args ──

  describe('Podman unix', () => {
    let joined: string;

    beforeAll(() => {
      const args = parser.parseArgs(EngineType.Podman, makeContext(), 'unix');
      joined = args.join(' ');
    });

    it('uses podman run -d --rm', () => {
      expect(joined).toContain('podman run -d --rm');
    });

    it('uses -v for home volume (not --mount)', () => {
      expect(joined).toContain('-v neurodesk-home:/home/jovyan');
    });

    it('includes bridge network config', () => {
      expect(joined).toContain(
        '--network bridge:ip=10.88.0.10,mac=88:75:56:ef:3e:d6'
      );
    });

    it('includes --add-host and OLLAMA_HOST', () => {
      expect(joined).toContain('--add-host=host.docker.internal:');
      expect(joined).toContain('OLLAMA_HOST=');
    });
  });

  // ── TinyRange args ──

  describe('TinyRange', () => {
    let joined: string;

    beforeAll(() => {
      const ctx = makeContext({ serverPort: '9999' });
      const args = parser.parseArgs(EngineType.TinyRange, ctx, 'unix');
      joined = args.join(' ');
    });

    it('uses tinyrange path as base cmd', () => {
      expect(joined).toContain('/usr/local/bin/tinyrange');
    });

    it('includes login subcommand', () => {
      expect(joined).toContain('login');
    });

    it('includes --forward with port', () => {
      expect(joined).toContain('--forward 9999');
    });

    it('includes --mount-rw for neurodesktop-storage', () => {
      expect(joined).toContain(
        '--mount-rw ~/neurodesktop-storage:/neurodesktop-storage'
      );
    });

    it('includes --auto-scale', () => {
      expect(joined).toContain('--auto-scale');
    });

    it('includes --volume for home persist', () => {
      expect(joined).toContain('--volume neurodeskHome,20480,/home,persist');
    });

    it('does not include docker/podman run', () => {
      expect(joined).not.toContain('docker run');
      expect(joined).not.toContain('podman run');
    });
  });

  // ── TinyRange prelude ──

  describe('TinyRange prelude', () => {
    it('includes env vars and fuse chmod for unix', () => {
      const ctx = makeContext();
      const prelude = parser.getTinyrangePrelude(ctx, 'unix');
      expect(prelude).toContain('chmod 777 /dev/fuse');
      expect(prelude).toContain('NEURODESKTOP_VERSION=');
      expect(prelude).toContain('CVMFS_DISABLE=');
      expect(prelude).toContain('GRANT_SUDO=yes');
      expect(prelude).toContain('chown -R');
      expect(prelude).toContain('chmod -R 777 /neurodesktop-storage');
    });

    it('uses literal uid on windows', () => {
      const ctx = makeContext();
      const prelude = parser.getTinyrangePrelude(ctx, 'windows');
      expect(prelude).toContain('chown -R 1000:1000');
      expect(prelude).not.toContain('id -u');
    });

    it('uses $(id -u) on unix', () => {
      const ctx = makeContext();
      const prelude = parser.getTinyrangePrelude(ctx, 'unix');
      expect(prelude).toContain('"$(id -u)"');
    });
  });

  // ── TinyRange post args ──

  describe('TinyRange post args', () => {
    it('includes FileContentsManager.delete_to_trash', () => {
      const postArgs = parser.getTinyrangePostArgs();
      expect(postArgs).toContain('--FileContentsManager.delete_to_trash=False');
    });
  });

  // ── Default server args ──

  describe('defaultServerArgs', () => {
    it('includes all required Jupyter server flags', () => {
      const ctx = makeContext({ serverPort: '8888' });
      const args = parser.getDefaultServerArgs(ctx);
      const joined = args.join(' ');
      expect(joined).toContain('start.sh jupyter lab');
      expect(joined).toContain('--ServerApp.password=');
      expect(joined).toContain('--no-browser');
      expect(joined).toContain('--expose-app-in-browser');
      expect(joined).toContain("--ServerApp.token='jlab:srvr:abc123'");
      expect(joined).toContain('--ServerApp.port=8888');
      expect(joined).toContain('--LabApp.quit_button=False');
      expect(joined).toContain(
        '--NotebookIntelligence.github_access_token=remember'
      );
    });

    it('substitutes serverPort for TinyRange (actual port)', () => {
      const ctx = makeContext({ serverPort: '7777' });
      const args = parser.getDefaultServerArgs(ctx);
      const joined = args.join(' ');
      expect(joined).toContain('--ServerApp.port=7777');
    });
  });

  // ── Complete launch commands ──
  //
  // baseContainerConfig.yml is the only source of these flags, so this block
  // is the regression net for it: every flag the app relies on, per engine and
  // platform, asserted against the command buildLaunchArgs actually produces.

  describe('complete launch command', () => {
    it('Docker unix has every required flag', () => {
      const all = parser
        .buildLaunchArgs(EngineType.Docker, makeContext(), {
          platform: 'unix'
        })
        .join(' ');

      const requiredFlags = [
        'docker run -d --rm',
        '--shm-size=1gb',
        '--privileged',
        '--user=root',
        '--name neurodeskapp',
        '-p 127.0.0.1:9999:8888',
        '-e NEURODESKTOP_VERSION=',
        '-e CVMFS_DISABLE=',
        '-e GRANT_SUDO=yes',
        '-e NEURODESKTOP_CVMFS_STARTUP_MODE=eager',
        'NB_UID="$(id -u)"',
        'NB_GID="$(id -g)"',
        '~/neurodesktop-storage:/neurodesktop-storage',
        '--mount source=neurodesk-home,target=/home/jovyan',
        '--mac-address=88:75:56:ef:3e:d6',
        '--add-host=host.docker.internal:',
        'OLLAMA_HOST=',
        'docker.io/vnmd/neurodesktop:',
        'start.sh jupyter lab',
        '--no-browser',
        '--expose-app-in-browser',
        "--ServerApp.token='jlab:srvr:abc123'",
        '--ServerApp.port=8888',
        '--LabApp.quit_button=False',
        '--NotebookIntelligence.github_access_token=remember'
      ];

      for (const flag of requiredFlags) {
        expect(all).toContain(flag);
      }
    });

    it('Docker windows has every required flag', () => {
      const all = parser
        .buildLaunchArgs(
          EngineType.Docker,
          makeContext({ storageDir: 'C://neurodesktop-storage' }),
          { platform: 'windows' }
        )
        .join(' ');

      const requiredFlags = [
        'docker run -d --rm',
        '--shm-size=1gb',
        '--privileged',
        '--user=root',
        '-p 127.0.0.1:9999:8888',
        'NB_UID=1000',
        'NB_GID=1000',
        'C://neurodesktop-storage:/neurodesktop-storage',
        '--mount source=neurodesk-home,target=/home/jovyan',
        '--mac-address=88:75:56:ef:3e:d6',
        '!HOST_GATEWAY_IP!',
        'OLLAMA_HOST=',
        '-e GRANT_SUDO=yes',
        '-e NEURODESKTOP_CVMFS_STARTUP_MODE=eager'
      ];

      for (const flag of requiredFlags) {
        expect(all).toContain(flag);
      }
    });

    it('Podman unix has every required flag', () => {
      const all = parser
        .buildLaunchArgs(EngineType.Podman, makeContext(), {
          platform: 'unix'
        })
        .join(' ');

      const requiredFlags = [
        'podman run -d --rm',
        '--shm-size=1gb',
        '--privileged',
        '--user=root',
        '-p 127.0.0.1:9999:8888',
        'NB_UID="$(id -u)"',
        '-v neurodesk-home:/home/jovyan',
        '--network bridge:ip=10.88.0.10,mac=88:75:56:ef:3e:d6',
        '--add-host=host.docker.internal:',
        'OLLAMA_HOST=',
        '-e GRANT_SUDO=yes',
        '-e NEURODESKTOP_CVMFS_STARTUP_MODE=eager'
      ];

      for (const flag of requiredFlags) {
        expect(all).toContain(flag);
      }
    });

    it('TinyRange unix has every required flag', () => {
      const all = parser
        .buildLaunchArgs(
          EngineType.TinyRange,
          makeContext({ serverPort: '9999' }),
          { platform: 'unix' }
        )
        .join(' ');

      const requiredFlags = [
        '/usr/local/bin/tinyrange',
        'login',
        '--buildDir',
        '--oci docker.io/vnmd/neurodesktop:',
        '--forward 9999',
        '-m //lib/qemu:user',
        '--mount-rw ~/neurodesktop-storage:/neurodesktop-storage',
        '--volume neurodeskHome,20480,/home,persist',
        '--auto-scale',
        'chmod 777 /dev/fuse',
        'chown -R',
        'chmod -R 777 /neurodesktop-storage',
        '-e NEURODESKTOP_VERSION=',
        '-e CVMFS_DISABLE=',
        '-e GRANT_SUDO=yes',
        '-e NEURODESKTOP_CVMFS_STARTUP_MODE=eager',
        '--ServerApp.port=9999',
        '--FileContentsManager.delete_to_trash=False'
      ];

      for (const flag of requiredFlags) {
        expect(all).toContain(flag);
      }
    });

    it('TinyRange takes no trailing image name', () => {
      // The image goes in inline as --oci; a trailing copy would be read as
      // the guest command.
      const args = parser.buildLaunchArgs(EngineType.TinyRange, makeContext(), {
        platform: 'unix'
      });
      expect(parser.usesTrailingImage(EngineType.TinyRange)).toBe(false);
      expect(args.filter(a => a === parser.getImageName())).toHaveLength(0);
    });

    it('omits the server args when the user overrides them', () => {
      const all = parser
        .buildLaunchArgs(EngineType.Docker, makeContext(), {
          platform: 'unix',
          includeServerArgs: false
        })
        .join(' ');
      expect(all).not.toContain('start.sh jupyter lab');
      // The run flags and the image are still there.
      expect(all).toContain('docker run -d --rm');
      expect(all).toContain(parser.getImageName());
    });

    it('drops the TinyRange -E prelude when server args are overridden', () => {
      // The prelude opens the quote that tinyrangePostArgs closes; emitting
      // one without the other produces an unterminated string.
      const all = parser
        .buildLaunchArgs(EngineType.TinyRange, makeContext(), {
          platform: 'unix',
          includeServerArgs: false
        })
        .join(' ');
      expect(all).not.toContain('-E "chmod 777 /dev/fuse');
      expect(all).not.toContain('--FileContentsManager.delete_to_trash=False"');
    });
  });

  // ── Conditional run args ──

  describe('conditionalRunArgs', () => {
    it('adds the apparmor profile for Docker on Ubuntu >= 23.10', () => {
      expect(
        parser.getConditionalRunArgs(EngineType.Docker, 'unix', '2404')
      ).toContain('--security-opt apparmor=neurodeskapp');
    });

    it('omits it below the version floor', () => {
      expect(
        parser.getConditionalRunArgs(EngineType.Docker, 'unix', '2204')
      ).toHaveLength(0);
    });

    it('omits it when the OS version is unknown (macOS/Windows)', () => {
      expect(
        parser.getConditionalRunArgs(EngineType.Docker, 'unix', '')
      ).toHaveLength(0);
      expect(
        parser.getConditionalRunArgs(EngineType.Docker, 'windows', undefined)
      ).toHaveLength(0);
    });

    it('is Docker-only — Podman and TinyRange have no apparmor profile', () => {
      expect(
        parser.getConditionalRunArgs(EngineType.Podman, 'unix', '2404')
      ).toHaveLength(0);
      expect(
        parser.getConditionalRunArgs(EngineType.TinyRange, 'unix', '2404')
      ).toHaveLength(0);
    });
  });

  // ── TinyRange /data prelude ──

  describe('tinyrangeAdditionalDirPrelude', () => {
    it('fixes /data ownership when a directory is mounted', () => {
      const prelude = parser.getTinyrangePrelude(
        makeContext(),
        'unix',
        '/mnt/scratch'
      );
      expect(prelude).toContain('find /data -maxdepth 1 -exec chown');
      expect(prelude).toContain('find /data -maxdepth 1 -exec chmod 777');
    });

    it('leaves the prelude alone when nothing is mounted at /data', () => {
      const prelude = parser.getTinyrangePrelude(makeContext(), 'unix');
      expect(prelude).not.toContain('/data');
    });
  });

  // ── additionalDirConfig ──

  describe('additionalDirConfig', () => {
    it('returns --volume for Docker unix', () => {
      const result = parser.getAdditionalDirConfig(
        EngineType.Docker,
        '/data/work',
        'unix'
      );
      expect(result).toContain('--volume');
      expect(result).toContain('/data/work');
      expect(result).toContain(':/data');
    });

    it('returns --mount-rw for TinyRange', () => {
      const result = parser.getAdditionalDirConfig(
        EngineType.TinyRange,
        '/data/work',
        'unix'
      );
      expect(result).toContain('--mount-rw');
      expect(result).toContain(':/data');
    });
  });

  // ── Version override ──

  describe('version override', () => {
    it('uses the override everywhere the version appears', () => {
      const overridden = new ContainerConfigParser(
        baseConfigPath,
        containerConfigPath,
        '2025-01-15'
      );
      expect(overridden.getImageVersion()).toBe('2025-01-15');
      expect(overridden.getImageName()).toBe(
        'docker.io/vnmd/neurodesktop:2025-01-15'
      );
      // {tag} and {imageRegistry} must follow the override, not defaultVersion.
      const all = overridden
        .buildLaunchArgs(EngineType.Docker, makeContext(), {
          platform: 'unix'
        })
        .join(' ');
      expect(all).toContain('-e NEURODESKTOP_VERSION=2025-01-15');
      expect(all).toContain('docker.io/vnmd/neurodesktop:2025-01-15');
      expect(all).not.toContain(overridden.getDefaultImageVersion());
    });

    it('falls back to the YAML defaultVersion when no override is given', () => {
      const plain = new ContainerConfigParser(
        baseConfigPath,
        containerConfigPath
      );
      expect(plain.getImageVersion()).toBe(plain.getDefaultImageVersion());
      expect(plain.getImageName()).toBe(
        `docker.io/vnmd/neurodesktop:${plain.getDefaultImageVersion()}`
      );
    });

    it('accepts a custom tag, not just a dated release', () => {
      const custom = new ContainerConfigParser(
        baseConfigPath,
        containerConfigPath,
        'my-custom-prerelease'
      );
      expect(custom.getImageName()).toBe(
        'docker.io/vnmd/neurodesktop:my-custom-prerelease'
      );
    });

    it('setImageVersion resets to defaultVersion when cleared', () => {
      const p = new ContainerConfigParser(
        baseConfigPath,
        containerConfigPath,
        '2025-01-15'
      );
      p.setImageVersion(undefined);
      expect(p.getImageVersion()).toBe(p.getDefaultImageVersion());
    });
  });
});
