import { generateLaunchScript, ILaunchScriptParams } from '../server';
import { execFileSync } from 'child_process';
import { EngineType } from '../config/settings';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Structural invariants for the generated launch script.
 *
 * These tests do not assert on specific flags — launch-script.test.ts does
 * that. They assert on properties that must hold no matter which flags a
 * future fix adds, so that a change made for one engine/platform cannot
 * silently break another. The two failure modes they guard against:
 *
 *   1. A flag added in the wrong position (e.g. after the image name, where
 *      docker treats it as a container argument rather than a run flag).
 *   2. A string edit that breaks shell/batch syntax — today the only thing
 *      that catches that is a full container launch in e2e.
 */

const TAG = '2024-01-01';

function baseParams(
  overrides: Partial<ILaunchScriptParams> = {}
): ILaunchScriptParams {
  return {
    engineType: EngineType.Docker,
    port: 8888,
    token: 'jlab:srvr:abc123',
    tag: TAG,
    platform: 'linux',
    workingDirectory: '',
    cvmfsMode: 'false',
    overrideDefaultServerArgs: false,
    tinyrangePath: '/usr/local/bin/tinyrange',
    osVersion: '2404',
    containerName: 'neurodeskapp',
    ...overrides
  };
}

const PLATFORMS = ['linux', 'darwin', 'win32'];
const ENGINES = [EngineType.Docker, EngineType.Podman, EngineType.TinyRange];

/** Every (platform, engine) pair, in both "no working dir" and "working dir" shapes. */
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
        baseParams({ platform, engineType, workingDirectory: '/tmp' })
      );
      const image =
        engineType === EngineType.Podman
          ? `docker.io/vnmd/neurodesktop:${TAG}`
          : `vnmd/neurodesktop:${TAG}`;

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
      '%s / %s / workingDirectory=%s',
      (platform, engineType, workingDirectory) => {
        const script = generateLaunchScript(
          baseParams({ platform, engineType, workingDirectory })
        );
        expect(script).not.toContain('{token}');
        expect(script).not.toContain('{port}');
        expect(script).not.toContain('undefined');
        expect(script).not.toContain('NaN');
        expect(script).not.toContain('[object Object]');
      }
    );

    it('does not emit undefined when optional params are omitted', () => {
      // containerName, storageDirectory and isNfsWorkingDirectory are optional
      // on ILaunchScriptParams — each must have a working default.
      for (const engineType of ENGINES) {
        const script = generateLaunchScript({
          engineType,
          port: 8888,
          token: 'jlab:srvr:abc123',
          tag: TAG,
          platform: 'linux',
          workingDirectory: '',
          cvmfsMode: 'false',
          overrideDefaultServerArgs: false,
          tinyrangePath: '/usr/local/bin/tinyrange',
          osVersion: '2404'
        });
        expect(script).not.toContain('undefined');
        // TinyRange has no --name flag; only Docker/Podman name the container.
        if (engineType !== EngineType.TinyRange) {
          expect(script).toContain('--name neurodeskapp');
        }
      }
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
    // Set by every engine. TinyRange does not use commonLaunchArgs, so it
    // re-declares these inside its -E block; both paths must stay in sync.
    const ALL_ENGINES_ENV = ['NEURODESKTOP_VERSION', 'CVMFS_DISABLE'];

    it.each(ALL_ENGINES_ENV)('%s is set for every engine', name => {
      for (const engineType of ENGINES) {
        expect(generateLaunchScript(baseParams({ engineType }))).toContain(
          name
        );
      }
    });

    // Pins the current Docker/Podman-only env vars. TinyRange builds its own
    // arg list and never picks up commonLaunchArgs, so these do NOT reach it.
    // If that divergence is ever resolved, this test should be moved into
    // ALL_ENGINES_ENV above rather than deleted.
    const CONTAINER_ONLY_ENV = [
      'GRANT_SUDO=yes',
      'NEURODESKTOP_CVMFS_STARTUP_MODE=eager',
      'OLLAMA_HOST'
    ];

    it.each(CONTAINER_ONLY_ENV)(
      '%s is set for Docker/Podman and absent for TinyRange',
      name => {
        expect(
          generateLaunchScript(baseParams({ engineType: EngineType.Docker }))
        ).toContain(name);
        expect(
          generateLaunchScript(baseParams({ engineType: EngineType.Podman }))
        ).toContain(name);
        expect(
          generateLaunchScript(baseParams({ engineType: EngineType.TinyRange }))
        ).not.toContain(name);
      }
    );
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
      '%s / %s / workingDirectory=%s parses',
      (platform, engineType, workingDirectory) => {
        const script = generateLaunchScript(
          baseParams({ platform, engineType, workingDirectory })
        );
        const file = path.join(
          tmpDir,
          `${platform}-${engineType}-${workingDirectory ? 'wd' : 'nowd'}.sh`
        );
        fs.writeFileSync(file, script);
        expect(() => execFileSync('bash', ['-n', file])).not.toThrow();
      }
    );

    it('parses with NFS pre-check and overridden server args', () => {
      for (const variant of [
        { isNfsWorkingDirectory: true, workingDirectory: '/mnt/nfs-share' },
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
      '%s / %s / workingDirectory=%s contains no bash-isms',
      (platform, engineType, workingDirectory) => {
        const script = generateLaunchScript(
          baseParams({ platform, engineType, workingDirectory })
        );
        // cmd.exe has no command substitution, no `&>` redirect and no `[[`.
        expect(script).not.toContain('$(');
        expect(script).not.toContain('&>');
        expect(script).not.toContain('[[');
      }
    );

    it.each(winMatrix)(
      '%s / %s / workingDirectory=%s enables delayed expansion when it uses !VAR!',
      (platform, engineType, workingDirectory) => {
        const script = generateLaunchScript(
          baseParams({ platform, engineType, workingDirectory })
        );
        if (/![A-Z_]+!/.test(script)) {
          // `!VAR!` expands to the literal text without this.
          expect(script).toContain('setlocal enabledelayedexpansion');
        }
      }
    );
  });
});
