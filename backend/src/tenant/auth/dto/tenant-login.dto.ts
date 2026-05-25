import { IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

export class TenantLoginDto {
  @ValidateIf((o: TenantLoginDto) => !o.phone)
  @IsString()
  email?: string;

  @ValidateIf((o: TenantLoginDto) => !o.email)
  @IsOptional()
  @IsString()
  phone?: string;

  @IsNotEmpty()
  @IsString()
  password: string;

  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/)
  subdomain: string;
}
