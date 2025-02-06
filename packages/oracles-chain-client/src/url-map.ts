const URI_MAP = {
  'https://ipfs.io/ipfs/': 'https://w3s.link/ipfs/',
};

// helper to map a uri to another one that is defined in the constant URI_MAP
export const mapUri = (uri: string): string => {
  for (const key in URI_MAP) {
    if (uri.startsWith(key)) {
      return uri.replace(key, URI_MAP[key as keyof typeof URI_MAP]);
    }
  }
  return uri;
};
