import { BadRequestException } from '@nestjs/common';
import { assertNotOnlySpecialChars } from '../common/text-validation';

const PHONE_RE = /^\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const BRANCH_NAME_MIN = 4;
export const BRANCH_NAME_MAX = 100;
export const BRANCH_CODE_MIN = 2;
export const BRANCH_CODE_MAX = 20;
export const MANAGER_NAME_MAX = 100;
export const ADDRESS_MAX = 200;
export const CITY_MAX = 100;

/**
 * Validates every branch field, throwing on the first problem found — mirrors
 * validateCustomerFields()'s one-error-at-a-time convention. The create/edit form
 * runs the same rules client-side before ever calling the API, so in normal use
 * this is a safety net, not where a user sees "all errors at once" — that's the
 * frontend's job, checking every field locally instead of round-tripping here.
 */
export function validateBranchFields(dto: {
  name?: string;
  code?: string;
  managerName?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  requireCore?: boolean;
}): void {
  const requireCore = dto.requireCore !== false;

  if (requireCore || dto.name !== undefined) {
    const name = dto.name?.trim() ?? '';
    if (!name) throw new BadRequestException('Branch name is required');
    assertNotOnlySpecialChars(dto.name, 'Branch name');
    if (name.length < BRANCH_NAME_MIN)
      throw new BadRequestException(
        `Branch name must be at least ${BRANCH_NAME_MIN} characters`,
      );
    if (name.length > BRANCH_NAME_MAX)
      throw new BadRequestException(
        `Branch name must be ${BRANCH_NAME_MAX} characters or fewer`,
      );
  }

  if (requireCore) {
    const code = dto.code?.trim() ?? '';
    if (!code) throw new BadRequestException('Branch code is required');
    assertNotOnlySpecialChars(dto.code, 'Branch code');
    if (code.length < BRANCH_CODE_MIN)
      throw new BadRequestException(
        `Branch code must be at least ${BRANCH_CODE_MIN} characters`,
      );
    if (code.length > BRANCH_CODE_MAX)
      throw new BadRequestException(
        `Branch code must be ${BRANCH_CODE_MAX} characters or fewer`,
      );
  }

  if (dto.managerName?.trim()) {
    assertNotOnlySpecialChars(dto.managerName, 'Manager name');
    if (dto.managerName.trim().length > MANAGER_NAME_MAX) {
      throw new BadRequestException(
        `Manager name must be ${MANAGER_NAME_MAX} characters or fewer`,
      );
    }
  }

  if (dto.address?.trim() && dto.address.trim().length > ADDRESS_MAX) {
    throw new BadRequestException(
      `Address must be ${ADDRESS_MAX} characters or fewer`,
    );
  }

  if (dto.city?.trim()) {
    assertNotOnlySpecialChars(dto.city, 'City');
    if (dto.city.trim().length > CITY_MAX)
      throw new BadRequestException(
        `City must be ${CITY_MAX} characters or fewer`,
      );
  }

  if (dto.phone?.trim() && !PHONE_RE.test(dto.phone.trim())) {
    throw new BadRequestException('Phone number must be exactly 10 digits');
  }

  if (dto.email?.trim() && !EMAIL_RE.test(dto.email.trim())) {
    throw new BadRequestException('Email address is invalid');
  }
}
