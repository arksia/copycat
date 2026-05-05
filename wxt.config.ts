import { defineConfig } from 'wxt'

const DEV_EXTENSION_CSP = {
  extension_pages:
    'script-src \'self\' \'wasm-unsafe-eval\' http://localhost:3000 http://localhost:3001; object-src \'self\';',
  sandbox:
    'script-src \'self\' \'unsafe-inline\' \'unsafe-eval\' http://localhost:3000 http://localhost:3001; sandbox allow-scripts allow-forms allow-popups allow-modals; child-src \'self\';',
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  srcDir: '.',
  outDir: '.output',
  manifest: env => ({
    name: 'Copycat — Context-aware autocomplete for AI chats',
    short_name: 'Copycat',
    description:
      'Your portable project memory. Ghost-text autocomplete in any AI chat window, powered by your own knowledge base.',
    version: '0.0.1',
    permissions: ['storage', 'activeTab', 'scripting', 'offscreen'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Copycat',
      default_popup: 'popup.html',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    content_security_policy: env.command === 'serve'
      ? DEV_EXTENSION_CSP
      : {
          extension_pages: 'script-src \'self\' \'wasm-unsafe-eval\'; object-src \'self\';',
        },
  }),
  vite: () => ({
    css: {
      postcss: './postcss.config.js',
    },
  }),
})
