import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import {
  toOrganizationActor,
  type OrganizationActor,
} from '../organization-actor';
import {
  CreatePostBodyDto,
  CreateSiteBodyDto,
  PageQueryDto,
  PostIdParamDto,
  SiteIdParamDto,
  UpdatePostBodyDto,
  UpdateSiteBodyDto,
} from './dto/site.dto';
import { PostsService, type PostView } from './posts.service';
import {
  SitesService,
  type PageResult,
  type SiteView,
} from './sites.service';

// HTTP transport only (route map in `backend/core/AGENTS.md`). The actor comes
// from the AuthGuard; roles and site scope are enforced by the services.
@Controller()
export class SitesController {
  constructor(
    private readonly sites: SitesService,
    private readonly posts: PostsService,
  ) {}

  @Post('sites')
  create(
    @CurrentActor() actor: OrganizationActor,
    @Body() body: CreateSiteBodyDto,
  ): Promise<SiteView> {
    return this.sites.create(toOrganizationActor(actor), body);
  }

  @Get('sites')
  list(
    @CurrentActor() actor: OrganizationActor,
    @Query() query: PageQueryDto,
  ): Promise<PageResult<SiteView>> {
    return this.sites.list(toOrganizationActor(actor), query);
  }

  @Get('sites/:siteId')
  get(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: SiteIdParamDto,
  ): Promise<SiteView> {
    return this.sites.get(toOrganizationActor(actor), params.siteId);
  }

  @Patch('sites/:siteId')
  update(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: SiteIdParamDto,
    @Body() body: UpdateSiteBodyDto,
  ): Promise<SiteView> {
    return this.sites.update(toOrganizationActor(actor), params.siteId, body);
  }

  @Post('sites/:siteId/rotate-qr')
  rotateQr(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: SiteIdParamDto,
  ): Promise<SiteView> {
    return this.sites.rotateQr(toOrganizationActor(actor), params.siteId);
  }

  @Post('sites/:siteId/posts')
  createPost(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: SiteIdParamDto,
    @Body() body: CreatePostBodyDto,
  ): Promise<PostView> {
    return this.posts.create(toOrganizationActor(actor), params.siteId, body);
  }

  @Get('sites/:siteId/posts')
  listPosts(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: SiteIdParamDto,
    @Query() query: PageQueryDto,
  ): Promise<PageResult<PostView>> {
    return this.posts.list(toOrganizationActor(actor), params.siteId, query);
  }

  @Patch('posts/:postId')
  updatePost(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: PostIdParamDto,
    @Body() body: UpdatePostBodyDto,
  ): Promise<PostView> {
    return this.posts.update(toOrganizationActor(actor), params.postId, body);
  }
}
