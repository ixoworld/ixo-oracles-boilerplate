import {
  type LinkedResource,
  type Service,
} from '@ixo/impactxclient-sdk/types/codegen/ixo/iid/v1beta1/types';

export const getServiceEndpoint = (url = '', services: Service[] = []) => {
  // if url includes :// it means it already an https link most probably
  if (url.includes('://')) return url;

  const pos = url.indexOf(':');
  if (pos === -1) return url;

  const service = url.substring(0, pos);
  const endUrl = url.substring(pos + 1);

  const serviceEndpoint = services.find((s) => {
    const posHash = s.id.indexOf('#');
    const id = s.id.substring(posHash + 1);
    return id === service;
  })?.serviceEndpoint;
  if (!serviceEndpoint) return url;

  return serviceEndpoint + endUrl;
};

export const getUrlFromContext = (url = '', contexts: any[] = []) => {
  // if url includes :// it means it already an https link most probably
  if (url.includes('://')) return url;

  const pos = url.indexOf(':');
  if (pos === -1) return url;

  const service = url.substring(0, pos);
  const endUrl = url.substring(pos + 1);

  const serviceEndpoint = contexts.find((c) => {
    if (typeof c === 'string') return false;
    for (const key of Object.keys(c)) {
      if (key === service) return true;
    }
    return false;
  })?.[service];
  if (!serviceEndpoint) return url;

  return serviceEndpoint + endUrl;
};

export const getLinkedResourceWithId = (
  text = '',
  linkedResources: LinkedResource[] = [],
) => {
  if (!text) return undefined;

  const linkedResource = linkedResources.find((r) => {
    const pos = r.id.indexOf('#');
    const id = r.id.substring(pos + 1);
    return id === text;
  });
  return linkedResource;
};
