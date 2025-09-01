// ================================================================================
// SERVER WALLET GENERATION
// ================================================================================

import { Slip10, Slip10Curve, stringToPath } from '@cosmjs/crypto';
import { toHex } from '@cosmjs/encoding';
import {
  DirectSecp256k1HdWallet,
  DirectSecp256k1Wallet,
} from '@cosmjs/proto-signing';
import { utils } from '@ixo/impactxclient-sdk';

export interface ServerWallet {
  address: string;
  privateKey: Uint8Array; // Keep as raw bytes for efficiency
  privateKeyHex: string; // Also provide hex for logging/debugging
  publicKeyHex: string;
  mnemonic: string;
  did: string;
}

/**
 * Generate a complete server wallet with all key formats
 * @param mnemonic - Optional mnemonic (will generate if not provided)
 * @returns Complete wallet information
 */
export async function generateServerWallet(
  walletMnemonic: string,
): Promise<ServerWallet> {
  // Create wallet from mnemonic
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(walletMnemonic, {
    prefix: 'ixo',
  });
  const account = (await wallet.getAccounts())[0];

  // Derive private key manually (like in secpClientWithPrivateKey)
  const seed = await utils.mnemonic.Bip39.mnemonicToSeed(
    new utils.mnemonic.EnglishMnemonic(walletMnemonic),
  );

  const { privkey } = Slip10.derivePath(
    Slip10Curve.Secp256k1,
    seed,
    stringToPath("m/44'/118'/0'/0/0"), // Standard Cosmos path
  );

  // Create wallet from derived private key to validate
  const walletFromPrivKey = await DirectSecp256k1Wallet.fromKey(privkey, 'ixo');
  const derivedAccount = (await walletFromPrivKey.getAccounts())[0];
  if (!account || !derivedAccount) {
    throw new Error('Account not found');
  }

  // Ensure addresses match (validation)
  if (account.address !== derivedAccount.address) {
    throw new Error('Address mismatch in key derivation');
  }

  return {
    address: account.address,
    privateKey: privkey,
    privateKeyHex: toHex(privkey),
    publicKeyHex: toHex(account.pubkey),
    mnemonic: walletMnemonic,
    did: utils.did.generateSecpDid(account.address),
  };
}
