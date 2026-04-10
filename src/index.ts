import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GarminClientManager, createScopedGarminClient } from './client';
import {
  registerActivityTools,
  registerHealthTools,
  registerTrendTools,
  registerSleepTools,
  registerBodyTools,
  registerPerformanceTools,
  registerProfileTools,
  registerRangeTools,
  registerSnapshotTools,
  registerTrainingTools,
  registerWellnessTools,
  registerChallengeTools,
  registerWriteTools,
} from './tools';

const server = new McpServer({
  name: 'garmin-connect-mcp',
  version: '1.0.0',
});

const accountSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Configured Garmin account alias. Required only when multiple accounts are configured.');

let clientManager: GarminClientManager;

try {
  clientManager = GarminClientManager.fromEnv(process.env);
} catch (error) {
  console.error(
    error instanceof Error
      ? `Error: ${error.message}`
      : 'Error: failed to resolve Garmin account configuration',
  );
  console.error(
    'Configure GARMIN_EMAIL and GARMIN_PASSWORD for single-account mode, or GARMIN_ACCOUNTS/GARMIN_USERS for multi-account mode.',
  );
  process.exit(1);
}

const originalRegisterTool = server.registerTool.bind(server);
server.registerTool = ((name, config, handler) => {
  const inputSchema = {
    ...(config.inputSchema ?? {}),
    account: accountSchema,
  };

  return originalRegisterTool(
    name,
    {
      ...config,
      inputSchema,
    },
    async (args = {}) => {
      const toolArgs = args as Record<string, unknown>;
      const { account, ...rest } = toolArgs;
      return clientManager.withAccount(typeof account === 'string' ? account : undefined, async () =>
        handler(rest),
      );
    },
  );
}) as typeof server.registerTool;

const client = createScopedGarminClient(clientManager);

registerActivityTools(server, client);
registerHealthTools(server, client);
registerTrendTools(server, client);
registerSleepTools(server, client);
registerBodyTools(server, client);
registerPerformanceTools(server, client);
registerProfileTools(server, client);
registerRangeTools(server, client);
registerSnapshotTools(server, client);
registerTrainingTools(server, client);
registerWellnessTools(server, client);
registerChallengeTools(server, client);
registerWriteTools(server, client);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Garmin Connect MCP server running on stdio for accounts: ${clientManager.listAccounts().join(', ')}`);
}

main().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});
