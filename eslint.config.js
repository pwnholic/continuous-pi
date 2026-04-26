import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import importX from "eslint-plugin-import-x";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default defineConfig(
    {
        ignores: ["node_modules/**", "dist/**", "**/*.js", "**/*.mjs", "**/*.cjs", "**/*.d.ts"],
    },
    {
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2025,
            },
        },
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: "warn",
        },
    },
    eslint.configs.recommended,
    tseslint.configs.recommended,
    {
        plugins: { "import-x": importX },
        settings: {
            "import-x/resolver": {
                typescript: { alwaysTryTypes: true },
                node: true,
            },
        },
        rules: {
            "import-x/order": [
                "warn",
                {
                    groups: [
                        "builtin",
                        "external",
                        "internal",
                        ["parent", "sibling", "index"],
                        "type",
                    ],
                    "newlines-between": "always",
                    alphabetize: { order: "asc", caseInsensitive: true },
                    warnOnUnassignedImports: true,
                },
            ],
            "import-x/no-duplicates": ["error", { "prefer-inline": true }],
            "import-x/no-cycle": ["warn", { maxDepth: 4 }],
            "import-x/named": "error",
            "import-x/no-self-import": "error",
            "import-x/no-useless-path-segments": ["warn", { noUselessIndex: true }],
            "import-x/extensions": ["warn", "ignorePackages", { js: "never", ts: "never" }],
        },
    },
    {
        plugins: { unicorn },
        rules: {
            "unicorn/no-for-loop": "warn",
            "unicorn/prefer-array-flat": "warn",
            "unicorn/prefer-array-flat-map": "warn",
            "unicorn/prefer-array-some": "warn",
            "unicorn/prefer-array-find": "warn",
            "unicorn/prefer-includes": "warn",
            "unicorn/prefer-string-slice": "warn",
            "unicorn/prefer-string-starts-ends-with": "warn",
            "unicorn/prefer-node-protocol": "error",
            "unicorn/prefer-top-level-await": "off", // project choice
            "unicorn/no-array-push-push": "warn",
            "unicorn/no-useless-undefined": ["warn", { checkArguments: false }],
            "unicorn/prefer-ternary": ["warn", "onlySingleLine"],
            "unicorn/throw-new-error": "error",
            "unicorn/no-instanceof-array": "error",
            "unicorn/no-new-array": "error",
            "unicorn/prefer-number-properties": "error",
            "unicorn/prevent-abbreviations": "off",
            "unicorn/filename-case": "off",
            "unicorn/no-null": "off",
        },
    },

    {
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "all",
                    argsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                    ignoreRestSiblings: true,
                    caughtErrors: "none",
                    varsIgnorePattern: "^_",
                },
            ],
            "prefer-const": "error",
            "no-var": "error",
            "prefer-template": "warn",
            "prefer-arrow-callback": "warn",
            "object-shorthand": ["warn", "always"],
            "prefer-rest-params": "warn",
            "prefer-spread": "warn",
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-wrappers": "error",
            "no-param-reassign": "warn",
            "no-console": ["warn", { allow: ["warn", "error"] }],
            eqeqeq: ["error", "always", { null: "ignore" }],
            curly: ["error", "all"],
            "logical-assignment-operators": ["warn", "always"],
            "prefer-object-has-own": "error",
            "no-promise-executor-return": "error",
            "no-constructor-return": "error",
            "no-self-compare": "error",
            "no-template-curly-in-string": "warn",
            "no-unreachable-loop": "error",
            "@typescript-eslint/naming-convention": [
                "error",
                {
                    selector: ["typeLike", "interface", "enum"],
                    format: ["PascalCase"],
                },
                {
                    selector: "typeParameter",
                    format: ["PascalCase"],
                    prefix: ["T", "K", "V", "E", "R"],
                    filter: { regex: "^(T|K|V|E|R)[A-Z]", match: false },
                },
                {
                    selector: "variable",
                    format: ["camelCase", "PascalCase", "UPPER_CASE"],
                    leadingUnderscore: "allow",
                },
                {
                    selector: "function",
                    format: ["camelCase", "PascalCase"],
                },
            ],

            "@typescript-eslint/consistent-type-imports": [
                "error",
                { prefer: "type-imports", fixStyle: "inline-type-imports" },
            ],
            "@typescript-eslint/consistent-type-exports": [
                "error",
                { fixMixedExportsWithInlineTypeSpecifier: true },
            ],
            "@typescript-eslint/no-import-type-side-effects": "error",
            "@typescript-eslint/no-inferrable-types": "warn",
            "@typescript-eslint/prefer-as-const": "error",
            "@typescript-eslint/no-require-imports": "error",
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unsafe-function-type": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            "@typescript-eslint/consistent-type-definitions": ["warn", "interface"],
            "@typescript-eslint/array-type": ["warn", { default: "array-simple" }],
            "@typescript-eslint/no-useless-constructor": "warn",
            "@typescript-eslint/prefer-optional-chain": "off",
            "@typescript-eslint/prefer-nullish-coalescing": "off",
            "@typescript-eslint/return-await": "off",
        },
    },
    eslintConfigPrettier,
);
