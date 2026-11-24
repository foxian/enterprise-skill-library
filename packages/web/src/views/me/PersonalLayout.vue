<template>
  <ConsoleShell :brand="t('common.workspace')" :menu-items="menuItems">
    <router-view />
  </ConsoleShell>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ConsoleShell from '../../components/layout/ConsoleShell.vue';
import type { ConsoleMenuItem } from '../../components/layout/ConsoleShell.vue';
import { DataBoard, Compass, Files, OfficeBuilding, Promotion, User } from '@element-plus/icons-vue';
import { useLocaleState } from '../../i18n/locale';

// 个人控制台的菜单（ADR-0035）。组织治理不是独立视角——它挂在「我的组织」下，
// 且入口只对所有者成员渲染。第六项「技能目录」是登录主体的可安装技能发现入口，
// 与管理向「技能」并列但内容口径不同（spec #200）。
const { t } = useLocaleState();
const menuItems = computed<ConsoleMenuItem[]>(() => [
  { index: '/admin/me/overview', label: t('nav.overview'), icon: DataBoard },
  { index: '/admin/me/personal-info', label: t('nav.personalInfo'), icon: User },
  { index: '/admin/me/orgs', label: t('nav.myOrganizations'), icon: OfficeBuilding },
  { index: '/admin/me/skills', label: t('nav.skills'), icon: Files },
  { index: '/admin/me/catalog', label: t('nav.skillCatalog'), icon: Compass },
  { index: '/admin/me/invitations', label: t('nav.invitations'), icon: Promotion }
]);
</script>
