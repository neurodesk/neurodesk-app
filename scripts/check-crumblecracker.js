// Fail packaging rather than shipping an app with a missing native backend.
const fs = require('fs');
const path = require('path');
const { Arch } = require('builder-util');
exports.default = async context => {
  const arch = Arch[context.arch];
  const binary =
    context.electronPlatformName === 'win32'
      ? 'NeurodeskAppX.exe'
      : 'NeurodeskAppX';
  const source = path.join(
    context.packager.info.appDir,
    'crumblecracker',
    arch,
    binary
  );
  const info = fs.statSync(source);
  if (!info.isFile() || info.size === 0) {
    throw new Error(
      'Build the matching CrumbleCracker backend before packaging: ' + source
    );
  }
};
