module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^electron$': '<rootDir>/src/__mocks__/electron.ts',
    '^electron-log$': '<rootDir>/src/__mocks__/electron-log.ts'
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          jsx: 'react',
          target: 'es2020',
          lib: ['es2020', 'dom'],
          outDir: './build/test',
          sourceMap: false,
          declaration: false,
          noImplicitAny: false,
          noUnusedLocals: false,
          isolatedModules: true
        }
      }
    ]
  }
};
