import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { customMessages, ixo, utils } from '@ixo/impactxclient-sdk';
import { Verification } from '@ixo/impactxclient-sdk/types/codegen/ixo/iid/v1beta1/tx.js';
import {
  AccordedRight,
  LinkedClaim,
  LinkedEntity,
  LinkedResource,
  Service,
} from '@ixo/impactxclient-sdk/types/codegen/ixo/iid/v1beta1/types.js';
import { CreateEntityParams } from './types.js';

export class EntityFactory {
  private readonly owner: 'user' | 'dao';
  private readonly ownerCoreAddress: string | undefined;
  private readonly wallet: DirectSecp256k1HdWallet;
  private MsgCreateEntityParams = {
    typeUrl: '/ixo.entity.v1beta1.MsgCreateEntity',
    value: ixo.entity.v1beta1.MsgCreateEntity.fromPartial({
      entityType: '',
      context: [],
      verification: [],
      controller: [],
      ownerAddress: '',
      ownerDid: '',
      relayerNode: '',
      service: [],
      linkedResource: [],
      accordedRight: [],
      linkedEntity: [],
      linkedClaim: [],
      entityStatus: 0,
      startDate: undefined,
      endDate: undefined,
    }),
  };

  constructor(params: CreateEntityParams) {
    this.MsgCreateEntityParams.value.relayerNode = params.config.relayerNode;
    this.wallet = params.wallet;
    this.owner = params.config.owner;
    this.ownerCoreAddress = params.config.ownerCoreAddress;
  }

  public setValueIfAvailable<T>(
    setter: (value: T) => void,
    value: T | undefined,
  ) {
    if (value) {
      setter(value);
    }
  }

  // static async create(params: CreateEntityParams) {
  //   const instance = new EntityFactory(params);
  //   await instance.initializeOwnerSettings();
  //   if (!params.value) {
  //     return instance;
  //   }
  //   const verificationMethods = [
  //     ...customMessages.iid.createIidVerificationMethods({
  //       did: await instance.getWalletDid(),
  //       pubkey: await instance.getWalletPubKey(),
  //       address: await instance.getWalletAddress(),
  //       controller: await instance.getWalletDid(),
  //       type: 'secp',
  //     }),
  //   ];

  //   instance.addVerificationMethods(verificationMethods);
  //   instance.setValueIfAvailable(
  //     instance.setEntityType,
  //     params.value.entityType,
  //   );
  //   instance.setValueIfAvailable(instance.addServices, params.value.services);
  //   instance.setValueIfAvailable(
  //     instance.addContext,
  //     params.value.context && [params.value.context],
  //   );
  //   instance.setValueIfAvailable(
  //     instance.addAccordedRights,
  //     params.value.accordedRights,
  //   );
  //   instance.setValueIfAvailable(
  //     instance.addLinkedEntities,
  //     params.value.linkedEntities,
  //   );
  //   instance.setValueIfAvailable(
  //     instance.addLinkedClaims,
  //     params.value.linkedClaims,
  //   );
  //   instance.setValueIfAvailable(
  //     instance.setStartDate,
  //     transformDate(params.value.startDate),
  //   );
  //   instance.setValueIfAvailable(
  //     instance.setEndDate,
  //     transformDate(params.value.endDate),
  //   );
  //   instance.setValueIfAvailable(
  //     instance.addLinkedResources,
  //     params.value.linkedResources,
  //   );

  //   return instance;
  // }

  private async getWalletDid() {
    const address = await this.getWalletAddress();
    return utils.did.generateSecpDid(address);
  }

  private async getWalletPubKey() {
    const accounts = await this.wallet.getAccounts();
    const account = accounts[0];
    if (!account) {
      throw new Error('No account found in wallet');
    }
    return account.pubkey;
  }

  private async getWalletAddress() {
    const accounts = await this.wallet.getAccounts();
    const account = accounts[0];
    if (!account) {
      throw new Error('No account found in wallet');
    }
    return account.address;
  }

  async initializeOwnerSettings() {
    await this.setUserVerificationMethods();
    await this.setOwnerAddress();
    await this.setEntityController();
  }

  async setEntityController() {
    const did = await this.getWalletDid();
    this.MsgCreateEntityParams.value.controller = [did];
  }

  async setOwnerAddress() {
    if (this.owner === 'user') {
      const address = await this.getWalletAddress();
      const did = await this.getWalletDid();
      this.MsgCreateEntityParams.value.ownerAddress = address;
      this.MsgCreateEntityParams.value.ownerDid = did;
    } else if (this.ownerCoreAddress) {
      this.MsgCreateEntityParams.value.ownerAddress = this.ownerCoreAddress;
      this.MsgCreateEntityParams.value.ownerDid = `did:ixo:wasm:${this.ownerCoreAddress}`;
    }
  }

