const prettier = require('eslint-plugin-prettier');

module.exports = [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        Promise: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        Date: 'readonly',
        Set: 'readonly',
        JSON: 'readonly',
        parseInt: 'readonly',
        isNaN: 'readonly',
        Map: 'readonly',
        Object: 'readonly',
        Array: 'readonly',
        Error: 'readonly',
        Number: 'readonly',
        Math: 'readonly',
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_|next|req|res', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'multi-line'],
    },
  },
  {
    ignores: ['node_modules/', 'db/migrations/', 'dist/'],
  },
];
