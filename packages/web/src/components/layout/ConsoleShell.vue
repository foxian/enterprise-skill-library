<template>
  <el-container class="console-shell" direction="horizontal">
    <el-aside width="var(--sidebar-width)">
      <router-link class="console-brand" :to="auth.homePath" data-test="console-brand">
        <span class="console-brand-mark" aria-hidden="true"></span>
        <span class="console-brand-text">{{ brand }}</span>
      </router-link>
      <el-menu router :default-active="activeMenuPath" class="console-menu">
        <el-menu-item v-for="item in menuItems" :key="item.index" :index="item.index">
          <el-icon v-if="item.icon" class="console-menu-icon">
            <component :is="item.icon" />
          </el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
      <div class="console-aside-user">
        <el-dropdown trigger="click" placement="top-start" :teleported="false" @command="onCommand">
          <button class="console-user" type="button" data-test="user-dropdown">
            <el-avatar :size="30" class="console-user-avatar">{{ avatarText }}</el-avatar>
            <span class="console-user-meta">
              <span class="console-user-name">{{ auth.username }}</span>
              <span class="console-user-role">{{ roleLabel }}</span>
            </span>
            <span class="console-user-caret" aria-hidden="true">▾</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <div class="console-user-meta-panel">
                <div class="console-user-meta-name">{{ auth.username }}</div>
                <div class="console-user-meta-sub">
                  <el-tag size="small" effect="plain">{{ roleLabel }}</el-tag>
                  <span v-if="managerOrgsLabel" class="console-user-meta-org">{{ managerOrgsLabel }}</span>
                </div>
              </div>
              <el-dropdown-item command="change-password" data-test="change-password">{{ t('common.changePassword') }}</el-dropdown-item>
              <el-dropdown-item command="logout" divided data-test="logout">{{ t('common.signOut') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-aside>
    <el-container direction="vertical">
      <el-header class="console-header" height="var(--header-height)">
        <div class="console-header-title">
          <h1 class="console-header-name">{{ currentTitle }}</h1>
          <span v-if="currentDescription" class="console-header-desc">{{ currentDescription }}</span>
        </div>
        <LocaleSwitch class="console-header-locale" />
      </el-header>
      <el-main class="console-main">
        <div class="console-content">
          <slot></slot>
        </div>
      </el-main>
    </el-container>
    <ChangePasswordDialog ref="dialog" />
  </el-container>
</template>

<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ChangePasswordDialog from '../ChangePasswordDialog.vue';
import LocaleSwitch from '../LocaleSwitch.vue';
import { useLocaleState } from '../../i18n/locale';
import { useAuthStore } from '../../stores/auth';

export interface ConsoleMenuItem {
  index: string;
  label: string;
  icon?: Component;
}

const props = defineProps<{
  brand: string;
  menuItems: ConsoleMenuItem[];
}>();

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { t } = useLocaleState();
const dialog = ref<InstanceType<typeof ChangePasswordDialog> | null>(null);

/**
 * 二级路由（organizations/:org/members、skills/:scope/:name/manage 等）不匹配
 * 任何菜单项，原来整栏无高亮。这里回落到最长前缀的菜单项，让用户知道
 * 自己属于哪个栏目。`${index}/` 带尾斜杠匹配，避免 /skills 误中 /skills-x。
 */
const activeMenuPath = computed<string>(() => {
  const path = route.path;
  if (props.menuItems.some((item) => item.index === path)) return path;
  const parent = props.menuItems
    .filter((item) => path.startsWith(`${item.index}/`))
    .sort((a, b) => b.index.length - a.index.length)[0];
  return parent?.index ?? path;
});

const avatarText = computed<string>(() => (auth.username ?? '?').charAt(0).toUpperCase());

// 平台角色只有两个（ADR-0033），组织身份不在这里当角色展示。
const roleLabel = computed<string>(() => (auth.isPlatformAdmin ? t('common.platformAdministrator') : t('common.user')));

const managerOrgsLabel = computed<string>(() => {
  const orgs = auth.organizations.filter((membership) => membership.isOwnerMember).map((m) => m.org);
  return orgs.length > 0 ? t('common.organizationManagement', { orgs: orgs.join(', ') }) : '';
});

const currentTitle = computed<string>(() => {
  const meta = route.meta as { title?: string };
  const title = meta.title ? t(String(meta.title)) : '';
  return title;
});

const currentDescription = computed<string>(() => {
  const meta = route.meta as { description?: string };
  const description = meta.description ? t(String(meta.description)) : '';
  return description;
});

async function onCommand(command: string): Promise<void> {
  if (command === 'change-password') {
    dialog.value?.open();
  } else if (command === 'logout') {
    auth.logout();
    await router.push({ name: 'login' });
  }
}
</script>
