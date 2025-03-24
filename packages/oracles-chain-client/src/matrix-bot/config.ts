export const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID;
if (!CHAIN_ID) {
  throw new Error('CHAIN_ID is not set');
}
export const chainNetwork = CHAIN_ID?.startsWith('ixo')
  ? 'mainnet'
  : CHAIN_ID?.startsWith('pandora')
    ? 'testnet'
    : 'devnet';

const MatrixBotHomeServerUrl = {
  devnet: 'https://state.bot.devmx.ixo.earth',
  testnet: 'https://state.bot.testmx.ixo.earth',
  mainnet: 'https://state.bot.mx.ixo.earth',
};
const MatrixHomeServerUrl = {
  devnet: 'https://devmx.ixo.earth',
  testnet: 'https://testmx.ixo.earth',
  mainnet: 'https://mx.ixo.earth',
};
const MatrixHomeServerUrlCropped = {
  devnet: 'devmx.ixo.earth',
  testnet: 'testmx.ixo.earth',
  mainnet: 'mx.ixo.earth',
};

const MatrixRoomBotServerUrl = {
  devnet: 'https://rooms.bot.devmx.ixo.earth',
  testnet: 'https://rooms.bot.testmx.ixo.earth',
  mainnet: 'https://rooms.bot.mx.ixo.earth',
};

export const MatrixBotHomeServerUrlByNetwork =
  MatrixBotHomeServerUrl[chainNetwork];

export const MatrixHomeServerUrlByNetwork = MatrixHomeServerUrl[chainNetwork];
export const MatrixHomeServerUrlCroppedByNetwork =
  MatrixHomeServerUrlCropped[chainNetwork];
export const MatrixRoomBotServerUrlByNetwork =
  MatrixRoomBotServerUrl[chainNetwork];
