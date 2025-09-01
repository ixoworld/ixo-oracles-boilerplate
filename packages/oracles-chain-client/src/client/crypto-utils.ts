import { fromHex, toHex } from '@cosmjs/encoding';
import { decrypt, encrypt } from 'eciesjs';
import z from 'zod';

/**
 * Utility class for encrypting and decrypting data using ECIES with mnemonics
 * @param data - The data to encrypt
 * @param publicKeyHex - The public key to encrypt the data with
 * @returns The encrypted data
 * @example
 * const encryptedData = CryptoUtils.encrypt('Hello, world!', publicKeyHex);
 * const decryptedData = CryptoUtils.decrypt(encryptedData, privateKeyHex);
 * const decryptedDataTyped = CryptoUtils.decryptTyped(encryptedData, privateKeyHex, zodSchema);
 */
export class CryptoUtils {
  /**
   * Encrypt the data with the public key hex
   * @param data - The data to encrypt
   * @param publicKeyHex - The public key to encrypt the data with
   * @returns The encrypted data
   */
  static encrypt(data: string, publicKeyHex: string): string {
    const encryptedBuffer = encrypt(publicKeyHex, Buffer.from(data));
    return toHex(encryptedBuffer); // Convert to hex string
  }

  /**
   * Decrypt the encrypted data with the private key hex
   * @param encryptedData - The encrypted data
   * @param privateKey - The private key
   * @returns The decrypted data
   */
  static decrypt(encryptedData: string, privateKey: Uint8Array): string {
    const encryptedBuffer = fromHex(encryptedData); // Convert back to buffer
    return decrypt(privateKey, encryptedBuffer).toString();
  }

  /**
   * Decrypt the encrypted data with the private key hex and parse it with the zod schema
   * @param encryptedData - The encrypted data
   * @param privateKey - The private key
   * @param zodSchema - The zod schema to parse the data with
   * @returns The decrypted data
   */
  static decryptTyped<S extends z.ZodType>(
    encryptedData: string,
    privateKey: Uint8Array,
    zodSchema: S,
  ): z.infer<S> {
    const jsonParsableTypes: z.ZodType['def']['type'][] = [
      'object',
      'array',
      'record',
      'tuple',
    ];
    const isObject = jsonParsableTypes.includes(zodSchema.def.type);
    if (isObject) {
      return zodSchema.parse(
        JSON.parse(this.decrypt(encryptedData, privateKey)),
      );
    }
    return zodSchema.parse(this.decrypt(encryptedData, privateKey));
  }
}
