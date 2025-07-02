import dotenv from 'dotenv';

dotenv.config();

export const chainNetwork: 'devnet' | 'testnet' | 'mainnet' = process.env
  .CHAIN_NETWORK as 'devnet' | 'testnet' | 'mainnet' ??
  (process.env.NEXT_PUBLIC_CHAIN_NETWORK as 'devnet' | 'testnet' | 'mainnet') ??
  'devnet';
if (!chainNetwork) {
  throw new Error('CHAIN_NETWORK is not set: ' + process.env.CHAIN_NETWORK);
}

if (!['devnet', 'testnet', 'mainnet'].includes(chainNetwork)) {
  throw new Error('CHAIN_NETWORK must be one of: devnet, testnet, mainnet');
}

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
