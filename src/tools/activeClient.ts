import { ChatModelClient } from "../client";

export let activeClient: ChatModelClient | null = null;

export function setActiveClient(client: ChatModelClient) {
  activeClient = client;
}
