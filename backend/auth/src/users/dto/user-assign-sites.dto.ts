import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ActorDto } from '../../common/dto/actor.dto';

// More sites than any tenant plausibly assigns to one supervisor; bounds the
// size of the array stored in the user row and of the NATS payload.
export const MAX_SITE_IDS = 500;

// Payload of `auth.user.assign-sites`. `siteIds` is the FULL new set (an empty
// array unassigns every site). Duplicates are allowed here and removed by the
// service. `auth` does not check that a site exists (organization owns them),
// only that each id is a uuid. The tenant always comes from the actor.
export class AssignUserSitesDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @IsUUID()
  userId!: string;

  @IsArray()
  @ArrayMaxSize(MAX_SITE_IDS)
  @IsUUID(undefined, { each: true })
  siteIds!: string[];
}
