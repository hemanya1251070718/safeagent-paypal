import chalk from 'chalk';
import { cognitivePlanner } from '../core/planner.js';

async function run() {
  console.log(chalk.bold.cyan("\n================================================================="));
  console.log(chalk.bold.cyan("  SCENARIO 1: TIER 1 MICRO-TRANSACTION (ZERO-TOUCH EXECUTION)"));
  console.log(chalk.bold.cyan("================================================================="));
  console.log(chalk.gray("Target Goal: 'Find me an ergonomic wireless mouse under ₹2,000'"));
  console.log(chalk.gray("Expected Policy: Cart total <= ₹2,500 Tier 1 threshold -> Instant server capture via PayPal Vault\n"));

  const result = await cognitivePlanner.planAndExecute("Find me an ergonomic wireless mouse under ₹2,000");

  for (const step of result.trace) {
    if (step.type === 'THOUGHT') {
      console.log(chalk.blue(`[THOUGHT] `) + chalk.white(step.content));
    } else if (step.type === 'TOOL_CALL') {
      console.log(chalk.yellow(`[TOOL CALL] `) + chalk.yellowBright(step.content));
    } else if (step.type === 'TOOL_RESULT') {
      console.log(chalk.green(`[TOOL RESULT] `) + chalk.dim(step.content));
    } else if (step.type === 'GATEWAY_RESPONSE') {
      console.log(chalk.magenta(`[GATEWAY RESPONSE] `) + chalk.bold.greenBright(step.content));
      console.log(chalk.dim(JSON.stringify(step.payload, null, 2)));
    }
  }

  console.log(chalk.bold.green(`\n✔ Scenario 1 Complete! Final State: ${result.finalStatus}\n`));
}

run().catch(console.error);

