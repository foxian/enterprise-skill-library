import { checkbox, confirm } from '@inquirer/prompts';
import {
  AgentInteractionRequiredError,
  createAgentInteractionRequest,
  findCleanupImpact,
  setInstalledSkillRetained,
  type AgentInteractionField,
  type CleanupCandidate,
  type ProtectedDependency
} from '@esl/core';

export interface DependencyCleanupOptions {
  command: 'update' | 'uninstall';
  candidates: CleanupCandidate[];
  /** 仍被保留但不在候选中的副本；部分清理不得让它们缺少依赖。 */
  protectedDependents?: ProtectedDependency[];
  /** 用户/Agent 明确给出的清理选择；缺省表示尚未选择。 */
  cleanup?: string[];
  cleanupProvided: boolean;
  agentMode?: boolean;
  interactive?: boolean;
  selectCleanup?: (candidates: CleanupCandidate[]) => Promise<string[]>;
  /** 依赖影响确认（#162）；target 为将被删除的技能。 */
  impact?: {
    target: string;
    affected: string[];
  };
  /** Agent 重跑时带回的影响确认范围；force 表示接受本次实际检查到的全部影响。 */
  acceptDependencyImpact?: string[];
  force?: boolean;
  confirmImpact?: (message: string) => Promise<boolean>;
}

export interface DependencyCleanupDecision {
  /** 需要实际删除的候选身份。 */
  selected: string[];
  /** 选择保留的候选身份。 */
  retained: string[];
  /** 是否应把未选中的候选持久化为「用户保留」。 */
  persistRetention: boolean;
  impactAccepted: boolean;
  impactDeclined: boolean;
}

const SELECT_ALL_TOKENS = new Set(['all', '*', 'All dependencies']);

function cleanupField(candidates: CleanupCandidate[], command: 'update' | 'uninstall'): AgentInteractionField {
  return {
    id: 'cleanup',
    kind: 'multiselect',
    label:
      command === 'uninstall'
        ? 'Select dependencies to remove as well. Nothing is preselected; leave all unchecked to keep them.'
        : 'Select dependencies that are no longer needed and should be removed. Nothing is preselected; leave all unchecked to keep them.',
    required: false,
    default: [],
    options: [
      { label: 'All dependencies', description: 'Select every listed dependency for removal' },
      ...candidates.map((candidate) => ({
        label: candidate.identity,
        description: `${candidate.identity}@${candidate.version}`
      }))
    ]
  };
}

function impactField(target: string, affected: string[]): AgentInteractionField {
  return {
    id: 'acceptDependencyImpact',
    kind: 'confirm',
    label:
      `Removing ${target} leaves ${affected.join(', ')} with a missing dependency. ` +
      `Continue and keep the depending skills installed? Affected: ${affected.join(', ')}`,
    required: true,
    default: false
  };
}


/** 影响是否已被本次重跑带回的确认范围覆盖：范围扩大时必须重新确认。 */
function impactAcceptedBy(options: DependencyCleanupOptions, affected: string[]): boolean {
  if (options.force === true) return true;
  if (!options.acceptDependencyImpact) return false;
  const accepted = new Set(options.acceptDependencyImpact);
  return affected.every((identity) => accepted.has(identity));
}

function validateCleanupSelection(
  candidates: CleanupCandidate[],
  selection: readonly string[]
): string[] {
  if (selection.some((entry) => SELECT_ALL_TOKENS.has(entry))) {
    return candidates.map((candidate) => candidate.identity);
  }
  const available = new Map(candidates.map((candidate) => [candidate.identity, candidate]));
  const unique = [...new Set(selection)];
  const unknown = unique.filter((identity) => !available.has(identity));
  if (unknown.length > 0) {
    throw new Error(
      `Invalid cleanup selection: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a removable dependency in the current graph. Re-run the command to inspect the current candidates.`
    );
  }
  return unique;
}

/**
 * 解析 update/uninstall 的依赖影响确认与清理多选（ADR-0043 / ADR-0072）。
 * 人工终端与 Agent 共用同一套候选与校验规则；Agent 在删除发生前以退出码 2
 * 发出结构化问题，模式开关本身不构成删除授权。
 */
