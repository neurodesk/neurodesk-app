import { execFileSync } from 'child_process';
import { ContainerConfigParser } from '../config/containerConfigParser';
import { EngineType } from '../config/settings';
import * as fs from 'fs';
import { generateLaunchScript, ILaunchScriptParams } from '../server';
import * as os from 'os';
import * as path from 'path';

/**
 * Structural invariants for the generated launch script.
 *
 * These tests do not assert on specific flags — launch-script.test.ts does
 * that. They assert on properties that must hold no matter which flags a
 * future fix adds, so that a change made for one engine/platform cannot
 * silently break another. They run against the real baseContainerConfig.yml,
 * so a bad edit to the config fails here too. The failure modes they guard:
 *
 *   1. A flag added in the wrong position (e.g. after the image name, where
 *      docker treats it as a container argument rather than a run flag).
 *   2. A template left unresolved by ContainerConfigParser.
 *   3. A string edit that breaks shell/batch syntax — today the only thing
 *      that catches that is a full container launch in e2e.
 */

const TAG = '2024-01-01';

const baseConfigPath = path.join(
  __dirname,
  '../config/baseContainerConfig.yml'
);
const containerConfigPath = path.join(
  __dirname,
  '../../../container_installer/neuroimaging.yml'
);

interface ITestOverrides extends Partial<Omit<ILaunchScriptParams, 'parser'>> {
  tag?: string;
}

function baseParams(overrides: ITestOverrides = {}): ILaunchScriptParams {
  const { tag = TAG, ...rest } = overrides;
  const platform = rest.platform || 'linux';
  return {
    parser: new ContainerConfigParser(baseConfigPath, containerConfigPath, tag),
    engineType: EngineType.Docker,
    port: 8888,
    token: 'jlab:srvr:abc123',
    platform,
    cvmfsMode: 'false',
    osVersion: '2404',
    tinyrangePath: '/usr/local/bin/tinyrange',
    storageDirectory:
      platform === 'win32'
        ? 'C:\\neurodesktop-storage'
        : '/home/tester/neurodesktop-storage',
    additionalDirectory: '',
    isNfsAdditionalDirectory: false,
    overrideDefaultServerArgs: false,
    ...rest
  };
}

const IMAGE = `docker.io/vnmd/neurodesktop:${TAG}`;

const PLATFORMS = ['linux', 'darwin', 'win32'];
const ENGINES = [EngineType.Docker, EngineType.Podman, EngineType.TinyRange];

/** Every (platform, engine) pair, with and without a /data mount. */
const MATRIX: Array<[string, EngineType, string]> = [];
for (const platform of PLATFORMS) {
  for (const engineType of ENGINES) {
    MATRIX.push([platform, engineType, '']);
    MATRIX.push([platform, engineType, '/tmp']);
  }
}

