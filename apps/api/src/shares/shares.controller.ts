import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  requireUser,
  type AuthUser,
} from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { DownloadUrlQuery } from '../files/files.dto';
import { ListChildrenQuery, SearchQuery } from '../nodes/nodes.dto';
import { ShareRateLimitGuard } from './share-rate-limit.guard';
import { CreateShareDto } from './shares.dto';
import { SharesService } from './shares.service';

/** The owner's side: who this item is shared with, and the two acts that change it. */
@Controller('nodes')
export class NodeSharesController {
  constructor(private readonly shares: SharesService) {}

  @Get(':id/shares')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.shares.list(id, requireUser(user));
  }

  /** The response carries the plaintext token, and it is the only time it exists. */
  @Post(':id/shares')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateShareDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.shares.create(id, dto, requireUser(user));
  }
}

@Controller('shares')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  /** Everything currently shared out of this owner's rooms — the one place a link can
   * be found again once the panel that made it has been closed. */
  @Get()
  outgoing(@CurrentUser() user: AuthUser | undefined) {
    return this.shares.listOutgoing(requireUser(user));
  }

  /** The other direction: what other people have shared with this requester. */
  @Get('received')
  incoming(@CurrentUser() user: AuthUser | undefined) {
    return this.shares.listIncoming(requireUser(user));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.shares.revoke(id, requireUser(user));
  }
}

/**
 * `Referrer-Policy: no-referrer` because the token is in the URL: without it, every
 * outbound request from a page opened through a link hands the whole address to a third
 * party in the `Referer` header. `no-store` because a shared machine should not keep the
 * contents of someone else's data room in its back button.
 *
 * `@Public()` is the requirement itself — the brief asks for a link that works without
 * signing in. These routes still authorise; they just do it from the token.
 */
const ShareRoute = () =>
  applyDecorators(
    Public(),
    Header('Referrer-Policy', 'no-referrer'),
    Header('Cache-Control', 'no-store'),
  );

/**
 * The public mirror of the read endpoints — the four a recipient navigates with, plus
 * search. Version history is deliberately not among them: see `FilesService.versions`.
 *
 * Every route resolves the token to a share and
 * hands it to the same services the private routes use, so there is no second copy of
 * the permission rule, the tombstone order, or the 404/410 answers.
 *
 * A node outside the shared subtree needs no special check here: the permission rule
 * reads grants from the requested node's ancestor chain, and a share that is not in that
 * chain is never loaded — so it resolves to `none`, which is `404`.
 */
@Controller('s')
@UseGuards(ShareRateLimitGuard)
export class ShareLinkController {
  constructor(private readonly shares: SharesService) {}

  @Get(':token')
  @ShareRoute()
  open(
    @Param('token') token: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.shares.open(token, user);
  }

  @Get(':token/nodes/:id')
  @ShareRoute()
  node(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.shares.node(token, id, user);
  }

  @Get(':token/nodes/:id/children')
  @ShareRoute()
  children(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListChildrenQuery,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.shares.children(token, id, user, query.cursor, query.limit);
  }

  /** The scope is checked like any other node here — a recipient who passes an id from
   * outside their share resolves to `none` and gets `404`, exactly as `/nodes/:id` does. */
  @Get(':token/search')
  @ShareRoute()
  search(
    @Param('token') token: string,
    @Query() query: SearchQuery,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.shares.search(token, query.scope, query.q, user);
  }

  @Get(':token/files/:id/download-url')
  @ShareRoute()
  downloadUrl(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DownloadUrlQuery,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.shares.downloadUrl(
      token,
      id,
      query.disposition ?? 'inline',
      user,
      query.versionId,
    );
  }
}
