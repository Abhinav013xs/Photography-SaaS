#!/usr/bin/env tsx
/**
 * CLI Initial Owner Account Setup & Password Reset
 * Usage:
 *   npx tsx scripts/setup-owner.ts --email=photographer@studio.com --password=SecurePassword123
 *   or via interactive prompt if executed in TTY.
 */
import readline from 'readline';
import {
  hashPassword,
  getPhotographerByEmail,
  getPhotographerCount,
  createPhotographer,
  updatePhotographerPassword,
} from '../apps/api/src/services/authService.js';
import { closeDatabase, getDatabasePool } from '../apps/api/src/infrastructure/database.js';

function parseArgs(): { email?: string; password?: string; name?: string; force?: boolean } {
  const args = process.argv.slice(2);
  const result: { email?: string; password?: string; name?: string; force?: boolean } = {};

  for (const arg of args) {
    if (arg.startsWith('--email=')) {
      result.email = arg.split('=')[1];
    } else if (arg.startsWith('--password=')) {
      result.password = arg.split('=')[1];
    } else if (arg.startsWith('--name=')) {
      result.name = arg.split('=')[1];
    } else if (arg === '--force') {
      result.force = true;
    }
  }

  return result;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log(`\n========================================`);
  console.log(`  Studio Lumina — Single Owner Setup`);
  console.log(`========================================\n`);

  try {
    const args = parseArgs();

    let email = args.email || process.env.INITIAL_OWNER_EMAIL;
    let password = args.password || process.env.INITIAL_OWNER_PASSWORD;
    let businessName = args.name || process.env.INITIAL_OWNER_NAME || 'Studio Lumina';

    if (!email && process.stdin.isTTY) {
      email = await prompt('Enter photographer email address: ');
    }

    if (!password && process.stdin.isTTY) {
      password = await prompt('Enter secure photographer password (min 8 chars): ');
    }

    if (!email || !password) {
      console.error('❌ Error: Both --email and --password are required to configure the owner.');
      console.error('Usage: npx tsx scripts/setup-owner.ts --email=admin@example.com --password=secret');
      process.exit(1);
    }

    if (password.length < 8) {
      console.error('❌ Error: Password must be at least 8 characters long.');
      process.exit(1);
    }

    const count = await getPhotographerCount();
    const existing = await getPhotographerByEmail(email);

    if (count > 0 && !existing && !args.force) {
      console.error('❌ Error: An owner account already exists. This platform supports exactly ONE owner.');
      console.error('To reset the existing account password, run with the existing email or use --force.');
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);

    if (existing) {
      console.log(`Updating credentials for existing owner: ${existing.email}...`);
      await updatePhotographerPassword(existing.id, passwordHash);
      console.log('✓ Successfully updated photographer password.');
    } else {
      console.log(`Creating initial photographer account for: ${email}...`);
      const created = await createPhotographer({
        email,
        password_hash: passwordHash,
        business_name: businessName,
      });
      console.log(`✓ Initial photographer account created successfully (ID: ${created.id}).`);
    }

    console.log('\nSecurity Notice: Plaintext credentials have been securely hashed and cleared from memory.\n');
  } catch (error) {
    console.error('❌ Setup failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

main();
