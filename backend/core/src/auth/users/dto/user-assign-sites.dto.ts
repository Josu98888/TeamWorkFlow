import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ActorDto } from '../../dto/actor.dto';

// More sites than any tenant plausibly assigns to one supervisor; bounds the
// size of the array stored in the user row and of the request payload.
export const MAX_SITE_IDS = 500;

// HTTP body of `PUT /auth/users/:userId/sites`. `siteIds` is the FULL new set
// (an empty array unassigns every site). Duplicates are allowed here and
// removed by the service. `auth` does not check that a site exists
// (organization owns them), only that each id is a uuid.
export class AssignUserSitesBodyDto {
  @IsArray()
  @ArrayMaxSize(MAX_SITE_IDS)
  @IsUUID(undefined, { each: true })
  siteIds!: string[];
}

// Input of `auth.user.assign-sites`. The tenant always comes from the actor.
export class AssignUserSitesDto extends AssignUserSitesBodyDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @IsUUID()
  userId!: string;
}
