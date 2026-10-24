import { IsUUID } from 'class-validator';

// Path params of the `/auth/users/:userId/...` routes. The tenant never comes
// from the path: it comes from the verified actor.
export class UserIdParamDto {
  @IsUUID()
  userId!: string;
}
