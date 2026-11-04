// Parse edited workflows and syntax-check Bash blocks without executing them.
const fs = require('fs');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');
const files = [
  '.github/workflows/publish.yml',
  '.github/workflows/e2e-app-test.yml',
  '.github/actions/build-crumblecracker/action.yml'
];
for (const file of files) {
  const document = yaml.load(fs.readFileSync(file, 'utf8'));
  const groups = document.jobs ? Object.values(document.jobs) : [document.runs];
  let count = 0;
  for (const group of groups) {
    for (const step of group.steps || []) {
      if (!step.run || (step.shell && !step.shell.startsWith('bash'))) {
        continue;
      }
      const result = spawnSync('bash', ['-n'], {
        input: step.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'expression'),
        encoding: 'utf8'
      });
      if (result.status !== 0) {
        throw new Error(file + ': ' + step.name + ': ' + result.stderr);
      }
      count++;
    }
  }
  console.log(file + ': YAML parsed, ' + count + ' Bash blocks syntax-checked');
}
