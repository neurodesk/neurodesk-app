import { execFileSync } from 'child_process';
import { ContainerConfigParser } from '../config/containerConfigParser';
import { EngineType } from '../config/settings';
import * as fs from 'fs';
import { generateLaunchScript } from '../server';
import * as os from 'os';
import * as path from 'path';

const engines = [EngineType.Docker, EngineType.Podman];
const directories = [
  '',
  '/data/project-with-hyphens',
  '/data/project with spaces'
];
const modes = ['false', 'true'];
const image = 'docker.io/vnmd/neurodesktop:2026-09-23';

function launch(
  platform: string,
  engineType: EngineType,
  cvmfsMode: string,
  additionalDirectory: string
) {
  return generateLaunchScript({
    parser: new ContainerConfigParser(
      path.join(__dirname, '../config/baseContainerConfig.yml'),
      path.join(__dirname, '../../../container_installer/neurodesk.yml'),
      '2026-09-23'
    ),
    platform,
    engineType,
    cvmfsMode,
    additionalDirectory,
    storageDirectory: '/data/storage',
    osVersion: '2404',
    tinyrangePath: '',
    port: 18888,
    token: 'test-token'
  });
}

const describeUnix = process.platform === 'win32' ? describe.skip : describe;

describeUnix('executed Docker/Podman launch matrix', () => {
  let directory: string;
  let callsFile: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-matrix-'));
    callsFile = path.join(directory, 'calls');
    const recorder = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.NEURODESK_ENGINE_CALLS, args.join('\\0') + '\\0\\0');
if (args[0] === '--version') console.log('podman version 5.0.0');
if (args[0] === 'image' && args[1] === 'inspect') console.log('exists');
if (args[0] === 'run' && args.includes('-d')) console.log('test-container');
`;
    for (const engine of engines) {
      fs.writeFileSync(path.join(directory, engine), recorder, { mode: 0o755 });
    }
    fs.writeFileSync(
      path.join(directory, 'route'),
      '#!/bin/sh\necho "gateway: 127.0.0.1"\n',
      { mode: 0o755 }
    );
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  for (const platform of ['linux', 'darwin']) {
    for (const engine of engines) {
      for (const mode of modes) {
        it.each(directories)(
          `${platform}/${engine} CVMFS_DISABLE=${mode} directory=%s`,
          additionalDirectory => {
            execFileSync(
              'bash',
              ['-c', launch(platform, engine, mode, additionalDirectory)],
              {
                env: {
                  ...process.env,
                  PATH: `${directory}${path.delimiter}${process.env.PATH}`,
                  NEURODESK_ENGINE_CALLS: callsFile
                },
                stdio: 'pipe',
                timeout: 10000
              }
            );
            const calls = fs
              .readFileSync(callsFile, 'utf8')
              .split('\0\0')
              .filter(Boolean)
              .map(call => call.split('\0'));
            const runs = calls.filter(
              args => args[0] === 'run' && args.includes('-d')
            );
            expect(runs).toHaveLength(1);
            const args = runs[0];
            expect(args).toContain(`CVMFS_DISABLE=${mode}`);
            expect(args).toContain(image);
            expect(args.indexOf(`CVMFS_DISABLE=${mode}`)).toBeLessThan(
              args.indexOf(image)
            );
            if (additionalDirectory) {
              expect(args[args.indexOf('--volume') + 1]).toBe(
                `${additionalDirectory}:/data`
              );
            } else {
              expect(args).not.toContain('--volume');
            }
            const name = args[args.indexOf('--name') + 1];
            expect(calls).toContainEqual(['rm', '-f', name]);
            expect(calls).toContainEqual(['logs', '-f', name]);
          }
        );
      }
    }
  }
});

describe('Windows generated launch matrix', () => {
  for (const engine of engines) {
    for (const mode of modes) {
      it.each([
        '',
        'C:\\data\\project-with-hyphens',
        'C:\\data\\project with spaces'
      ])(
        `${engine} CVMFS_DISABLE=${mode} directory=%s`,
        additionalDirectory => {
          const script = launch('win32', engine, mode, additionalDirectory);
          const command = script
            .split('\n')
            .find(
              line =>
                line.trim().startsWith(`${engine} run `) &&
                line.includes('CVMFS_DISABLE=')
            );
          expect(command).toContain(`-e CVMFS_DISABLE=${mode}`);
          expect(command).toContain(image);
          if (additionalDirectory) {
            expect(command).toContain(
              `--volume "${additionalDirectory.replace(/\\/g, '/')}":/data`
            );
          } else {
            expect(command).not.toContain('--volume');
          }
        }
      );
    }
  }
});
