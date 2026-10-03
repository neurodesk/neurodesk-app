const meow = require('meow');
const fs = require('fs-extra');
const path = require('path');

// const neurodesktomlFilePath = path.resolve(__dirname, '../neurodesktop.toml');

const cli = meow(
  `
    Usage
      $ node neurodeskutil <options>

    Options
      --set-neurodesk-version   set Neurodesk version
    Other options:
      --help                     show usage information

    Examples
      $ node neurodeskutil --set-neurodesk-version 2026-09-23
`,
  {
    flags: {
      setNeurodeskVersion: {
        type: 'string',
        default: ''
      }
    }
  }
);

if (cli.flags.setNeurodeskVersion !== '') {
  const version = cli.flags.setNeurodeskVersion;
  const tomlPath = path.join(__dirname, '../neurodesktop.toml');
  const versionLine = /^jupyter_neurodesk_version\s*=.*$/m;

  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) {
      throw new Error(`Invalid Neurodesk version: ${version}`);
    }

    const toml = fs.readFileSync(tomlPath, 'utf8');
    if (!versionLine.test(toml)) {
      throw new Error(
        'jupyter_neurodesk_version not found in neurodesktop.toml'
      );
    }

    fs.writeFileSync(
      tomlPath,
      toml.replace(versionLine, `jupyter_neurodesk_version = "${version}"`)
    );
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