const hasBash = (() => {
  try {
    execFileSync('bash', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('launch script invariants', () => {
  // ── Argument ordering ──
  //
  // Docker and Podman parse everything after the image name as the container
  // command. A run flag added below `launchArgs.push(resolvedImageName)` in
  // server.ts is therefore not applied to the container — it is silently
  // handed to the entrypoint instead.

  describe('run flags precede the image name (Docker/Podman)', () => {
    // Flags that must never appear after the image reference.
    const RUN_FLAGS = [
      ' -e ',
      ' -v ',
      ' -p ',
      ' --name ',
      ' --mount ',
      ' --add-host',
      ' --network ',
      ' --privileged',
      ' --shm-size',
      ' --user=',
      ' --mac-address',
      ' --security-opt'
    ];

    const cases: Array<[string, EngineType]> = [];
    for (const platform of PLATFORMS) {
      cases.push([platform, EngineType.Docker]);
      cases.push([platform, EngineType.Podman]);
    }

    it.each(cases)('%s / %s', (platform, engineType) => {
      const script = generateLaunchScript(
        baseParams({
          platform,
          engineType,
          additionalDirectory: '/tmp',
          // High enough to pull in the conditional apparmor flag, which used
          // to be appended after the image name.
          osVersion: '2404'
        })
      );
      const image = IMAGE;

      const runLines = script
        .split('\n')
        .filter(line => line.includes(`${engineType} run -d --rm`));
      expect(runLines.length).toBeGreaterThan(0);

      for (const line of runLines) {
        const imageIdx = line.indexOf(image);
        expect(imageIdx).toBeGreaterThan(-1);
        const afterImage = line.slice(imageIdx + image.length);
        for (const flag of RUN_FLAGS) {
          expect(afterImage).not.toContain(flag);
        }
      }
    });
  });

  // ── Template resolution ──

  describe('no unresolved templates or undefined values', () => {
    it.each(MATRIX)(
      '%s / %s / additionalDirectory=%s',
      (platform, engineType, additionalDirectory) => {
        const script = generateLaunchScript(
          baseParams({ platform, engineType, additionalDirectory })
        );
        // Any {template} the parser failed to substitute. Legitimate braces
        // that must not trip this: Go's {{.Field}} format strings (stripped
        // first), shell ${VAR} expansions (excluded by the lookbehind) and
        // `find -exec {} +` (excluded by requiring a word character).
        const templates = script.replace(/\{\{[^}]*\}\}/g, '');
        expect(templates).not.toMatch(/(?<!\$)\{\w[\w.]*\}/);
        expect(script).not.toContain('undefined');
        expect(script).not.toContain('NaN');
        expect(script).not.toContain('[object Object]');
      }
    );

    it('does not emit undefined when optional params are omitted', () => {
      // storageDirectory, additionalDirectory, isNfsAdditionalDirectory and
      // overrideDefaultServerArgs are optional — each must have a default.
      for (const engineType of ENGINES) {
        const script = generateLaunchScript({
          parser: new ContainerConfigParser(
            baseConfigPath,
            containerConfigPath,
            TAG
          ),
          engineType,
          port: 8888,
          token: 'jlab:srvr:abc123',
          platform: 'linux',
          cvmfsMode: 'false',
          osVersion: '2404',
          tinyrangePath: '/usr/local/bin/tinyrange'
        });
        expect(script).not.toContain('undefined');
        // TinyRange has no --name flag; only Docker/Podman name the container.
        if (engineType !== EngineType.TinyRange) {
          expect(script).toContain('--name neurodeskapp');
        }
      }
    });

    it('names the container consistently across --name and the lifecycle commands', () => {
      // --name comes from the config, the rm/logs commands from the same
      // parser — they must never drift apart.
      for (const engineType of [EngineType.Docker, EngineType.Podman]) {
        const script = generateLaunchScript(baseParams({ engineType }));
        expect(script).toContain('--name neurodeskapp');
        expect(script).toContain(`${engineType} logs -f neurodeskapp`);
      }
    });

    it('pulls and inspects the version the container actually runs', () => {
      // The image version can be overridden in the UI; every reference to it
      // in the script must come from the same source.
      const script = generateLaunchScript(baseParams({ tag: '2025-03-09' }));
      expect(script).toContain('docker.io/vnmd/neurodesktop:2025-03-09');
      expect(script).toContain('-e NEURODESKTOP_VERSION=2025-03-09');
      expect(script).not.toContain(`neurodesktop:${TAG}`);
    });

    it('does not double up the registry host in the pull command', () => {
      const script = generateLaunchScript(baseParams());
      expect(script).toContain(`docker pull ${IMAGE}`);
      expect(script).not.toContain('docker.io/docker.io/');
    });

    it('propagates token and port into the server args for every engine', () => {
      for (const engineType of ENGINES) {
        const script = generateLaunchScript(
          baseParams({ engineType, token: 'jlab:srvr:zzz999', port: 9999 })
        );
        expect(script).toContain("--ServerApp.token='jlab:srvr:zzz999'");
        // Docker/Podman publish 9999 on the host and keep 8888 inside the
        // container; TinyRange forwards and serves on the same port.
        expect(script).toContain(
          engineType === EngineType.TinyRange
            ? '--ServerApp.port=9999'
            : '--ServerApp.port=8888'
        );
      }
    });
  });

  // ── Cross-engine env parity ──

  describe('environment variables', () => {
    // The image needs these regardless of engine. Docker/Podman emit them
    // before the image name, TinyRange after it, but both build from the same
    // containerEnvArgs list in server.ts — this is the test that keeps that
    // single source of truth honest. A new common variable belongs here.
    const ALL_ENGINES_ENV = [
      `NEURODESKTOP_VERSION=${TAG}`,
      'CVMFS_DISABLE=false',
      'GRANT_SUDO=yes',
      'NEURODESKTOP_CVMFS_STARTUP_MODE=eager'
    ];

    it.each(ALL_ENGINES_ENV)('-e %s is set for every engine', name => {
      for (const engineType of ENGINES) {
        expect(generateLaunchScript(baseParams({ engineType }))).toContain(
          `-e ${name}`
        );
      }
    });

    it('sets CVMFS_DISABLE=true for every engine in Download mode', () => {
      for (const engineType of ENGINES) {
        expect(
          generateLaunchScript(baseParams({ engineType, cvmfsMode: 'true' }))
        ).toContain('-e CVMFS_DISABLE=true');
      }
    });

    it('declares each common variable exactly once per command', () => {
      // The two call sites used to be hand-duplicated; a partial dedup that
      // leaves a stale copy behind shows up as a repeated -e on one command.
      // Counting per line rather than per script, because Docker/Podman
      // repeat the whole run command in each branch of the image-exists check.
      for (const engineType of ENGINES) {
        const script = generateLaunchScript(baseParams({ engineType }));
        for (const name of ALL_ENGINES_ENV) {
          const key = `-e ${name.split('=')[0]}=`;
          const lines = script.split('\n').filter(l => l.includes(key));
          expect(lines.length).toBeGreaterThan(0);
          for (const line of lines) {
            expect(line.split(key).length - 1).toBe(1);
          }
        }
      }
    });

    // Docker/Podman-only: OLLAMA_HOST is meaningless without the
    // --add-host=host.docker.internal mapping, which TinyRange does not have.
    it('sets OLLAMA_HOST for Docker/Podman only', () => {
      expect(
        generateLaunchScript(baseParams({ engineType: EngineType.Docker }))
      ).toContain('OLLAMA_HOST');
      expect(
        generateLaunchScript(baseParams({ engineType: EngineType.Podman }))
      ).toContain('OLLAMA_HOST');
      expect(
        generateLaunchScript(baseParams({ engineType: EngineType.TinyRange }))
      ).not.toContain('OLLAMA_HOST');
    });

    it('passes NB_UID/NB_GID to Docker/Podman only', () => {
      // TinyRange fixes ownership through its -E chown prelude instead.
      expect(
        generateLaunchScript(baseParams({ engineType: EngineType.Docker }))
      ).toContain('-e NB_UID=');
      expect(
        generateLaunchScript(baseParams({ engineType: EngineType.TinyRange }))
      ).not.toContain('-e NB_UID=');
    });
  });

  // ── Syntax validation ──

  const unixMatrix = MATRIX.filter(([platform]) => platform !== 'win32');

  (hasBash ? describe : describe.skip)('shell syntax (bash -n)', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurodesk-launch-'));
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it.each(unixMatrix)(
      '%s / %s / additionalDirectory=%s parses',
      (platform, engineType, additionalDirectory) => {
        const script = generateLaunchScript(
          baseParams({ platform, engineType, additionalDirectory })
        );
        const file = path.join(
          tmpDir,
          `${platform}-${engineType}-${additionalDirectory ? 'wd' : 'nowd'}.sh`
        );
        fs.writeFileSync(file, script);
        expect(() => execFileSync('bash', ['-n', file])).not.toThrow();
      }
    );

    it('parses with NFS pre-check and overridden server args', () => {
      for (const variant of [
        {
          isNfsAdditionalDirectory: true,
          additionalDirectory: '/mnt/nfs-share'
        },
        { overrideDefaultServerArgs: true },
        { cvmfsMode: 'true' },
        { osVersion: '2204' }
      ]) {
        const script = generateLaunchScript(baseParams(variant));
        const file = path.join(tmpDir, `variant-${Object.keys(variant)[0]}.sh`);
        fs.writeFileSync(file, script);
        expect(() => execFileSync('bash', ['-n', file])).not.toThrow();
      }
    });
  });

  describe('batch syntax (Windows)', () => {
    const winMatrix = MATRIX.filter(([platform]) => platform === 'win32');

    it.each(winMatrix)(
      '%s / %s / additionalDirectory=%s contains no bash-isms',
      (platform, engineType, additionalDirectory) => {
        const script = generateLaunchScript(
          baseParams({ platform, engineType, additionalDirectory })
        );
        // cmd.exe has no command substitution, no `&>` redirect and no `[[`.
        expect(script).not.toContain('$(');
        expect(script).not.toContain('&>');
        expect(script).not.toContain('[[');
      }
    );

    it.each(winMatrix)(
      '%s / %s / additionalDirectory=%s enables delayed expansion when it uses !VAR!',
      (platform, engineType, additionalDirectory) => {
        const script = generateLaunchScript(
          baseParams({ platform, engineType, additionalDirectory })
        );
        if (/![A-Z_]+!/.test(script)) {
          // `!VAR!` expands to the literal text without this.
          expect(script).toContain('setlocal enabledelayedexpansion');
        }
      }
    );
  });
});
