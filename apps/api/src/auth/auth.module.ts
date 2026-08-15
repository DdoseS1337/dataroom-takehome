import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';

// Registered globally: a route is protected unless it says otherwise with @Public().
// The opposite default — opt in to protection — is one forgotten decorator away
// from an open endpoint.
@Module({
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
