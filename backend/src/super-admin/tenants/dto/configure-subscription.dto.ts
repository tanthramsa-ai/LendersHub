import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum SubscriptionPlanDto {
  STARTER = 'STARTER',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export enum BillingCycleDto {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  ANNUALLY = 'ANNUALLY',
}

export class ConfigureSubscriptionDto {
  @IsEnum(SubscriptionPlanDto)
  plan: SubscriptionPlanDto;

  @IsEnum(BillingCycleDto)
  billingCycle: BillingCycleDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  trialDays?: number;
}
