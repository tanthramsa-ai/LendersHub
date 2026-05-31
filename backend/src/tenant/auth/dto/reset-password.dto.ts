import { IsNotEmpty, IsString, Length, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsNotEmpty()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp: string;

  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;

  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/)
  subdomain: string;
}
