import { IsString, Length } from 'class-validator';

export class ConfirmSetup2faDto {
  @IsString()
  @Length(6, 6)
  token: string;
}
