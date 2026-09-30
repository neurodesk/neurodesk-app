/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ContainerConfigParser } from '../config/containerConfigParser';
import { buildVMRequest } from '../ndappx/request';

const baseConfigPath = path.join(
  __dirname,
  '../config/baseContainerConfig.yml'
);
const neuroimagingPath = path.join(
  __dirname,
  '../../../container_installer/neuroimaging.yml'
);
const neuroimaging = yaml.load(
  fs.readFileSync(neuroimagingPath, 'utf8')
) as any;
const defaultVersion = String(neuroimaging.defaultVersion);

const defaults = {
  image: 'ghcr.io/tinyrange/neurodesktop-glass:latest-estargz',
  memory_mib: 4096,
  cpus: 2,
  user: 'jovyan',
  home_mode: 'persistent' as const,
  storage_path: '/tmp/x'
};

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndappx-image-'));
});

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/** neuroimaging.yml with its ndappx block replaced. */
function configWith(ndappx?: { image?: string; registry?: string }): string {
  const config = { ...neuroimaging };
  delete config.ndappx;
  if (ndappx) {
    config.ndappx = ndappx;
  }
  const file = path.join(
    tmpDir,
    `app-${Math.random().toString(36).slice(2)}.yml`
  );
  fs.writeFileSync(file, yaml.dump(config));
  return file;
}

describe('NeurodeskAppX image for neuroimaging.yml', () => {
  it('boots the Glass image, not the Docker image', () => {
    const parser = new ContainerConfigParser(
      baseConfigPath,
      neuroimagingPath,
      '2025-01-01'
    );
    const image = parser.getNdappxImageName();
    expect(image).toMatch(/^ghcr\.io\/tinyrange\/neurodesktop-glass:/);
    expect(image).not.toContain(neuroimaging.registry);
    // Docker/Podman keep using the regular registry and selected version.
    expect(parser.getImageName()).toBe(`${neuroimaging.registry}:2025-01-01`);
  });

  it('still passes the welcome view version to the guest', () => {
    const parser = new ContainerConfigParser(
      baseConfigPath,
      neuroimagingPath,
      '2025-01-01'
    );
    const req = buildVMRequest({
      imageId: 'img_1',
      imageVersion: parser.getImageVersion(),
      storageDirectory: '/s',
      additionalDirectory: '',
      cvmfsEnabled: true,
      defaults
    });
    expect(req.env.NEURODESKTOP_VERSION).toBe('2025-01-01');
  });

  it('passes defaultVersion to the guest when no version was picked', () => {
    const parser = new ContainerConfigParser(baseConfigPath, neuroimagingPath);
    expect(parser.getImageVersion()).toBe(defaultVersion);
  });
});

describe('getNdappxImageName overrides', () => {
  it('without an ndappx block, uses registry and the selected version', () => {
    const parser = new ContainerConfigParser(
      baseConfigPath,
      configWith(),
      'latest-estargz'
    );
    expect(parser.getNdappxImageName()).toBe(
      `${neuroimaging.registry}:latest-estargz`
    );
  });

  it('ndappx.registry swaps the repository but keeps the selected version', () => {
    const parser = new ContainerConfigParser(
      baseConfigPath,
      configWith({ registry: 'ghcr.io/tinyrange/neurodesktop-glass' }),
      '20260807'
    );
    expect(parser.getNdappxImageName()).toBe(
      'ghcr.io/tinyrange/neurodesktop-glass:20260807'
    );
  });

  it('ndappx.image wins over ndappx.registry and the selected version', () => {
    const parser = new ContainerConfigParser(
      baseConfigPath,
      configWith({
        image: 'ghcr.io/example/glass:pinned',
        registry: 'ghcr.io/example/other'
      }),
      '2026-07-11'
    );
    expect(parser.getNdappxImageName()).toBe('ghcr.io/example/glass:pinned');
  });
});
