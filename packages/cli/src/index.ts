import { Command } from 'commander';
import * as pc from 'picocolors';
import { daemonCommands } from './daemon';
import { platformCommands } from './platform';
import { postCommands } from './post';
import { commentCommands } from './comment';
import { taskCommands } from './task';
import { taskPrepareCommands } from './task-prepare';
import { templateCommands } from './template';
import { resultCommands, resultMediaCommands } from './result';
import { strategyCommands } from './strategy';
import { analyzeCommands } from './analyze';
import { queueCommands } from './queue';
import { logsCommands } from './logs';
import { version } from '@analyze-cli/core';

const program = new Command();

program
  .name('analyze-cli')
  .description('AI-powered social media content analysis CLI tool')
  .version(version);

// Daemon commands
daemonCommands(program);

// Platform commands
platformCommands(program);

// Post commands
postCommands(program);

// Comment commands
commentCommands(program);

// Task commands
taskCommands(program);

// Task prepare-data command
taskPrepareCommands(program);

// Template commands
templateCommands(program);

// Result commands
resultCommands(program);
resultMediaCommands(program);

strategyCommands(program);

analyzeCommands(program);
queueCommands(program);
logsCommands(program);

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  console.log(pc.bold('\n  analyze-cli') + ' - AI-powered social media content analysis\n');
  program.outputHelp();
}
