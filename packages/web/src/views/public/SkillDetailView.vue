<template>
  <section>
    <router-link to="/skills" class="detail-back" data-test="detail-back">{{ t('catalog.back') }}</router-link>

    <el-alert
      v-if="loginRequired"
      type="warning"
      :title="t('catalog.loginToView')"
      :closable="false"
      data-test="detail-login-required"
    >
      <router-link :to="{ name: 'login' }" class="detail-login-link">{{ t('catalog.login') }}</router-link>
    </el-alert>
    <el-alert v-else-if="errorMessage" type="error" :title="errorMessage" :closable="false" data-test="detail-error" />

    <div v-loading="loading" class="detail-body">
      <template v-if="skill">
        <header class="detail-header">
          <div>
            <h1 class="detail-title" data-test="detail-title">{{ skill.displayName || skill.name }}</h1>
            <div class="detail-identity" data-test="detail-identity">{{ skill.name }}</div>
          </div>
          <el-tag v-if="skill.visibility" :type="visibilityTagType(skill.visibility)" data-test="detail-visibility">
            {{ visibilityText(skill.visibility) }}
          </el-tag>
        </header>

        <p class="detail-description" data-test="detail-description">{{ skill.description }}</p>

        <div class="detail-meta">
          <span v-if="latestStableVersion">
            {{ t('catalog.latest') }}: <strong>{{ latestStableVersion }}</strong>
          </span>
          <span>{{ t('catalog.downloads', { count: skill.downloadCount ?? 0 }) }}</span>
        </div>

        <div v-if="skill.keywords && skill.keywords.length > 0" class="detail-keywords">
          <span class="detail-label">{{ t('catalog.keywords') }}</span>
          <el-tag v-for="keyword in skill.keywords" :key="keyword" size="small" type="info">{{ keyword }}</el-tag>
        </div>

        <el-card class="detail-card" data-test="detail-install-card">
          <template #header>{{ t('catalog.installCommand') }}</template>
          <div class="detail-command">
            <code data-test="detail-install-command">{{ installCommand }}</code>
            <el-button size="small" data-test="detail-copy-command" @click="copyCommand">{{ t('catalog.copy') }}</el-button>
          </div>
          <p class="detail-command-hint">{{ installHint }}</p>
        </el-card>

        <el-card class="detail-card" data-test="detail-releases-card">
          <template #header>{{ t('catalog.releaseNotes') }}</template>
          <el-empty v-if="releases.length === 0" :description="t('catalog.noReleases')" />
          <ul v-else class="detail-releases">
            <li v-for="release in releases" :key="release.version" class="detail-release">
              <div class="detail-release-head">
                <strong>{{ release.version }}</strong>
                <span class="detail-release-downloads">
                  {{ t('catalog.downloads', { count: release.downloadCount ?? 0 }) }}
                </span>
                <a v-if="release.packageUrl" :href="release.packageUrl" class="detail-release-link">
                  {{ t('catalog.download') }}
                </a>
              </div>
              <div v-if="release.deprecatedMessage" class="detail-release-deprecated">
                {{ release.deprecatedMessage }}
              </div>
            </li>
          </ul>
        </el-card>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError, apiRequest } from '../../api/client';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { visibilityTagType, visibilityTextKey } from '../../skills/visibility';

interface PublicRelease {
  version: string;
  packageUrl?: string;
  downloadCount?: number;
  deprecatedMessage?: string | null;
}

interface PublicSkill {
  name: string;
  displayName?: string;
  description: string;
  keywords?: string[];
  visibility?: string;
  versions?: string[];
  downloadCount?: number;
  releases?: PublicRelease[];
}

const route = useRoute();
const { t } = useLocaleState();
const skill = ref<PublicSkill | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const loginRequired = ref(false);

const identity = computed(() => {
  const scope = String(route.params.scope ?? '').replace(/^@/, '');
  const skillName = String(route.params.skillName ?? '');
  return `@${scope}/${skillName}`;
});

const releases = computed(() => skill.value?.releases ?? []);

// 详情契约的 versions 已按版本倒序；最新稳定版取第一个不带预发布后缀的版本。
const latestStableVersion = computed(() =>
  (skill.value?.versions ?? []).find((version) => /^\d+\.\d+\.\d+$/.test(version))
);

const installCommand = computed(() => `esl skill install ${identity.value}`);

const installHint = computed(() => {
  if (skill.value?.visibility === 'anonymous') {
    return t('catalog.visibilityAnonymous');
  }
  return skill.value?.visibility === 'public'
    ? t('catalog.visibilityPublic')
    : t('catalog.visibilityPrivate');
});

function visibilityText(visibility: string): string {
  return t(visibilityTextKey(visibility));
}

async function copyCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(installCommand.value);
  } catch {
    // 非安全上下文里 clipboard 不可用；命令本身已展示，复制失败不阻断浏览。
  }
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  loginRequired.value = false;
  try {
    skill.value = await apiRequest<PublicSkill>(
      `/api/skills/${encodeURIComponent(identity.value)}`
    );
  } catch (error) {
    skill.value = null;
    if (error instanceof ApiError && error.status === 401) {
      // 未登录：给出登录入口，而不是泄露技能是否存在。
      loginRequired.value = true;
    } else if (error instanceof ApiError && error.status === 404) {
      errorMessage.value = t('catalog.notFound');
    } else {
      // 403 是已登录但无权读取 private：沿用服务端的可行动文案。
      errorMessage.value = formatRequestError(error) || t('catalog.loadFailed');
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => route.fullPath, load);
</script>

<style scoped>
.detail-back {
  display: inline-block;
  margin-bottom: 18px;
  color: var(--celadon-600);
  font-size: var(--fs-sm);
  text-decoration: none;
}

.detail-back:hover {
  text-decoration: underline;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.detail-title {
  margin: 0;
  color: var(--ink-900);
  font-size: var(--fs-2xl);
}

.detail-identity {
  margin-top: 4px;
  color: var(--ink-400);
  font-family: var(--font-family-mono);
  font-size: var(--fs-sm);
}

.detail-description {
  margin: 18px 0;
  color: var(--ink-700);
  font-size: var(--fs-md);
  line-height: 1.7;
}

.detail-meta {
  display: flex;
  gap: 24px;
  color: var(--ink-500);
  font-size: var(--fs-sm);
}

.detail-keywords {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 0;
  flex-wrap: wrap;
}

.detail-label {
  color: var(--ink-500);
  font-size: var(--fs-sm);
}

.detail-card {
  margin-top: 18px;
}

.detail-command {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.detail-command code {
  flex: 1;
  min-width: 260px;
  padding: 8px 12px;
  background: var(--ink-900);
  color: var(--celadon-100);
  border-radius: var(--radius-md);
  font-family: var(--font-family-mono);
  font-size: var(--fs-sm);
}

.detail-command-hint {
  margin: 12px 0 0;
  color: var(--ink-500);
  font-size: var(--fs-xs);
}

.detail-releases {
  margin: 0;
  padding: 0;
  list-style: none;
}

.detail-release {
  padding: 10px 0;
  border-bottom: 1px solid var(--paper-200);
}

.detail-release:last-child {
  border-bottom: none;
}

.detail-release-head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.detail-release-downloads {
  color: var(--ink-500);
  font-size: var(--fs-xs);
}

.detail-release-link {
  margin-left: auto;
  color: var(--celadon-600);
  font-size: var(--fs-sm);
}

.detail-release-deprecated {
  margin-top: 4px;
  color: #b26a00;
  font-size: var(--fs-xs);
}

.detail-login-link {
  color: var(--celadon-600);
}
</style>
