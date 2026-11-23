import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import nextPlugin from "@next/eslint-plugin-next"

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/vendor/**",
      "**/public/preview/**",
      "**/.device/**",
      "poc/**",
      "scratch/**",
    ],
  },
  {
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Frontend boundary: never import backend workspace or db
  {
    files: ["frontend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "backend",
              message: "frontend must never import backend.",
            },
          ],
          patterns: [
            {
              group: [
                "../backend",
                "../backend/**",
                "../../backend/**",
                "@/db",
                "@/db/**",
                "../db",
                "../db/**",
              ],
              message: "frontend must never import backend or direct db.",
            },
          ],
        },
      ],
    },
  },

  // Backend boundary: never import frontend workspace
  {
    files: ["backend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "frontend",
              message: "backend must never import frontend.",
            },
          ],
          patterns: [
            {
              group: [
                "../frontend",
                "../frontend/**",
                "../../frontend/**",
              ],
              message: "backend must never import frontend.",
            },
          ],
        },
      ],
    },
  },

  // Shared boundary: pure TS only, no Node, DB, React, frontend, or backend
  {
    files: ["shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "backend",
              message: "shared must never import backend.",
            },
            {
              name: "frontend",
              message: "shared must never import frontend.",
            },
            {
              name: "pg",
              message: "shared must never import pg.",
            },
            {
              name: "react",
              message: "shared must never import react.",
            },
          ],
          patterns: [
            {
              group: [
                "node:*",
                "../backend/**",
                "../frontend/**",
                "react/*",
              ],
              message: "shared must be pure TypeScript without Node, DB, React, frontend, or backend imports.",
            },
          ],
        },
      ],
    },
  },

  // Controllers boundary (controllers never touch db directly)
  {
    files: ["backend/src/controllers/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db*", "**/db*", "**/db/**", "../../db*", "../../../db*"],
              message: "controllers must never touch db directly; use domain services instead.",
            },
          ],
        },
      ],
    },
  },

  // Services boundary (services never import express)
  {
    files: ["backend/src/services/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "express",
              message: "services must never import express.",
            },
          ],
          patterns: [
            {
              group: ["express/*"],
              message: "services must never import express.",
            },
          ],
        },
      ],
    },
  }
)
