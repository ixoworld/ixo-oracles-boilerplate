import 'dotenv/config';
import { Ed25519, sha256 } from '@cosmjs/crypto';
import { toHex, toUtf8 } from '@cosmjs/encoding';
import {
  type IIdentifier,
  type MinimalImportableIdentifier,
  type MinimalImportableKey,
  type TAgent,
} from '@veramo/core';

export type AgentConfig = {
  credentialsMnemonic: string;
  issuerDid: string;
};

export type AgentPluginMethodMap = {
  keyManagerGetKeyManagementSystems: () => Promise<[string]>;
  didManagerImport: (
    identifier: MinimalImportableIdentifier,
  ) => Promise<IIdentifier>;
};

function redact(input: string): string {
  if (input.length <= 4) {
    return input;
  }
  return input[0] + '****'.repeat(input.length - 2) + input[input.length - 1];
}

export class Identity {
  agent: TAgent<AgentPluginMethodMap>;

  constructor(agent: TAgent<AgentPluginMethodMap>, mode?: string) {
    this.agent = agent;
    if (mode === 'demo') return;
  }

  async load_issuer_did(
    agent: TAgent<AgentPluginMethodMap>,
    config: AgentConfig,
  ): Promise<IIdentifier> {
    const mnemonic = config.credentialsMnemonic;
    const issuerDid = config.issuerDid;

    if (!mnemonic || !issuerDid)
      throw new TypeError(
        `Please Make sure to provide mnemonic and issuerDid. Received: mnemonic: ${mnemonic ? redact(mnemonic) : undefined} and issuerDid: ${issuerDid ? redact(issuerDid) : undefined}`,
      );

    if (!this.agent && !agent) throw new Error('No initialised agent found.');

    if (agent) this.agent = agent;

    if (!this.agent) throw new Error('Agent is not defined.');

    const [kms] = await this.agent.keyManagerGetKeyManagementSystems();

    const keypair = await Ed25519.makeKeypair(
      sha256(toUtf8(mnemonic)).slice(0, 32),
    );

    const key: MinimalImportableKey = {
      kms,
      type: 'Ed25519',
      kid: toHex(keypair.pubkey),
      publicKeyHex: toHex(keypair.pubkey),
      privateKeyHex: toHex(keypair.privkey) + toHex(keypair.pubkey),
    };

    const identifier: IIdentifier = await this.agent.didManagerImport({
      keys: [key],
      did: issuerDid,
      controllerKeyId: key.kid,
    } as MinimalImportableIdentifier);

    return identifier;
  }
}
