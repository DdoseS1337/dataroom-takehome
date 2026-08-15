import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { ApiError } from '../common/api-error';
import { FilesService, type DownloadUrl } from '../files/files.service';
import {
  isUniqueViolation,
  NodesRepository,
  type Crumb,
  type ShareRow,
} from '../nodes/nodes.repository';
import {
  NodesService,
  type NodeDetail,
  type NodeSummary,
} from '../nodes/nodes.service';
import {
  grantNamesUser,
  resolvePermission,
  type Permission,
} from '../permissions/resolve-permission';
import { PrismaService } from '../prisma/prisma.service';
import { expiryFrom, type CreateShareDto } from './shares.dto';
import {
  createShareToken,
  hashShareToken,
  isShareTokenShaped,
} from './share-token';

/**
 * Sharing, both modes, one table. The reasoning behind the shape — one token per share,
 * only its hash stored, permission resolved before the tombstone — is in
 * docs/architecture.md. What lives here is the part that decides *which* of the three
 * answers a requester gets, and it is the one place in this codebase where a wrong
 * branch is a data leak rather than a bug.
 */

const NOT_YOURS = 'Only the owner of an item can share it.';
const NO_EMAIL = 'Enter the email address to share this with.';
const YOUR_OWN = 'You already have access to this item.';
const ALREADY_INVITED =
  'This item is already shared with that address. Revoke the existing access first.';
const SIGN_IN = 'Sign in to view this item.';
const REVOKED = 'This link has been turned off by its owner.';
const EXPIRED = 'This link has expired.';

