import { BadRequestException } from '@nestjs/common';
import {
  assertAllowedChars,
  PERSON_NAME_RE,
  PERSON_NAME_CHARS,
  ADDRESS_RE,
  ADDRESS_CHARS,
  EMAIL_RE,
} from '../common/text-validation';

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PHONE_RE = /^\d{10}$/;
const AADHAAR4_RE = /^\d{4}$/;
const PINCODE_RE = /^\d{6}$/;
/** Letters, numbers, spaces, and common punctuation only */
const PLAIN_TEXT_RE = /^[a-zA-Z0-9\s\-.,']+$/;
const PLAIN_TEXT_CHARS = "letters, numbers, spaces and - . , '";
/** Loan purpose is stricter: letters, spaces and basic punctuation only — no digits, no symbols. */
const LOAN_PURPOSE_RE = /^[a-zA-Z\s\-.,']+$/;
const LOAN_PURPOSE_CHARS = "letters, spaces and - . , '";

export function validateCustomerFields(dto: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  panNumber?: string;
  aadhaarLast4?: string;
  address?: string;
  locality?: string;
  pincode?: string;
  occupation?: string;
  altContact?: string;
  altContactName?: string;
  loanPurpose?: string;
  creditScore?: number;
  requireCore?: boolean;
}): void {
  const requireCore = dto.requireCore !== false;

  if (requireCore || dto.firstName !== undefined) {
    if (!dto.firstName?.trim()) throw new BadRequestException('First name is required');
    if (/\d/.test(dto.firstName)) throw new BadRequestException('First name cannot contain numbers');
    assertAllowedChars(dto.firstName, 'First name', PERSON_NAME_RE, PERSON_NAME_CHARS);
  }
  if (requireCore || dto.lastName !== undefined) {
    if (!dto.lastName?.trim()) throw new BadRequestException('Last name is required');
    if (/\d/.test(dto.lastName)) throw new BadRequestException('Last name cannot contain numbers');
    assertAllowedChars(dto.lastName, 'Last name', PERSON_NAME_RE, PERSON_NAME_CHARS);
  }
  if (requireCore || dto.phone !== undefined) {
    if (!dto.phone?.trim()) throw new BadRequestException('Phone number is required');
    if (!PHONE_RE.test(dto.phone.trim())) {
      throw new BadRequestException('Phone number must be exactly 10 digits');
    }
  }
  if (requireCore || dto.address !== undefined) {
    if (!dto.address?.trim()) throw new BadRequestException('Address is required');
    assertAllowedChars(dto.address, 'Address', ADDRESS_RE, ADDRESS_CHARS, false);
  }
  if (requireCore || dto.locality !== undefined) {
    if (!dto.locality?.trim()) throw new BadRequestException('Locality is required');
    assertAllowedChars(dto.locality, 'Locality', PLAIN_TEXT_RE, PLAIN_TEXT_CHARS);
  }
  // Occupation is optional; when provided it must be letters/spaces/basic punctuation only — no digits.
  if (dto.occupation != null && dto.occupation !== '') {
    assertAllowedChars(dto.occupation, 'Occupation', LOAN_PURPOSE_RE, LOAN_PURPOSE_CHARS);
  }

  // Alternate contact NAME was previously stored with no validation at all.
  if (dto.altContactName != null && dto.altContactName !== '') {
    assertAllowedChars(dto.altContactName, 'Contact name', PERSON_NAME_RE, PERSON_NAME_CHARS);
  }

  // Alternate contact is optional; when provided it must be a valid 10-digit number
  if (dto.altContact != null && dto.altContact !== '') {
    if (!PHONE_RE.test(dto.altContact.trim())) {
      throw new BadRequestException('Alternate contact number must be exactly 10 digits');
    }
  }

  if (dto.email?.trim() && !EMAIL_RE.test(dto.email.trim())) {
    throw new BadRequestException('Email address is invalid');
  }

  if (dto.panNumber?.trim()) {
    const pan = dto.panNumber.trim().toUpperCase();
    if (/[^A-Z0-9]/.test(pan)) {
      throw new BadRequestException('PAN cannot contain special characters');
    }
    if (!PAN_RE.test(pan)) {
      throw new BadRequestException('PAN number format is invalid (e.g. ABCDE1234F)');
    }
  }

  if (dto.aadhaarLast4 != null && dto.aadhaarLast4 !== '') {
    if (!AADHAAR4_RE.test(dto.aadhaarLast4.trim())) {
      throw new BadRequestException('Aadhaar last 4 digits must be exactly 4 digits');
    }
  }

  if (dto.pincode != null && dto.pincode !== '') {
    if (!PINCODE_RE.test(dto.pincode.trim())) {
      throw new BadRequestException('Pincode must be exactly 6 digits');
    }
  }

  if (dto.loanPurpose != null && dto.loanPurpose !== '') {
    assertAllowedChars(dto.loanPurpose, 'Loan purpose', LOAN_PURPOSE_RE, LOAN_PURPOSE_CHARS);
  }

  if (dto.creditScore != null && (dto.creditScore < 300 || dto.creditScore > 900)) {
    throw new BadRequestException('Credit score must be between 300 and 900');
  }

  if (requireCore) {
    if (!dto.panNumber?.trim() && !dto.aadhaarLast4?.trim()) {
      throw new BadRequestException('At least one of PAN number or Aadhaar number is required');
    }
  } else if (dto.panNumber !== undefined || dto.aadhaarLast4 !== undefined) {
    // On update, if both are being cleared / empty, reject when both end up empty.
    // Caller should pass the effective values when checking KYC on update.
  }
}

/** Check for loan purpose / similar free-text fields: letters, spaces and basic punctuation only. */
export function assertNoDigitsOrSpecialChars(value: string | undefined | null, fieldLabel: string): void {
  assertAllowedChars(value, fieldLabel, LOAN_PURPOSE_RE, LOAN_PURPOSE_CHARS);
}
