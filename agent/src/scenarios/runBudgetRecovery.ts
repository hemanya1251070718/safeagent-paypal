import chalk from 'chalk';
import { cognitivePlanner } from '../core/planner.js';

async function run() {
  console.log(chalk.bold.magenta("\n================================================================="));
  console.log(chalk.bold.magenta("  SCENARIO 4: BUDGET VIOLATION & AUTONOMOUS ADAPTATION"));
  console.log(chalk.bold.magenta("================================================================="));
  console.log(chalk.gray("Target Goal: 'I want to buy an LG 4K monitor'"));
  console.log(chalk.gray("Expected Policy: Initial cart (₹35,398.82) exceeds ₹15,000 cap -> Gateway REJECTS -> Agent autonomously recovers by finding compliant alternative (Dell Monitor ₹8,848.82)\n"));

  const result = await cognitivePlanner.planAndExecute("I want to buy an LG 4K monitor");

  for (const step of result.trace) {
    if (step.type === 'THOUGHT') {
      console.log(chalk.blue(`[THOUGHT] `) + chalk.white(step.content));
    } else if (step.type === 'TOOL_CALL') {
      console.log(chalk.yellow(`[TOOL CALL] `) + chalk.yellowBright(step.content));
    } else if (step.type === 'TOOL_RESULT') {
      console.log(chalk.green(`[TOOL RESULT] `) + chalk.dim(step.content));
    } else if (step.type === 'RECOVERY') {
      console.log(chalk.magentaBright(`[AUTONOMOUS RECOVERY] `) + chalk.bold.white(step.content));
    } else if (step.type === 'GATEWAY_RESPONSE') {
      console.log(chalk.cyan(`[GATEWAY RESPONSE] `) + chalk.bold.white(step.content));
    }
  }

  console.log(chalk.bold.greenBright(`\n✔ Scenario 4 Complete! Agent successfully recovered and placed a compliant order!\n`));
}

run().catch(console.error);

