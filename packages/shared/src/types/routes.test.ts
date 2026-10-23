import { describe, expectTypeOf, it } from 'vitest';
import type { CreateInvitationResponse, MeResponse, Role } from '../index';
import type { RouteBody, RouteQuery, RouteResponse } from './routes';

/** Compile-time checks that route types follow the schemas. A mismatch breaks `npm run typecheck`. */
describe('route types', () => {
  it('derives a response from its schema', () => {
    expectTypeOf<RouteResponse<'getMe'>>().toEqualTypeOf<MeResponse>();
    expectTypeOf<RouteResponse<'createInvitation'>>().toEqualTypeOf<CreateInvitationResponse>();
  });

  it('derives a request body with defaults applied', () => {
    expectTypeOf<RouteBody<'changeMemberRole'>>().toEqualTypeOf<{ role: Role }>();
    expectTypeOf<RouteBody<'createInvitation'>['role']>().toEqualTypeOf<Role>();
    expectTypeOf<RouteBody<'createRule'>['mode']>().toEqualTypeOf<'DISABLED' | 'DRY_RUN'>();
  });

  it('is undefined where a route has no such part', () => {
    expectTypeOf<RouteBody<'getMe'>>().toEqualTypeOf<undefined>();
    expectTypeOf<RouteQuery<'getMe'>>().toEqualTypeOf<undefined>();
    expectTypeOf<RouteResponse<'removeMember'>>().toEqualTypeOf<undefined>();
  });

  it('keeps ACTIVE out of what a rule request can carry', () => {
    expectTypeOf<RouteBody<'createRule'>['mode']>().not.toEqualTypeOf<
      'DISABLED' | 'DRY_RUN' | 'ACTIVE'
    >();
  });

  it('keeps DEMO responses distinct from live ones', () => {
    expectTypeOf<RouteResponse<'getDemoLive'>['source']>().toEqualTypeOf<'DEMO'>();
  });
});
