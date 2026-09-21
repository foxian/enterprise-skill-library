import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import './styles/theme/tokens.css';
import './styles/theme/element-overrides.css';
import './styles/console.css';
import App from './App.vue';
import router from './router';

async function bootstrap(): Promise<void> {
  const { initializeLocale } = await import('./i18n/locale');
  await initializeLocale();
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(ElementPlus);
  app.mount('#app');
}

void bootstrap();
