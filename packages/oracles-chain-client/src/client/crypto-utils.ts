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
  static encrypt(data: string, publicKeyHex: string): Buffer {
    return encrypt(publicKeyHex, Buffer.from(data));
  }

  static decrypt(encryptedData: Buffer, privateKeyHex: string): string {
    return decrypt(privateKeyHex, encryptedData).toString();
  }

  static decryptTyped<S extends z.ZodSchema>(
    encryptedData: Buffer,
    privateKeyHex: string,
    zodSchema: S,
  ): z.infer<S> {
    return zodSchema.parse(
      JSON.parse(this.decrypt(encryptedData, privateKeyHex)),
    );
  }
}
