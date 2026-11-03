import { confirm, select } from '@inquirer/prompts';
import {
  executeListServers,
  executeRemoveServer,
  executeUseServer,
  type RemoveServerResult,
  type ServerListResult
} from './server-registry.js';

// `esl config server list` 的 TTY 管理台：实例 → 地址 → 操作。
// 浏览和选择只读；只有确认后的 Use / Remove 才调用显式命令路径。

const EXIT = '__exit__';
const BACK = '__back__';
const ACTION_USE = 'use';
const ACTION_REMOVE = 'remove';

type ServerListInstance = ServerListResult['instances'][number];
type ServerListAddress = ServerListInstance['addresses'][number];
type PendingAddress = ServerListResult['pendingAddresses'][number];

export interface ServerListSessionDeps {
  selectPrompt?: typeof select;
  confirmPrompt?: typeof confirm;
  list?: () => Promise<ServerListResult>;
  use?: (identifier: string) => Promise<{ instanceId: string | null; server: string; pending?: boolean }>;
  remove?: (identifier: string) => Promise<RemoveServerResult>;
  print?: (line: string) => void;
}

interface ResolvedDeps {
  selectPrompt: typeof select;
  confirmPrompt: typeof confirm;
  list: () => Promise<ServerListResult>;
  use: (identifier: string) => Promise<{ instanceId: string | null; server: string; pending?: boolean }>;
  remove: (identifier: string) => Promise<RemoveServerResult>;
  print: (line: string) => void;
}

function resolveDeps(deps: ServerListSessionDeps): ResolvedDeps {
  return {
    selectPrompt: deps.selectPrompt ?? select,
    confirmPrompt: deps.confirmPrompt ?? confirm,
    list: deps.list ?? (() => executeListServers()),
    use: deps.use ?? ((identifier) => executeUseServer(identifier)),
    remove: deps.remove ?? ((identifier) => executeRemoveServer(identifier)),
    print: deps.print ?? ((line) => console.log(line))
  };
}

function instanceLabel(instance: ServerListInstance): string {
  return `${instance.selected ? '* ' : '  '}${instance.instanceId}  preferred: ${instance.preferredAddress}`;
}

function addressLabel(instance: ServerListInstance, address: ServerListAddress): string {
  const tags = [address.current ? 'current' : null, address.preferred ? 'preferred' : null]
    .filter(Boolean)
    .join(', ');
  return tags ? `${address.url}  [${tags}]` : address.url;
}

function fallbackAddress(instance: ServerListInstance, removedUrl: string): string | null {
  return (
    instance.addresses.find((address) => address.url === instance.preferredAddress && address.url !== removedUrl)
      ?.url ??
    instance.addresses.find((address) => address.url !== removedUrl)?.url ??
    null
  );
}

function removeImpact(instance: ServerListInstance, address: ServerListAddress): string {
  if (instance.addresses.length === 1) {
    return (
      `Remove ${address.url}? This is the last address for instance ${instance.instanceId}; ` +
      'the local instance registration and its stored credentials will be removed. ' +
      'Server data and installed skills are not affected.'
    );
  }
  if (address.current) {
    const fallback = fallbackAddress(instance, address.url);
    return (
      `Remove the current address ${address.url}? The CLI will switch to ${fallback ?? 'another address'} ` +
      `within instance ${instance.instanceId}. Stored credentials for this instance are kept.`
    );
  }
  return (
    `Remove ${address.url}? Other addresses and the stored credentials for instance ` +
    `${instance.instanceId} are kept. Server data and installed skills are not affected.`
  );
}

async function confirmAction(deps: ResolvedDeps, message: string): Promise<boolean> {
  return deps.confirmPrompt({ message, default: false });
}

async function useAddress(
  identifier: string,
  deps: ResolvedDeps,
  message: string
): Promise<void> {
  const proceed = await confirmAction(deps, message);
  if (!proceed) {
    deps.print('Nothing changed.');
    return;
  }
  const result = await deps.use(identifier);
  deps.print(
    result.pending
      ? `Using unconfirmed address ${result.server}; confirm its Instance ID before authenticating.`
      : `Using ESL Server instance ${result.instanceId} at ${result.server}`
  );
}

async function removeAddress(
  identifier: string,
  deps: ResolvedDeps,
  message: string
): Promise<void> {
  const proceed = await confirmAction(deps, message);
  if (!proceed) {
    deps.print('Removal cancelled; nothing changed.');
    return;
  }
  const result = await deps.remove(identifier);
  if (result.removedInstance) {
    deps.print(
      `Removed the last address and local registration for the instance (${result.clearedInstanceIds.length} instance credential set cleared).`
    );
    return;
  }
  if (result.fallbackAddress) {
    deps.print(`Removed address; switched to ${result.fallbackAddress} within the same instance.`);
    return;
  }
  deps.print(`Removed address registration ${identifier}`);
}

