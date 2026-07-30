const meow = require('meow');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');

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
      $ node neurodeskutil --set-neurodesk-version
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
  const url = `https://raw.githubusercontent.com/NeuroDesk/neurodesk.github.io/main/data/neurodesktop.toml`;

  https
    .get(url, res => {
      let body = '';

      res.on('data', chunk => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          fs.writeFileSync(path.join(__dirname, '../neurodesktop.toml'), body);

          process.exit(0);
        } catch (error) {
          console.error(error.message);
          process.exit(1);
        }
      });
    })
    .on('error', error => {
      console.error(error.message);
      process.exit(1);
    });
}
