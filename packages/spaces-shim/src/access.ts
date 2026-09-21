/**
 * The access decisions, shared by every backend so they cannot drift. A backend
 * supplies `roleOf` (its member table) and the store options supply the other claims.
 */
import { evaluate, NO_CLAIMS, type ClaimsProvider } from '@tributary/policy'
import { MANAGE_ROLE, type Did, type Space, type StoreOptions } from './types.js'

export interface AccessBackend {
  roleOf(spaceUri: string, did: Did): Promise<number | null>
}

export class Access {
  private readonly claims: ClaimsProvider
  constructor(
    private readonly backend: AccessBackend,
    opts: StoreOptions,
  ) {
    const extra = opts.claims ?? NO_CLAIMS
    this.claims = {
      roleOf: (viewer, spaceUri) => backend.roleOf(spaceUri, viewer as Did),
      isInvited: extra.isInvited.bind(extra),
      isSharedWith: extra.isSharedWith.bind(extra),
      isConfirmedFor: extra.isConfirmedFor.bind(extra),
      isConnectionOf: extra.isConnectionOf.bind(extra),
    }
  }

  isAuthority(s: Space, did: Did | null): boolean {
    return did !== null && did === s.authority
  }

  async canManage(s: Space, did: Did | null): Promise<boolean> {
    if (did === null) return false
    if (this.isAuthority(s, did)) return true
    const role = await this.backend.roleOf(s.uri, did)
    return role !== null && role >= MANAGE_ROLE
  }

  async canRead(s: Space, viewer: Did | null, author?: Did): Promise<boolean> {
    if (this.isAuthority(s, viewer)) return true
    if (viewer !== null && (await this.canManage(s, viewer))) return true
    return evaluate(s.readPolicy, { viewer, space: { uri: s.uri, authority: s.authority }, author, claims: this.claims })
  }

  async canWrite(s: Space, actor: Did | null): Promise<boolean> {
    if (actor === null) return false
    if (this.isAuthority(s, actor)) return true
    if (await this.canManage(s, actor)) return true
    return evaluate(s.writePolicy, { viewer: actor, space: { uri: s.uri, authority: s.authority }, claims: this.claims })
  }
}
