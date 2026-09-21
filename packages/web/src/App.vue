<template>
  <el-config-provider :locale="elementLocale">
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import enUS from 'element-plus/dist/locale/en.mjs';
import { useLocaleState } from './i18n/locale';

const { current } = useLocaleState();
const elementLocale = computed(() => (current.value === 'zh-CN' ? zhCn : enUS));
</script>
