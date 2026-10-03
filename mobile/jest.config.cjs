// Reuse the monorepo backend's existing Jest toolchain; install both workspaces first.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.js'],
  transform: {
    '^.+\.ts$': ['../backend/node_modules/ts-jest', {
      tsconfig: { module: 'commonjs', target: 'ES2021', esModuleInterop: true },
      diagnostics: false,
    }],
  },
};
