/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it, describe, beforeEach, afterEach } from 'vitest';
import { TestRig } from './test-helper.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeJsonStringify } from '@google/gemini-cli-core/src/utils/safeJsonStringify.js';

describe('extension hook reloading', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => {
    if (rig) {
      await rig.cleanup();
    }
  });

  it('installs a local extension with hooks, updates them, checks they were reloaded', async () => {
    rig.setup('extension hook reload test', {
      settings: {
        experimental: { extensionReloading: true },
        tools: { enableHooks: true, core: ['read_file'] },
      },
    });

    const extensionDir = join(rig.testDir!, 'test-hook-extension');
    mkdirSync(extensionDir, { recursive: true });
    mkdirSync(join(extensionDir, 'hooks'), { recursive: true });

    createHook(extensionDir, '0.0.1');

    // Vitest retries share the same HOME directory set in globalSetup.ts.
    // We must ensure any extension from a previous failed attempt is removed
    // otherwise 'extensions install' will crash.
    try {
      await rig.runCommand(['extensions', 'uninstall', 'test-hook-extension']);
    } catch {
      /* ignore if not installed */
    }

    const installResult = await rig.runCommand(
      ['extensions', 'install', extensionDir],
      { stdin: 'y\n' },
    );
    expect(installResult).toContain('test-hook-extension');

    // install version 0.0.2 of the hook extension
    createHook(extensionDir, '0.0.2');

    const run = await rig.runInteractive('--debug');
    await run.expectText('You have 1 extension with an update available');

    // Trigger hook V1 via /clear and check hook logs for Version 1
    await rig.pollCommand(
      async () => {
        // \u0015 clears any text that might be left over in the input box
        await run.sendText('\u0015/clear');
        await run.sendKeys('\r');
      },
      () =>
        !!rig
          .readHookLogs()
          .find(
            (l) =>
              l.hookCall.hook_event_name === 'SessionStart' &&
              l.hookCall.stdout.includes('Hook Version 0.0.1'),
          ),
    );

    // Update the extension
    await run.sendText('/extensions update test-hook-extension');
    await run.sendKeys('\r');
    await run.sendKeys('\r');
    await run.expectText(
      'Extension "test-hook-extension" successfully updated: 0.0.1 → 0.0.2',
    );

    // Trigger hook V2 via /clear and check hook logs for Version 2
    await rig.pollCommand(
      async () => {
        // \u0015 clears any text that might be left over in the input box
        await run.sendText('\u0015/clear');
        await run.sendKeys('\r');
      },
      () =>
        !!rig
          .readHookLogs()
          .find(
            (l) =>
              l.hookCall.hook_event_name === 'SessionStart' &&
              l.hookCall.stdout.includes('Hook Version 0.0.2'),
          ),
    );
  });
});

function createHook(extensionDir: string, version: string) {
  const extensionConfig = {
    name: 'test-hook-extension',
    version,
  };
  writeFileSync(
    join(extensionDir, 'gemini-extension.json'),
    safeJsonStringify(extensionConfig, 2),
  );

  const command = `echo '{"decision": "allow", "reason": "Hook Version ${version}"}'`;
  const initialHooks = {
    hooks: {
      SessionStart: [
        {
          matcher: 'clear',
          hooks: [{ type: 'command', command }],
        },
      ],
    },
  };
  writeFileSync(
    join(extensionDir, 'hooks', 'hooks.json'),
    safeJsonStringify(initialHooks, 2),
  );
}