async function runPendingAddress(
  pending: PendingAddress,
  deps: ResolvedDeps
): Promise<void> {
  const action = await deps.selectPrompt({
    message: `${pending.url} (Instance ID unconfirmed) — choose an action`,
    choices: [
      { name: 'Use this address', value: ACTION_USE },
      { name: 'Remove this address', value: ACTION_REMOVE },
      { name: 'Back to list', value: BACK },
      { name: 'Exit', value: EXIT }
    ]
  });
  if (action === BACK) {
    return;
  }
  if (action === EXIT) {
    throw new ExitSession();
  }
  if (action === ACTION_USE) {
    await useAddress(
      pending.url,
      deps,
      `Use ${pending.url}? Its Instance ID is not confirmed, so authenticating commands will stop until the Server identity is discovered.`
    );
    return;
  }
  await removeAddress(
    pending.url,
    deps,
    `Remove the unconfirmed address ${pending.url}? It will be removed from local configuration. Server data and installed skills are not affected.`
  );
}

async function runAddress(
  instance: ServerListInstance,
  address: ServerListAddress,
  deps: ResolvedDeps
): Promise<'back' | 'exit'> {
  for (;;) {
    const action = await deps.selectPrompt({
      message: `${address.url} — choose an action`,
      choices: [
        { name: 'Use this address', value: ACTION_USE },
        { name: 'Remove this address', value: ACTION_REMOVE },
        { name: 'Back to addresses', value: BACK },
        { name: 'Exit', value: EXIT }
      ]
    });
    if (action === BACK) {
      return 'back';
    }
    if (action === EXIT) {
      return 'exit';
    }
    if (action === ACTION_USE) {
      const proceed = await confirmAction(
        deps,
        `Use this address?\nInstance ID: ${instance.instanceId}\nAddress: ${address.url}`
      );
      if (!proceed) {
        deps.print('Nothing changed.');
        return 'back';
      }
      const result = await deps.use(address.url);
      deps.print(`Using ESL Server instance ${result.instanceId} at ${result.server}`);
      return 'back';
    }
    const proceed = await confirmAction(deps, removeImpact(instance, address));
    if (!proceed) {
      deps.print('Removal cancelled; nothing changed.');
      return 'back';
    }
    const result = await deps.remove(address.url);
    if (result.removedInstance) {
      deps.print(
        `Removed the last address; local registration and stored credentials for instance ${instance.instanceId} were cleared.`
      );
      return 'back';
    }
    if (result.fallbackAddress) {
      deps.print(
        `Removed ${address.url}; switched to ${result.fallbackAddress} within instance ${instance.instanceId}. Stored credentials were kept.`
      );
      return 'back';
    }
    deps.print(`Removed address registration ${address.url}; stored credentials were kept.`);
    return 'back';
  }
}

async function runInstance(
  instanceId: string,
  deps: ResolvedDeps
): Promise<'back' | 'exit'> {
  for (;;) {
    const result = await deps.list();
    const instance = result.instances.find((candidate) => candidate.instanceId === instanceId);
    if (!instance) {
      return 'back';
    }
    const chosen = await deps.selectPrompt({
      message: `Select an address for instance ${instanceId}`,
      choices: [
        ...instance.addresses.map((address) => ({
          name: addressLabel(instance, address),
          value: address.url
        })),
        { name: 'Back to instances', value: BACK },
        { name: 'Exit', value: EXIT }
      ]
    });
    if (chosen === BACK) {
      return 'back';
    }
    if (chosen === EXIT) {
      return 'exit';
    }
    const address = instance.addresses.find((candidate) => candidate.url === chosen);
    if (!address) {
      return 'back';
    }
    const navigation = await runAddress(instance, address, deps);
    if (navigation === 'exit') {
      return 'exit';
    }
  }
}

class ExitSession extends Error {}

export async function runServerListSession(deps: ServerListSessionDeps = {}): Promise<void> {
  const resolved = resolveDeps(deps);
  for (;;) {
    const result = await resolved.list();
    if (result.instances.length === 0 && result.pendingAddresses.length === 0) {
      resolved.print('No ESL Server instances registered.');
      return;
    }
    const chosen = await resolved.selectPrompt({
      message: 'Select an ESL Server instance to manage',
      choices: [
        ...result.instances.map((instance) => ({
          name: instanceLabel(instance),
          value: `instance:${instance.instanceId}`
        })),
        ...result.pendingAddresses.map((pending) => ({
          name: `  Unconfirmed address: ${pending.url}`,
          value: `pending:${pending.url}`
        })),
        { name: 'Exit', value: EXIT }
      ]
    });
    if (chosen === EXIT) {
      return;
    }
    try {
      if (chosen.startsWith('pending:')) {
        const pending = result.pendingAddresses.find(
          (candidate) => `pending:${candidate.url}` === chosen
        );
        if (pending) {
          await runPendingAddress(pending, resolved);
        }
      } else {
        const navigation = await runInstance(chosen.slice('instance:'.length), resolved);
        if (navigation === 'exit') {
          return;
        }
      }
    } catch (error) {
      if (error instanceof ExitSession) {
        return;
      }
      throw error;
    }
  }
}
