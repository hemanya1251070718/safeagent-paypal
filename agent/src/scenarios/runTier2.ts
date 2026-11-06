import chalk from 'chalk';
import { cognitivePlanner } from '../core/planner.js';

async function run() {
  console.log(chalk.bold.yellow("\n================================================================="));
  console.log(chalk.bold.yellow("  SCENARIO 2: TIER 2 DISCRETIONARY (BIOMETRIC CONFIRMATION)"));
  console.log(chalk.bold.yellow("================================================================="));
  console.log(chalk.gray("Target Goal: 'Buy me a Keychron mechanical keyboard for coding'"));
  console.log(chalk.gray("Expected Policy: Cart total > $30 Tier 1 threshold -> Two-phase commit paused for 1-tap user biometric approval\n"));

  const result = await cognitivePlanner.planAndExecute("Buy me a Keychron mechanical keyboard");

  for (const step of result.trace) {
    if (step.type === 'THOUGHT') {
      console.log(chalk.blue(`[THOUGHT] `) + chalk.white(step.content));
    } else if (step.type === 'TOOL_CALL') {
      console.log(chalk.yellow(`[TOOL CALL] `) + chalk.yellowBright(step.content));
    } else if (step.type === 'TOOL_RESULT') {
      console.log(chalk.green(`[TOOL RESULT] `) + chalk.dim(step.content));
    } else if (step.type === 'GATEWAY_RESPONSE') {
      console.log(chalk.yellowBright(`[GATEWAY RESPONSE] `) + chalk.bold.yellow(step.content));
      console.log(chalk.dim(JSON.stringify(step.payload, null, 2)));
    }
  }

  console.log(chalk.bold.yellow(`\n✔ Scenario 2 Complete! Final State: ${result.finalStatus} (Awaiting WebAuthn/Biometric)\n`));
}

run().catch(console.error);

