/** Minimal capability `AdminModule` needs — satisfied by `VeriTixClient`. */
export interface AdminClient {
  simulate(method: string, args: unknown[]): Promise<unknown>;
  invoke(method: string, args: unknown[]): Promise<unknown>;
}

/**
 * Admin operations, each invoking the contract through `client.invoke()`
 * (reads go through `client.simulate()`). Authorization is enforced
 * on-chain by the contract, not by a local comparison.
 */
export class AdminModule {
  constructor(private readonly client: AdminClient) {}

  async proposeAdmin(newAdmin: string): Promise<void> {
    await this.client.invoke('propose_admin', [newAdmin]);
  }

  async acceptAdmin(): Promise<void> {
    await this.client.invoke('accept_admin', []);
  }

  /** The proposed successor admin, or `null` when no rotation is pending. */
  async getPendingAdmin(): Promise<string | null> {
    const raw = await this.client.simulate('get_pending_admin', []);
    return typeof raw === 'string' ? raw : null;
  }

  async freeze(address: string): Promise<void> {
    await this.client.invoke('freeze', [address]);
  }

  async unfreeze(address: string): Promise<void> {
    await this.client.invoke('unfreeze', [address]);
  }

  async clawback(from: string, amount: bigint): Promise<void> {
    await this.client.invoke('clawback', [from, amount]);
  }

  async pause(): Promise<void> {
    await this.client.invoke('pause', []);
  }

  async unpause(): Promise<void> {
    await this.client.invoke('unpause', []);
  }
}
