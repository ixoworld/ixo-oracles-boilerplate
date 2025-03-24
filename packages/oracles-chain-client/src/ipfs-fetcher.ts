import axios from 'axios';
import axiosRetry from 'axios-retry';
import { RateLimiter } from 'limiter';
import { timeout } from './utils/general.js';

export const web3StorageRateLimiter = new RateLimiter({
  tokensPerInterval: 200,
  interval: 1000 * 60,
});

axiosRetry(axios, {
  retries: 3,
  retryDelay: (tries) => tries * 500,
});

export const getIpfsDocument = async (cid: string): Promise<object> => {
  try {
    await web3StorageRateLimiter.removeTokens(1);
  } catch (error) {
    await timeout(1000);
    return getIpfsDocument(cid);
  }
  const res = await axios.get<object>(`https://${cid}.ipfs.w3s.link`);

  if (res.status !== 200) {
    if (res.status === 429) {
      await timeout(1000);
      return getIpfsDocument(cid);
    }

    throw new Error(`failed to get ${cid} - [${res.status}] ${res.statusText}`);
  }

  return res.data;
};