  setEntityType(entityType: string) {
    this.MsgCreateEntityParams.value.entityType = entityType;
  }

  addServices(services: Service[]) {
    this.MsgCreateEntityParams.value.service = [
      ...this.MsgCreateEntityParams.value.service,
      ...services.map((service) =>
        ixo.iid.v1beta1.Service.fromPartial(service),
      ),
    ];
  }

  addContext(
    context: [
      {
        key: string;
        val: string;
      },
    ],
  ) {
    this.MsgCreateEntityParams.value.context =
      customMessages.iid.createAgentIidContext(context);
  }

  addVerificationMethods(verification: Verification[]) {
    this.MsgCreateEntityParams.value.verification = [
      ...this.MsgCreateEntityParams.value.verification,
      ...verification.map((verification) =>
        ixo.iid.v1beta1.Verification.fromPartial(verification),
      ),
    ];
  }

  addAccordedRights(accordedRights: AccordedRight[]) {
    this.MsgCreateEntityParams.value.accordedRight = [
      ...this.MsgCreateEntityParams.value.accordedRight,
      ...accordedRights.map((accordedRight) =>
        ixo.iid.v1beta1.AccordedRight.fromPartial(accordedRight),
      ),
    ];
  }

  addLinkedEntities(linkedEntities: LinkedEntity[]) {
    this.MsgCreateEntityParams.value.linkedEntity = [
      ...this.MsgCreateEntityParams.value.linkedEntity,
      ...linkedEntities.map((linkedEntity) =>
        ixo.iid.v1beta1.LinkedEntity.fromPartial(linkedEntity),
      ),
    ];
  }

  addLinkedClaims(linkedClaims: LinkedClaim[]) {
    this.MsgCreateEntityParams.value.linkedClaim = [
      ...this.MsgCreateEntityParams.value.linkedClaim,
      ...linkedClaims.map((linkedClaim) =>
        ixo.iid.v1beta1.LinkedClaim.fromPartial(linkedClaim),
      ),
    ];
  }

  async setUserVerificationMethods() {
    const did = await this.getWalletDid();
    const address = await this.getWalletAddress();
    const pubkey = await this.getWalletPubKey();

    this.MsgCreateEntityParams.value.verification = [
      ...this.MsgCreateEntityParams.value.verification,
      ...customMessages.iid.createIidVerificationMethods({
        did: did,
        pubkey: new Uint8Array(pubkey),
        address: address,
        controller: did,
        type: 'secp', // DirectSecp256k1HdWallet is always secp256k1
      }),
    ];
  }

  addDaoController(daoCoreAddress: string) {
    this.MsgCreateEntityParams.value.controller = [daoCoreAddress];
  }

  async addDaoVerificationMethods(daoCoreAddress: string) {
    const did = await this.getWalletDid();

    this.MsgCreateEntityParams.value.verification = [
      ...this.MsgCreateEntityParams.value.verification,
      ixo.iid.v1beta1.Verification.fromPartial({
        relationships: ['authentication'],
        method: ixo.iid.v1beta1.VerificationMethod.fromPartial({
          id: `${did}#${daoCoreAddress}`,
          type: 'CosmosAccountAddress',
          controller: did,
          blockchainAccountID: daoCoreAddress,
        }),
      }),
    ];
  }

  setStartDate(startDate: string) {
    this.MsgCreateEntityParams.value.startDate = startDate
      ? utils.proto.toTimestamp(new Date(startDate))
      : undefined;
  }

  setEndDate(endDate: string) {
    this.MsgCreateEntityParams.value.endDate = endDate
      ? utils.proto.toTimestamp(new Date(endDate))
      : undefined;
  }

  addLinkedResources(linkedResources: LinkedResource[]) {
    this.MsgCreateEntityParams.value.linkedResource = [
      ...this.MsgCreateEntityParams.value.linkedResource,
      ...linkedResources.map((linkedResource) =>
        ixo.iid.v1beta1.LinkedResource.fromPartial(linkedResource),
      ),
    ];
  }

  /**
   * @returns the MsgCreateEntityParams object
   * this is the object that can be used to create an entity on the chain
   */
  get MsgCreateEntity() {
    return this.MsgCreateEntityParams;
  }
}

// const transformDate = (date: string | Date | undefined): string | undefined => {
//   if (!date) {
//     return undefined;
//   }
//   return typeof date === 'string' ? date : date.toISOString();
// };
