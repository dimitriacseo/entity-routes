// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

const threshold = 50;

module.exports = {
    roots: ["<rootDir>/tests"],
    transform: {
        "^.+\\.tsx?$": "ts-jest",
    },
    testEnvironment: "node",
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
        "^@@/(.*)$": "<rootDir>/$1",
    },
    globals: {
        "ts-jest": {
            tsConfig: "<rootDir>/tests/tsconfig.json",
        },
    },
    setupFilesAfterEnv: ["jest-extended", "<rootDir>/tests/setup.ts"],
    collectCoverageFrom: ["<rootDir>/src/**/*.ts"],
    coverageThreshold: {
        global: {
            branches: threshold,
            functions: threshold,
            lines: threshold,
            statements: threshold,
        },
    },
    coverageReporters: ["lcov", "text"],
};
