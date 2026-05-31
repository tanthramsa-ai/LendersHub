import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ForgotPasswordDto {
  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/)
  subdomain: string;
}
