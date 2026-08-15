import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';

/**
 * How long a link stays good for. Presets rather than a date: the client sends an
 * intent, the server does the arithmetic against its own clock, and a browser whose
 * clock is a day out cannot mint a link that was already expired when it was created.
 */
export type ExpiryPreset = 'never' | '24h' | '7d' | '30d';

const HOURS: Record<Exclude<ExpiryPreset, 'never'>, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

export function expiryFrom(preset: ExpiryPreset | undefined): Date | null {
  if (!preset || preset === 'never') return null;
  return new Date(Date.now() + HOURS[preset] * 60 * 60 * 1000);
}

function normalise(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class CreateShareDto {
  /**
   * `link` is anyone holding the URL; `user` is one named address. The service refuses a
   * `user` share with no email — the one combination class validators cannot express
   * without making the field required for both kinds.
   */
  @IsIn(['link', 'user'])
  kind!: 'link' | 'user';

  /**
   * Lowercased on the way in, because that is what the grant is matched against later
   * and what `shares_grantee_uniq` compares. An address that differs only in case is the
   * same person, and storing it as typed would make it a second invitation.
   */
  @IsOptional()
  @Transform(({ value }) => normalise(value))
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsIn(['never', '24h', '7d', '30d'])
  expiresIn?: ExpiryPreset;
}
