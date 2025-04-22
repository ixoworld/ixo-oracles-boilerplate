'use client';
import { ChatContainer } from '../components/ChatContainer';

export default function Home() {
  // You can replace these values with your actual oracle DID and base URL
  const oracleDid = 'did:ixo:entity:123d410c9d91a80dabbafed0b463e4b2';
  const baseUrl = 'http://localhost:4200';

  return <ChatContainer oracleDid={oracleDid} baseUrl={baseUrl} />;
}