export async function resolveDependencyCleanup(
  options: DependencyCleanupOptions
): Promise<DependencyCleanupDecision> {
  const affected = options.impact?.affected ?? [];
  let impactAccepted = affected.length === 0;
  let impactDeclined = false;

  if (affected.length > 0) {
    impactAccepted = impactAcceptedBy(options, affected);
    if (!impactAccepted) {
      if (options.agentMode) {
        throw new AgentInteractionRequiredError(
          createAgentInteractionRequest({
            command: options.command,
            fields: [impactField(options.impact!.target, affected)]
          })
        );
      }
      if (options.interactive) {
        const message =
          `Removing ${options.impact!.target} leaves the following skills with a missing dependency: ` +
          `${affected.join(', ')}. Continue and keep them installed?`;
        const accepted = options.confirmImpact
          ? await options.confirmImpact(message)
          : await confirm({ message, default: false });
        if (!accepted) {
          impactDeclined = true;
        } else {
          impactAccepted = true;
        }
      } else {
        // 无人值守缺少显式接受影响参数：不执行该删除。
        throw new Error(
          `Skill ${options.impact!.target} is required by ${affected.join(', ')}. ` +
            'Pass --accept-dependency-impact <identities> (or --force) to accept the missing dependency, or keep it installed.'
        );
      }
    }
  }

  if (impactDeclined) {
    return {
      selected: [],
      retained: [],
      persistRetention: false,
      impactAccepted: false,
      impactDeclined: true
    };
  }

  const candidates = options.candidates;
  let selected: string[];
  let retained: string[];

  if (options.cleanupProvided) {
    selected = validateCleanupSelection(candidates, options.cleanup ?? []);
    const selectedSet = new Set(selected);
    retained = candidates.map((candidate) => candidate.identity).filter((identity) => !selectedSet.has(identity));
  } else if (candidates.length === 0) {
    selected = [];
    retained = [];
  } else if (options.agentMode) {
    throw new AgentInteractionRequiredError(
      createAgentInteractionRequest({
        command: options.command,
        fields: [cleanupField(candidates, options.command)]
      })
    );
  } else if (options.interactive) {
    const chosen = await (options.selectCleanup ?? defaultCleanupCheckbox)(candidates, options.command);
    selected = validateCleanupSelection(candidates, chosen);
    const selectedSet = new Set(selected);
    retained = candidates.map((candidate) => candidate.identity).filter((identity) => !selectedSet.has(identity));
  } else {
    // 无人值守默认保留关联依赖，未选择不等于删除授权。
    selected = [];
    retained = candidates.map((candidate) => candidate.identity);
  }

  const cleanupAffected = findCleanupImpact(
    candidates,
    selected,
    options.protectedDependents ?? []
  );
  if (cleanupAffected.length > 0) {
    const combined = [...new Set([...affected, ...cleanupAffected])];
    if (!impactAcceptedBy(options, combined)) {
      if (options.agentMode) {
        throw new AgentInteractionRequiredError(
          createAgentInteractionRequest({
            command: options.command,
            fields: [impactField('the selected dependencies', combined)]
          })
        );
      }
      if (options.interactive) {
        const message =
          `Removing the selected dependencies leaves ${cleanupAffected.join(', ')} with a missing dependency. ` +
          'Continue and keep those skills installed?';
        const accepted = options.confirmImpact
          ? await options.confirmImpact(message)
          : await confirm({ message, default: false });
        if (!accepted) {
          selected = [];
          retained = candidates.map((candidate) => candidate.identity);
        }
      } else {
        throw new Error(
          `The cleanup selection would leave ${cleanupAffected.join(', ')} with a missing dependency. ` +
            'Include them in --cleanup as well, or pass --accept-dependency-impact <identities> to accept the missing dependency.'
        );
      }
    }
  }

  // 只有用户明确提交过选择（终端勾选或 Agent/参数回答）才持久化保留意图；
  // 无人值守的默认保留不代表用户已经作出选择。
  const persistRetention = options.cleanupProvided || options.interactive === true;
  return { selected, retained, persistRetention, impactAccepted, impactDeclined: false };
}

const CLEANUP_PROMPT: Record<'update' | 'uninstall', string> = {
  uninstall:
    'Dependencies no longer needed after this uninstall. Select any to remove as well (none selected by default; press "a" to select all):',
  update:
    'Dependencies no longer needed after this update. Select any to remove as well (none selected by default; press "a" to select all):'
};

async function defaultCleanupCheckbox(
  candidates: CleanupCandidate[],
  command: 'update' | 'uninstall'
): Promise<string[]> {
  return checkbox<string>({
    message: CLEANUP_PROMPT[command],
    choices: candidates.map((candidate) => ({
      name: `${candidate.identity} (v${candidate.version})`,
      value: candidate.identity,
      checked: false
    }))
  });
}

/** 持久化「保留」意图：未被选中的候选在后续命令中不再被当作可清理孤儿。 */
export async function persistRetainedCandidates(
  storeRoot: string,
  candidates: readonly CleanupCandidate[],
  retained: readonly string[]
): Promise<void> {
  const retainedSet = new Set(retained);
  for (const candidate of candidates) {
    if (retainedSet.has(candidate.identity)) {
      await setInstalledSkillRetained(storeRoot, candidate.identity, candidate.instanceId, true);
    }
  }
}