/** What the owner sees in the share panel. */
export interface ShareView {
  id: string;
  kind: 'link' | 'user';
  role: 'viewer' | 'editor';
  /** The invited address, on a named share. Owner-facing only. */
  email: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** The plaintext token exists exactly once, in this response. */
export interface CreatedShare extends ShareView {
  token: string;
}

export interface ShareList {
  shares: ShareView[];
  /** Whether a folder above this one is already shared, so the panel does not report
   * "not shared yet" about something a link already reaches. */
  inherited: boolean;
}

/** Enough of the shared item to name it and open it from a list. */
export interface SharedItem {
  id: string;
  type: 'folder' | 'file';
  name: string;
  roomId: string;
}

/** A share the requester granted, as it appears in "shared by me". */
export interface OutgoingShare extends ShareView {
  item: SharedItem & { roomName: string };
}

/** A share the requester was given, as it appears in "shared with me". */
export interface IncomingShare {
  id: string;
  role: 'viewer' | 'editor';
  expiresAt: string | null;
  createdAt: string;
  /** Who shared it. The owner chose to invite this person, so their address is not a
   * disclosure — and a list of unattributed documents is not usable. */
  sharedBy: string;
  item: SharedItem;
}

/** What a recipient is told about the link they followed. Never the grantee. */
export interface ShareContext {
  id: string;
  kind: 'link' | 'user';
  role: 'viewer' | 'editor';
  /** The item the link was made on — the top of what this recipient can navigate. */
  rootNodeId: string;
  expiresAt: string | null;
}

export interface ShareEntry {
  share: ShareContext;
  node: NodeDetail;
  breadcrumbs: Crumb[];
  permission: Permission;
}

@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodesService,
    private readonly repository: NodesRepository,
    private readonly files: FilesService,
  ) {}

  // ---------------------------------------------------------------------------
  // The owner's side.
  // ---------------------------------------------------------------------------

  /**
   * One query answers both halves: the shares made on this item, and whether it is
   * already reachable through a folder above it. `grantsForAncestors` returns the whole
   * chain, so telling the two apart is a comparison rather than a second round trip.
   */
  async list(nodeId: string, user: AuthUser): Promise<ShareList> {
    const node = await this.owned(nodeId, user);
    const now = Date.now();
    const live = (await this.repository.grantsForAncestors(node)).filter(
      (grant) => isLive(grant, now),
    );

    return {
      shares: live
        .filter((grant) => grant.nodeId === node.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(toView),
      inherited: live.some((grant) => grant.nodeId !== node.id),
    };
  }

  /**
   * Everything currently readable by somebody else across all of this owner's rooms.
   *
   * The per-item panel can only answer "who can see *this*", which means finding the
   * item first — and an owner who has forgotten where they shared something has no way
   * to look it up. Revocation that depends on remembering is not revocation.
   */
  async listOutgoing(user: AuthUser): Promise<OutgoingShare[]> {
    const shares = await this.prisma.share.findMany({
      where: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        node: {
          deletedAt: null,
          dataRoom: { ownerId: user.id, deletedAt: null },
        },
      },
      include: { node: { include: { dataRoom: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return shares.map((share) => ({
      ...toView(toShareRow(share)),
      item: {
        id: share.node.id,
        type: share.node.type,
        name: share.node.name,
        roomId: share.node.dataRoomId,
        roomName: share.node.dataRoom.name,
      },
    }));
  }

  /**
   * What other people have shared with this requester — by account, or by an address
   * they had not signed up with when the invitation was made.
   *
   * Link shares are absent by design: a link is not granted to anyone in particular, so
   * there is nobody to list it for. Whoever holds one has it.
   */
  async listIncoming(user: AuthUser): Promise<IncomingShare[]> {
    const email = user.email.trim().toLowerCase();

    const shares = await this.prisma.share.findMany({
      where: {
        kind: 'user',
        revokedAt: null,
        node: { deletedAt: null, dataRoom: { deletedAt: null } },
        // Two independent conditions, so both are spelled out rather than collapsed:
        // still live, and addressed to this person — by account, or by an address they
        // had not signed up with when the invitation was made.
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          {
            OR: [
              { granteeUserId: user.id },
              { granteeUserId: null, granteeEmail: email },
            ],
          },
        ],
      },
      include: {
        node: { include: { dataRoom: { include: { owner: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return shares.map((share) => ({
      id: share.id,
      role: share.role,
      expiresAt: share.expiresAt?.toISOString() ?? null,
      createdAt: share.createdAt.toISOString(),
      sharedBy: share.node.dataRoom.owner.email,
      item: {
        id: share.node.id,
        type: share.node.type,
        name: share.node.name,
        roomId: share.node.dataRoomId,
      },
    }));
  }

  async create(
    nodeId: string,
    dto: CreateShareDto,
    user: AuthUser,
  ): Promise<CreatedShare> {
    const node = await this.owned(nodeId, user);

    let granteeUserId: string | null = null;
    if (dto.kind === 'user') {
      if (!dto.email) throw ApiError.invalid(NO_EMAIL);
      if (dto.email === user.email.trim().toLowerCase()) {
        throw ApiError.invalid(YOUR_OWN);
      }
      // Bound to the account now if there is one, so the grant survives that person
      // later changing their address. If there is not, the guard binds it at their
      // first request after signing up — see `AuthGuard.claimPendingShares`.
      granteeUserId =
        (
          await this.prisma.user.findUnique({
            where: { email: dto.email },
            select: { id: true },
          })
        )?.id ?? null;
    }

    const { token, tokenHash } = createShareToken();
    const write = () =>
      this.prisma.share.create({
        data: {
          nodeId: node.id,
          kind: dto.kind,
          tokenHash,
          granteeUserId,
          granteeEmail: dto.kind === 'user' ? dto.email : null,
          // Only viewer is offered: the brief specifies read-only recipients, and the
          // column carries `editor` for the day that changes — see docs/data-model.md.
          role: 'viewer',
          expiresAt: expiryFrom(dto.expiresIn),
          createdBy: user.id,
        },
      });

    try {
      return { ...toView(toShareRow(await write())), token };
    } catch (error) {
      // `shares_grantee_uniq` — one live invitation per address per node. The other
      // unique index here is on the token hash, and a collision on 256 random bits is
      // not a thing that happens to anybody.
      if (!isUniqueViolation(error) || dto.kind !== 'user') throw error;
    }

    // An invitation that has expired is not a conflict — it is a leftover, exactly like
    // the abandoned upload Block 3 clears out of the way. The index cannot exclude it
    // (`now()` is not immutable, so it cannot appear in a partial index predicate) and
    // nothing shows it, so without this the address is blocked by a row the owner can
    // neither see nor revoke.
    const released = await this.prisma.share.updateMany({
      where: {
        nodeId: node.id,
        kind: 'user',
        granteeEmail: dto.email,
        revokedAt: null,
        expiresAt: { lt: new Date() },
      },
      data: { revokedAt: new Date() },
    });

    if (released.count === 0) throw ApiError.invalid(ALREADY_INVITED);

    // Exactly one retry. A second collision means a live invitation went in between,
    // which is an ordinary conflict and the owner's to resolve.
    try {
      return { ...toView(toShareRow(await write())), token };
    } catch (error) {
      if (isUniqueViolation(error)) throw ApiError.invalid(ALREADY_INVITED);
      throw error;
    }
  }

  /**
   * Revoking is a separate, explicit act — deleting the node does not do it, which is
   * what lets a recipient of a deleted item get `410` rather than an indistinguishable
   * `404`. The row stays; only `revoked_at` moves.
   */
  async revoke(shareId: string, user: AuthUser): Promise<void> {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      select: { id: true, nodeId: true },
    });
    if (!share) throw ApiError.notFound();

    // Authorised against the node, through the same single entry point every other read
    // uses. A share is not a thing you own — the item it points at is.
    await this.owned(share.nodeId, user);

    await this.prisma.share.updateMany({
      where: { id: shareId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // The recipient's side. Every one of these resolves the token first and then hands
  // the resulting share to the ordinary read path as an extra principal — so the
  // permission rule, the tombstone order and the 404/410 answers stay in one place.
  // ---------------------------------------------------------------------------

  async open(token: string, user: AuthUser | undefined): Promise<ShareEntry> {
    const share = await this.principal(token, user);
    return {
      share: toContext(share),
      ...(await this.nodes.get(share.nodeId, user, share)),
    };
  }

  async node(
    token: string,
    nodeId: string,
    user: AuthUser | undefined,
  ): Promise<ShareEntry> {
    const share = await this.principal(token, user);
    return {
      share: toContext(share),
      ...(await this.nodes.get(nodeId, user, share)),
    };
  }

  async children(
    token: string,
    nodeId: string,
    user: AuthUser | undefined,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<{ items: NodeSummary[]; nextCursor: string | null }> {
    const share = await this.principal(token, user);
    return this.nodes.children(nodeId, user, cursor, limit, share);
  }

  async search(
    token: string,
    scopeId: string,
    term: string,
    user: AuthUser | undefined,
  ) {
    const share = await this.principal(token, user);
    return this.nodes.search(scopeId, term, user, share);
  }

  /**
   * `versionId` is forwarded rather than ignored or rejected here. The query parameter is
   * on the DTO both controllers share, so it reaches this route whatever this route
   * wants; answering `200` with the current version would be a different file than the
   * one that was asked for, reported as a success. Passing it on lets the single
   * owner-only rule in `FilesService` give the same answer it gives everywhere else.
   */
  async downloadUrl(
    token: string,
    fileId: string,
    disposition: 'inline' | 'attachment',
    user: AuthUser | undefined,
    versionId?: string,
  ): Promise<DownloadUrl> {
    const share = await this.principal(token, user);
    return this.files.downloadUrl(fileId, disposition, user, share, versionId);
  }

  /**
   * The token, turned into the principal the read path can use — or into the right
   * refusal. This is the three-way answer from docs/architecture.md, and the order of
   * the branches is the part that matters:
   *
   * 1. A token nobody issued and a named share nobody is signed in for give the **same**
   *    answer to an anonymous requester. Otherwise "sign in" versus "not found" confirms
   *    to a stranger that a particular token exists.
   * 2. Revoked or expired is told plainly, because whoever is asking holds the token —
   *    its existence is not news to them, and "not found" would send them looking for a
   *    typo instead of asking for a new link.
   * 3. Wrong account is told last, from the requester's own address — and not at all to
   *    the owner of the item, who is the one person a refusal here cannot protect
   *    anything from. See `ownsSharedItem`.
   *
   * The lookup is by hash only. A guessed token finds nothing and is a `404`, never a
   * `403` — a `403` would confirm the guess.
   */
  private async principal(
    token: string,
    user: AuthUser | undefined,
  ): Promise<ShareRow> {
    const share = isShareTokenShaped(token)
      ? await this.prisma.share.findUnique({
          where: { tokenHash: hashShareToken(token) },
        })
      : null;

    if (!share || (share.kind === 'user' && !user)) {
      if (!user) throw ApiError.unauthenticated(SIGN_IN);
      throw ApiError.notFound();
    }

    const row = toShareRow(share);
    if (row.revokedAt !== null) throw ApiError.shareExpired(REVOKED);
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
      throw ApiError.shareExpired(EXPIRED);
    }

    if (row.kind === 'user' && !grantNamesUser(row, user)) {
      if (!(await this.ownsSharedItem(row.nodeId, user))) {
        throw ApiError.wrongAccount(user!.email);
      }
    }

    return row;
  }

  /**
   * Whether the requester is the owner of the room the shared item lives in — asked only
   * on the branch that is otherwise about to refuse them.
   *
   * An owner following an invitation they addressed to somebody else was told the link
   * was for a different account. True, and useless: checking your own invitation is the
   * first thing anyone does after sending one, and being refused by your own documents
   * reads as a broken link. The check sits inside the failing branch rather than in front
   * of every request, so the ordinary recipient's path costs nothing extra.
   *
   * No disclosure either way — the owner can already read every node in the room, and the
   * grantee's address is still never shown to anybody but the owner.
   */
  private async ownsSharedItem(
    nodeId: string,
    user: AuthUser | undefined,
  ): Promise<boolean> {
    if (!user) return false;

    // Through the repository, like every other read that touches the tree — the reason
    // this particular one ignores the tombstone is recorded there, where the next person
    // to wonder about it will be looking.
    const ownerId = await this.repository.findRoomOwner(nodeId);
    if (!ownerId) return false;

    // And through the rule rather than around it: `ownerId === user.id` is a permission
    // being derived, and docs/architecture.md has exactly one place that may do that.
    return resolvePermission(user, { ownerId }) === 'owner';
  }

  /** The item, if this requester owns it. Sharing is the owner's alone: an editor
   * handing out links would put the guest list outside the owner's control. */
  private async owned(nodeId: string, user: AuthUser) {
    const { node, permission } = await this.nodes.authorise(nodeId, user);
    if (permission !== 'owner') throw ApiError.forbidden(NOT_YOURS);
    return node;
  }
}

function isLive(grant: ShareRow, now: number): boolean {
  return (
    grant.revokedAt === null &&
    (grant.expiresAt === null || grant.expiresAt.getTime() > now)
  );
}

function toView(share: ShareRow): ShareView {
  return {
    id: share.id,
    kind: share.kind,
    role: share.role,
    email: share.granteeEmail,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
  };
}

function toContext(share: ShareRow): ShareContext {
  return {
    id: share.id,
    kind: share.kind,
    role: share.role,
    rootNodeId: share.nodeId,
    expiresAt: share.expiresAt?.toISOString() ?? null,
  };
}

/** The Prisma row, narrowed to the shape the permission rule and the views expect. */
function toShareRow(share: {
  id: string;
  nodeId: string;
  kind: string;
  role: string;
  granteeUserId: string | null;
  granteeEmail: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): ShareRow {
  return {
    id: share.id,
    nodeId: share.nodeId,
    kind: share.kind as 'link' | 'user',
    role: share.role as 'viewer' | 'editor',
    granteeUserId: share.granteeUserId,
    granteeEmail: share.granteeEmail,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    createdAt: share.createdAt,
  };
}
