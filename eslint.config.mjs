import antfu from '@antfu/eslint-config'

export default antfu(
  {
    vue: true,
    typescript: {
      tsconfigPath: 'tsconfig.json',
    },
    stylistic: {
      semi: false,
    },
  },
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'dist/**',
      'docs/**',
    ],
  },
  {
    files: ['**/*.vue'],
    rules: {
      'vue/html-self-closing': 'off',
      'vue/singleline-html-element-content-newline': 'off',
    },
  },
  {
    rules: {
      'no-alert': 'off',
    },
  },
)
