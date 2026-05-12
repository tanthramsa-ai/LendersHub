import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

export class TenantLoginDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  password: string;

  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/)
  subdomain: string;
}
