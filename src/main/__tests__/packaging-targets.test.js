/* eslint-env jest */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Arch } = require('builder-util');
const { Platform } = require('app-builder-lib');
const { normalizeOptions } = require('electron-builder/out/builder');
const {
  computeArchToTargetNamesMap
} = require('app-builder-lib/out/targets/targetFactory');

const root = path.resolve(__dirname, '../../..');
const { build } = require(path.join(root, 'package.json'));
const workflow = yaml.load(
  fs.readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8')
);

// Exercise electron-builder's actual CLI + config resolution. Explicit target
// architectures can expand a single-arch CI job into unstaged backend builds.
test.each(workflow.jobs.publish.strategy.matrix.cfg)(
  '$platform_name packages only its staged $arch backend',
  ({ platform, arch }) => {
    const cliPlatform = platform.startsWith('linux') ? 'linux' : platform;
    const targetPlatform = {
      mac: Platform.MAC,
      linux: Platform.LINUX,
      win: Platform.WINDOWS
    }[cliPlatform];
    const options = normalizeOptions({ [cliPlatform]: [], [arch]: true });
    const targets = computeArchToTargetNamesMap(
      options.targets.get(targetPlatform),
      { platformSpecificBuildOptions: build[cliPlatform] },
      targetPlatform
    );
    expect([...targets.keys()]).toEqual([Arch[arch]]);
    expect(targets.get(Arch[arch])).toEqual(
      cliPlatform === 'mac' ? ['dmg', 'zip'] : build[cliPlatform].target
    );
  }
);
