<template>
  <div class="public-shell">
    <header class="public-header">
      <router-link to="/skills" class="public-brand" data-test="public-brand">
        <span class="public-brand-mark" aria-hidden="true"></span>
        <span>{{ t('catalog.title') }}</span>
      </router-link>
      <div class="public-header-actions">
        <LocaleSwitch />
        <router-link v-if="auth.isLoggedIn" :to="auth.homePath" class="public-link" data-test="public-console-link">
          {{ t('common.workspace') }}
        </router-link>
        <router-link v-else :to="{ name: 'login' }" class="public-link" data-test="public-login-link">
          {{ t('catalog.login') }}
        </router-link>
      </div>
    </header>
    <main class="public-main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '../../stores/auth';
import { useLocaleState } from '../../i18n/locale';
import LocaleSwitch from '../../components/LocaleSwitch.vue';

const auth = useAuthStore();
const { t } = useLocaleState();
</script>

<style scoped>
.public-shell {
  min-height: 100vh;
  background: var(--paper-50);
}

.public-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: var(--header-height);
  padding: 0 var(--content-padding);
  background: var(--ink-900);
}

.public-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: var(--fs-md);
  font-weight: 600;
  text-decoration: none;
}

.public-brand-mark {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--celadon-400);
}

.public-header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.public-link {
  color: var(--celadon-100);
  font-size: var(--fs-sm);
  text-decoration: none;
}

.public-link:hover {
  color: #fff;
}

.public-main {
  max-width: 1040px;
  margin: 0 auto;
  padding: var(--content-padding);
}
</style>
