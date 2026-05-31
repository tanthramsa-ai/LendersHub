import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsNotEmpty()
  @IsString()
  tempToken: string;

  @IsNotEmpty()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp: string;
}
