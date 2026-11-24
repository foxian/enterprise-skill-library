<template>
  <section>
    <router-link :to="backTarget" class="detail-back" data-test="detail-back">
      {{ t(backLabelKey) }}
    </router-link>

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
          <span v-if="latestStableVersion" data-test="detail-latest-stable">
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
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import { ApiError, apiRequest } from '../../api/client';
import { reportCatalogFunnelEvent } from '../../api/funnel-events';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { readCatalogBucket } from '../../skills/catalog-query';
import { visibilityTagType, visibilityTextKey } from '../../skills/visibility';
import { useAuthStore } from '../../stores/auth';

interface PublicRelease {
  version: string;
  packageUrl?: string;
  downloadCount?: number;
  deprecatedMessage?: string | null;
}

interface PublicSkill {
  name: string;
  // 详情响应的稳定技能 id（ADR-0077）：漏斗第二、三层事件以它作为分析键。
  skillId?: string;
  displayName?: string;
  description: string;
  keywords?: string[];
  visibility?: string;
  // 最新稳定版由服务端计算（排除 prerelease，保留 build metadata）；前端只兜底。
  latestStableVersion?: string;
  versions?: string[];
  downloadCount?: number;
  releases?: PublicRelease[];
}

const route = useRoute();
const auth = useAuthStore();
const { t } = useLocaleState();
const skill = ref<PublicSkill | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const loginRequired = ref(false);

// 来向标记（T4 目录卡片带 skill_catalog，公开目录卡片带 public_catalog）。未知值
// 与缺失一律按「直拼 URL」处理，避免伪造参数额外开出口。
const TRAFFIC_SOURCES = ['skill_catalog', 'public_catalog'] as const;

const trafficSource = computed<string | null>(() => {
  const raw = route.query.traffic_source;
  return typeof raw === 'string' && (TRAFFIC_SOURCES as readonly string[]).includes(raw) ? raw : null;
});

// 单一返回出口：匿名、公开目录来向与平台管理员都回公开目录（ADR-0033：超管
// 不进个人控制台，指过去只会被守卫弹回登录页）；登录主体其余情况回技能目录
// （直拼 URL 默认全量视图）。匿名永不出现「返回技能目录」。
const backIsCatalog = computed<boolean>(
  () => auth.isLoggedIn && !auth.isPlatformAdmin && trafficSource.value !== 'public_catalog'
);

const backTarget = computed<RouteLocationRaw>(() => {
  if (!backIsCatalog.value) {
    return '/skills';
  }
  const query: Record<string, string> = { bucket: readCatalogBucket(route.query.bucket) };
  const keyword = typeof route.query.q === 'string' ? route.query.q.trim() : '';
  if (keyword) query.q = keyword;
  return { name: 'me-catalog', query };
});

const backLabelKey = computed<string>(() =>
  backIsCatalog.value ? 'catalog.backToSkillCatalog' : 'catalog.back'
);

const identity = computed(() => {
  const scope = String(route.params.scope ?? '').replace(/^@/, '');
  const skillName = String(route.params.skillName ?? '');
  return `@${scope}/${skillName}`;
});

const releases = computed(() => skill.value?.releases ?? []);

// 最新稳定版以服务端 `latestStableVersion` 为准（排除 prerelease，含 build
// metadata）；旧响应没有该字段时才回退到 versions 的 `x.y.z` 形态。
const latestStableVersion = computed(
  () =>
    skill.value?.latestStableVersion ??
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

// 漏斗第二、三层（ADR-0077）：只有详情内容成功渲染后才可能发生；统一拒绝页、
// 未登录提示与加载失败都不上报。桶只在技能目录来向携带。
function reportDetailFunnelEvent(action: 'detail_view' | 'install_command_copy'): void {
  const skillId = skill.value?.skillId;
  // 详情契约缺技能 id 时宁可不报，也不发出无法归属的漏斗事件。
  if (!skillId) return;
  reportCatalogFunnelEvent({
    action,
    skillId,
    bucket: trafficSource.value === 'skill_catalog' ? readCatalogBucket(route.query.bucket) : null,
    trafficSource: trafficSource.value
  });
}

// 复制安装命令：把成功/失败收敛为可观察的返回值，供后续计数（T6）与外层复用；
// 剪贴板不可用（非安全上下文、权限被拒）时命令本身仍展示，不阻断浏览，也不提示成功。
async function copyCommand(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(installCommand.value);
  } catch {
    return false;
  }
  // 只有剪贴板写入成功 resolve 后才是第三层动作；失败不产生事件。
  reportDetailFunnelEvent('install_command_copy');
  ElMessage.success(t('catalog.copied'));
  return true;
}

async function load(): Promise<void> {
  const wasLoggedIn = auth.isLoggedIn;
  loading.value = true;
  errorMessage.value = '';
  loginRequired.value = false;
  try {
    skill.value = await apiRequest<PublicSkill>(
      `/api/skills/${encodeURIComponent(identity.value)}`
    );
    reportDetailFunnelEvent('detail_view');
  } catch (error) {
    skill.value = null;
    if (error instanceof ApiError && error.status === 401) {
      // 未登录：给出登录入口，而不是泄露技能是否存在。
      loginRequired.value = true;
    } else if (error instanceof ApiError && error.status === 404) {
      // 已登录主体的 404 覆盖「不存在 / 无权 / 已归档」三种状态（ADR-0076），
      // 只能给出统一提示；匿名保持既有「未找到该技能」。
      errorMessage.value = wasLoggedIn ? t('catalog.unavailable') : t('catalog.notFound');
    } else {
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
