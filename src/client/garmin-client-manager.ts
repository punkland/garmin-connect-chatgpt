import { AsyncLocalStorage } from 'node:async_hooks';
import { GarminClient } from './garmin.client';

export type GarminAccountConfig = {
  email: string;
  password: string;
};

type GarminAccountMap = Record<string, GarminAccountConfig>;

type AccountContext = {
  account?: string;
};

export class GarminClientManager {
  private clients = new Map<string, GarminClient>();
  private accountStorage = new AsyncLocalStorage<AccountContext>();

  constructor(
    private readonly accounts: GarminAccountMap,
    private readonly defaultAccount?: string,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv): GarminClientManager {
    const accountsEnv = env.GARMIN_ACCOUNTS ?? env.GARMIN_USERS;
    const defaultAccount = env.GARMIN_DEFAULT_ACCOUNT;

    if (accountsEnv) {
      const parsed = JSON.parse(accountsEnv) as GarminAccountMap;
      const accountNames = Object.keys(parsed);

      if (accountNames.length === 0) {
        throw new Error('GARMIN_ACCOUNTS/GARMIN_USERS must include at least one configured account');
      }

      for (const accountName of accountNames) {
        const config = parsed[accountName];
        if (!config?.email || !config?.password) {
          throw new Error(`Account "${accountName}" must include email and password`);
        }
      }

      const resolvedDefault = defaultAccount ?? (accountNames.length === 1 ? accountNames[0] : undefined);
      return new GarminClientManager(parsed, resolvedDefault);
    }

    if (!env.GARMIN_EMAIL || !env.GARMIN_PASSWORD) {
      throw new Error(
        'GARMIN_EMAIL and GARMIN_PASSWORD are required, or configure GARMIN_ACCOUNTS/GARMIN_USERS for multi-account mode.',
      );
    }

    const singleAccountName = defaultAccount ?? 'default';
    return new GarminClientManager(
      {
        [singleAccountName]: {
          email: env.GARMIN_EMAIL,
          password: env.GARMIN_PASSWORD,
        },
      },
      singleAccountName,
    );
  }

  withAccount<T>(account: string | undefined, callback: () => Promise<T>): Promise<T> {
    return this.accountStorage.run({ account }, callback);
  }

  getCurrentClient(): GarminClient {
    return this.getClient(this.accountStorage.getStore()?.account);
  }

  getClient(account?: string): GarminClient {
    const resolvedAccount = this.resolveAccount(account);
    const cachedClient = this.clients.get(resolvedAccount);
    if (cachedClient) return cachedClient;

    const config = this.accounts[resolvedAccount]!;
    const client = new GarminClient(config.email, config.password, undefined, resolvedAccount);
    this.clients.set(resolvedAccount, client);
    return client;
  }

  listAccounts(): string[] {
    return Object.keys(this.accounts);
  }

  private resolveAccount(account?: string): string {
    if (account) {
      if (!this.accounts[account]) {
        throw new Error(`Unknown Garmin account "${account}". Available accounts: ${this.listAccounts().join(', ')}`);
      }
      return account;
    }

    if (this.defaultAccount) return this.defaultAccount;

    const accountNames = this.listAccounts();
    if (accountNames.length === 1) return accountNames[0]!;

    throw new Error(`Multiple Garmin accounts configured. Specify the "account" input. Available accounts: ${accountNames.join(', ')}`);
  }
}

export function createScopedGarminClient(clientManager: GarminClientManager): GarminClient {
  return new Proxy({} as GarminClient, {
    get(_target, property, receiver) {
      const client = clientManager.getCurrentClient();
      const value = Reflect.get(client as object, property, receiver);
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });
}
