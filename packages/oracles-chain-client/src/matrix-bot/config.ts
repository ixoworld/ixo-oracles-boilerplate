export type NetworkType = 'devnet' | 'testnet' | 'mainnet';

export const chainNetwork: NetworkType =
  (typeof process !== 'undefined' && process.env
    ? ((process.env.CHAIN_NETWORK as NetworkType) ??
      (process.env.NEXT_PUBLIC_CHAIN_NETWORK as NetworkType) ??
      (process.env.NETWORK as NetworkType))
    : undefined) ?? 'devnet';
if (!chainNetwork) {
  throw new Error(
    'CHAIN_NETWORK is not set: ' +
      (typeof process !== 'undefined'
        ? process.env.CHAIN_NETWORK
        : 'process undefined'),
  );
}

if (!['devnet', 'testnet', 'mainnet'].includes(chainNetwork)) {
  throw new Error('CHAIN_NETWORK must be one of: devnet, testnet, mainnet');
}

// Network-specific default URLs (used as fallback when DID has no Matrix service)
const MatrixBotHomeServerUrl: Record<NetworkType, string> = {
  devnet: 'https://state.bot.devmx.ixo.earth',
  testnet: 'https://state.bot.testmx.ixo.earth',
  mainnet: 'https://state.bot.mx.ixo.earth',
};
const MatrixHomeServerUrl: Record<NetworkType, string> = {
  devnet: 'https://devmx.ixo.earth',
  testnet: 'https://testmx.ixo.earth',
  mainnet: 'https://mx.ixo.earth',
};
const MatrixHomeServerUrlCropped: Record<NetworkType, string> = {
  devnet: 'devmx.ixo.earth',
  testnet: 'testmx.ixo.earth',
  mainnet: 'mx.ixo.earth',
};

const MatrixRoomBotServerUrl: Record<NetworkType, string> = {
  devnet: 'https://rooms.bot.devmx.ixo.earth',
  testnet: 'https://rooms.bot.testmx.ixo.earth',
  mainnet: 'https://rooms.bot.mx.ixo.earth',
};

const MatrixClaimBotServerUrl: Record<NetworkType, string> = {
  devnet: 'https://claim.bot.devmx.ixo.earth',
  testnet: 'https://claim.bot.testmx.ixo.earth',
  mainnet: 'https://claim.bot.mx.ixo.earth',
};

// Legacy exports (for backwards compatibility - prefer DID-based resolution)
export const MatrixBotHomeServerUrlByNetwork =
  MatrixBotHomeServerUrl[chainNetwork];

export const MatrixHomeServerUrlByNetwork = MatrixHomeServerUrl[chainNetwork];
export const MatrixHomeServerUrlCroppedByNetwork =
  MatrixHomeServerUrlCropped[chainNetwork];
export const MatrixRoomBotServerUrlByNetwork =
  MatrixRoomBotServerUrl[chainNetwork];

export const getMatrixClaimBotServerUrlByNetwork = () =>
  MatrixClaimBotServerUrl[chainNetwork];

// Helper functions for getting default URLs by network (used as fallback)
export function getDefaultMatrixHomeServerUrl(network?: NetworkType): string {
  return MatrixHomeServerUrl[network ?? chainNetwork];
}

export function getDefaultMatrixHomeServerUrlCropped(
  network?: NetworkType,
): string {
  return MatrixHomeServerUrlCropped[network ?? chainNetwork];
}

export function getDefaultStateBotUrl(network?: NetworkType): string {
  return MatrixBotHomeServerUrl[network ?? chainNetwork];
}

export function getDefaultRoomsBotUrl(network?: NetworkType): string {
  return MatrixRoomBotServerUrl[network ?? chainNetwork];
}

export function getDefaultClaimBotUrl(network?: NetworkType): string {
  return MatrixClaimBotServerUrl[network ?? chainNetwork];
}

// Export all URL maps for use in did-matrix-batcher
export {
  MatrixHomeServerUrl,
  MatrixHomeServerUrlCropped,
  MatrixBotHomeServerUrl,
  MatrixRoomBotServerUrl,
  MatrixClaimBotServerUrl,
};
