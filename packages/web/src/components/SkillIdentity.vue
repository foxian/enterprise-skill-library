<template>
  <div class="skill-identity">
    <span class="skill-title" data-test="skill-display-name">{{ skill.displayName ?? skill.skillName }}</span>
    <el-tooltip v-if="skill.description?.trim()" :content="skill.description" :trigger="['hover', 'focus']" popper-class="skill-description-tooltip" placement="top">
      <span class="skill-description" data-test="skill-description-preview" tabindex="0">{{ skill.description }}</span>
    </el-tooltip>
    <div class="skill-identity-meta">
      <el-tag v-if="showNamespaceBadge" size="small" :type="skill.personalNamespace ? 'info' : 'primary'" data-test="scope-badge">
        {{ t(skill.personalNamespace ? 'skill.namespaceTypePersonal' : 'skill.namespaceTypeOrganization') }}
      </el-tag>
      <code class="skill-path">{{ skill.name }}</code>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLocaleState } from '../i18n/locale';
import type { SkillInventoryItem } from '../skills/skill-list';

withDefaults(defineProps<{
  skill: Pick<SkillInventoryItem, 'name' | 'skillName' | 'displayName' | 'description' | 'personalNamespace'>;
  showNamespaceBadge?: boolean;
}>(), { showNamespaceBadge: true });
const { t } = useLocaleState();
</script>

<style scoped>
.skill-identity {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
  min-width: 0;
}

.skill-title {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.skill-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: normal;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--el-text-color-regular);
}

.skill-identity-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.skill-path {
  min-width: 0;
  font-size: var(--fs-xs);
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
</style>
