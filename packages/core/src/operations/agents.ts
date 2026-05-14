import { createAgent, listAgents, readAgentSkills } from '../agent.js';

export interface AgentsCreateOptions {
  name?: string;
  baseDir?: string;
  stdout?: NodeJS.WritableStream;
}

export async function runAgentsCreate(opts: AgentsCreateOptions = {}): Promise<string> {
  const stdout = opts.stdout ?? process.stdout;
  const agent = await createAgent({ name: opts.name, baseDir: opts.baseDir });
  stdout.write(`${agent.config.id}\n`);
  return agent.config.id;
}

export interface AgentsListOptions {
  baseDir?: string;
  stdout?: NodeJS.WritableStream;
}

export async function runAgentsList(opts: AgentsListOptions = {}): Promise<void> {
  const stdout = opts.stdout ?? process.stdout;
  const agents = await listAgents(opts.baseDir);
  if (agents.length === 0) {
    stdout.write('(no agents in this directory — run `modex agents create` to make one)\n');
    return;
  }
  for (const a of agents) {
    const skills = await readAgentSkills(a.paths.skillsFile);
    const name = a.config.name.length > 0 ? a.config.name : '(unnamed)';
    stdout.write(`${a.config.id}\t${name}\t${a.config.created_at}\t${skills.length} skills\n`);
  }
}
