#!/usr/bin/env node

// Quick test to verify the neurodesk config parser works with the actual neurodesk.yml file
const { createNeurodesktopConfigParser } = require('./neurodesk-config-parser');
const path = require('path');

async function testConfigParser() {
  try {
    console.log('Testing Neurodesk Config Parser...\n');

    // Test loading the actual neurodesk.yml file
    const configPath = path.join(__dirname, '../../neurodesk.yml');
    console.log('Loading config from:', configPath);

    const parser = createNeurodesktopConfigParser(configPath);
    console.log('✅ Config loaded successfully');

    // Test basic functionality
    console.log('Image Registry:', parser.getImageRegistry());
    console.log('Supported Engines:', parser.getSupportedEngines());

    // Test parsing arguments for each engine
    const testContext = {
      port: 8888,
      token: 'test-token-123',
      tag: '2025-06-10',
      cvmfsDisable: false,
      storageDir: '~/neurodesktop-storage',
      imageRegistry: 'vnmd/neurodesktop:2025-06-10',
      tinyrangePath: '/usr/local/bin/tinyrange',
      buildDir: '/tmp/build',
      additionalDir: '/data/test'
    };

    console.log('\n--- Testing Launch Arguments ---');

    const testCases = [
      { engine: 'docker', platform: 'unix' },
      { engine: 'docker', platform: 'windows' },
      { engine: 'podman', platform: 'unix' },
      { engine: 'podman', platform: 'windows' },
      { engine: 'tinyrange', platform: 'unix' },
      { engine: 'tinyrange', platform: 'windows' }
    ];

    for (const { engine, platform } of testCases) {
      try {
        const args = parser.parseArgs(engine, testContext, platform);
        console.log(`\n${engine.toUpperCase()} on ${platform.toUpperCase()}:`);
        console.log(`  Generated ${args.length} arguments`);
        console.log(`  First few: ${args.slice(0, 3).join(' ')}`);

        // Check for unresolved variables
        const unresolved = args.filter(
          arg => arg.includes('{') && arg.includes('}')
        );
        if (unresolved.length > 0) {
          console.log(
            `  ⚠️  Unresolved variables in: ${unresolved.join(', ')}`
          );
        } else {
          console.log(`  ✅ All variables resolved`);
        }
      } catch (error) {
        console.log(
          `\n${engine.toUpperCase()} on ${platform.toUpperCase()}: ❌ ${
            error.message
          }`
        );
      }
    }

    // Test additional directory config
    console.log('\n--- Testing Additional Directory Config ---');
    for (const engine of ['docker', 'podman', 'tinyrange']) {
      for (const platform of ['unix', 'windows']) {
        const config = parser.getAdditionalDirConfig(
          engine,
          '/test/path',
          platform
        );
        if (config) {
          console.log(`${engine}/${platform}: ${config}`);
        }
      }
    }

    // Test default server args
    console.log('\n--- Testing Default Server Arguments ---');
    const serverArgs = parser.getDefaultServerArgs(testContext);
    console.log(`Generated ${serverArgs.length} server arguments:`);
    serverArgs.forEach((arg, i) => console.log(`  ${i + 1}. ${arg}`));

    console.log('\n🎉 All tests completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testConfigParser();
}

module.exports = { testConfigParser };
