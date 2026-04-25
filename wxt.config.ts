import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  srcDir: '.',
  outDir: '.output',
  manifest: {
    name: 'Copycat — Context-aware autocomplete for AI chats',
    short_name: 'Copycat',
    description:
      'Your portable project memory. Ghost-text autocomplete in any AI chat window, powered by your own knowledge base.',
    version: '0.0.1',
    permissions: ['storage', 'activeTab', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Copycat',
      default_popup: 'popup.html',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  },
  vite: () => ({
    css: {
      postcss: './postcss.config.js',
    },
  }),
});
