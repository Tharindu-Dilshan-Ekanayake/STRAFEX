import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // The 3D layer drives three.js objects imperatively from useFrame (the normal
    // react-three-fiber pattern): meshes made once in useMemo and moved every frame
    // without re-rendering. The React Compiler's immutability rule can't tell those
    // apart from React state, so it is off for these files only.
    files: ['src/game/**/*.{js,jsx}'],
    rules: { 'react-hooks/immutability': 'off' },
  },
])
