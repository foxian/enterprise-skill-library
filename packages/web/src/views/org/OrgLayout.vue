<template>
  <ConsoleShell brand="ESL工作台" :menu-items="menuItems">
    <router-view />
  </ConsoleShell>
</template>

<script setup lang="ts">
import ConsoleShell from '../../components/layout/ConsoleShell.vue';
import type { ConsoleMenuItem } from '../../components/layout/ConsoleShell.vue';
import { User, UserFilled, Lock } from '@element-plus/icons-vue';

const menuItems: ConsoleMenuItem[] = [
  { index: '/admin/org/members', label: '成员管理', icon: User },
  { index: '/admin/org/teams', label: '团队管理', icon: UserFilled },
  { index: '/admin/org/skills', label: '技能权限', icon: Lock }
];
</script>
