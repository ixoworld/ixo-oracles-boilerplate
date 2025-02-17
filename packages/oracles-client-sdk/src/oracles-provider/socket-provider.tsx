'use client';

import { type PropsWithChildren } from 'react';

import { IoProvider } from 'socket.io-react-hook';

export const SocketProvider: React.FC<PropsWithChildren> = ({ children }) => {
  return <IoProvider>{children}</IoProvider>;
};
