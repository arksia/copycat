import type { Component } from 'vue'
import { createApp } from 'vue'
import App from './App.vue'
import '~/assets/tailwind.css'

createApp(App as Component).mount('#app')
