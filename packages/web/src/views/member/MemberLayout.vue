<template>
  <ConsoleShell brand="ESL工作台" :menu-items="menuItems">
    <router-view />
  </ConsoleShell>
</template>

<script setup lang="ts">
import ConsoleShell from '../../components/layout/ConsoleShell.vue';
import type { ConsoleMenuItem } from '../../components/layout/ConsoleShell.vue';
import { Files } from '@element-plus/icons-vue';

const menuItems: ConsoleMenuItem[] = [{ index: '/admin/member/skills', label: '我管理的技能', icon: Files }];
</script>
