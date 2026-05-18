// High-level orchestrators shared by every surface (CLI, MCP server, GitHub
// Action). Each `run*` function is self-contained and accepts injectable
// baseDir / configDir / fetch / streams, so a wrapper only has to translate
// its native input into a call here.

export {
  runFeed,
  isFeedError,
  type FeedOptions,
  type FeedResult,
  type PerSourceResult,
} from './feed.js';

export {
  runAgentsCreate,
  runAgentsList,
  type AgentsCreateOptions,
  type AgentsListOptions,
} from './agents.js';

export {
  runLogin,
  runLogout,
  isLoginError,
  type LoginOptions,
  type LoginResult,
  type LogoutOptions,
} from './login.js';

export {
  runBind,
  isBindError,
  type BindOptions,
  type BindResult,
} from './bind.js';

export {
  runAspirationsAdd,
  runAspirationsList,
  isAspirationsError,
  type AspirationsAddOptions,
  type AspirationsAddResult,
  type AspirationsListOptions,
  type AspirationsListResult,
  type AspirationSummary,
} from './aspirations.js';

export {
  runEvalAdd,
  runEvalList,
  isEvalError,
  EvalError,
  type EvalAddOptions,
  type EvalAddResult,
  type EvalListOptions,
  type EvalListResult,
} from './evals.js';

import { isAspirationsError } from './aspirations.js';
import { isBindError } from './bind.js';
import { isEvalError } from './evals.js';
import { isFeedError } from './feed.js';
import { isLoginError } from './login.js';

// True for any error a surface should present to the user as a plain message
// (bad input, auth needed, registry rejection) rather than an internal crash.
export function isUserFacingError(err: unknown): err is Error {
  return (
    isFeedError(err) ||
    isLoginError(err) ||
    isBindError(err) ||
    isAspirationsError(err) ||
    isEvalError(err)
  );
}
