export {
  RegistryError,
  DeviceCodeStartSchema,
  TokenResponseSchema,
  BindResponseSchema,
  AspirationResponseSchema,
  type DeviceCodeStart,
  type TokenResponse,
  type BindRequest,
  type BindResponse,
  type AspirationRequest,
  type AspirationResponse,
} from './types.js';

export {
  startDeviceCode,
  pollForToken,
  bindAgent,
  addAspiration,
  type RegistryDeps,
  type PollDeps,
} from './client.js';
