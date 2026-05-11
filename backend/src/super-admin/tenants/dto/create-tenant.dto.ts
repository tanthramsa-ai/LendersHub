import {
  IsEmail, IsEnum, IsInt, IsObject, IsOptional,
  IsString, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';

export class CreateTenantDto {
  @IsString() @MinLength(2) @MaxLength(100)
  companyName: string;

  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{1,18}[a-z0-9]|[a-z0-9]{0,18})$/, {
    message: 'Subdomain must be 3-20 lowercase alphanumeric characters or hyphens, starting and ending with alphanumeric',
  })
  subdomain: string;

  @IsString() @MinLength(3) @MaxLength(50)
  registrationNumber: string;

  @IsOptional() @IsString() @MaxLength(30)
  gstNumber?: string;

  @IsString() @MinLength(10) @MaxLength(500)
  address: string;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @IsOptional() @IsString() @MaxLength(100)
  state?: string;

  @IsEmail()
  adminEmail: string;

  @IsString() @MinLength(1) @MaxLength(50)
  adminFirstName: string;

  @IsString() @MinLength(1) @MaxLength(50)
  adminLastName: string;

  @IsOptional() @IsString() @MaxLength(7)
  primaryColor?: string;

  @IsOptional() @IsString() @MaxLength(200)
  customDomain?: string;

  @IsOptional() @IsObject()
  features?: Record<string, boolean>;

  // Optional inline subscription configuration
  @IsOptional() @IsString() @IsEnum(['STARTER', 'PROFESSIONAL', 'ENTERPRISE'])
  plan?: string;

  @IsOptional() @IsString() @IsEnum(['MONTHLY', 'QUARTERLY', 'ANNUALLY'])
  billingCycle?: string;

  @IsOptional() @IsInt() @Min(0) @Max(90)
  trialDays?: number;
}
