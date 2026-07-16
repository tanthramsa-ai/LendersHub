const NAME_HAS_DIGIT = /\d/;
/** Letters, numbers, spaces, and common punctuation only (no symbols like @#$%) */
const PLAIN_TEXT_ALLOWED = /^[a-zA-Z0-9\s\-.,']+$/;
const PLAIN_TEXT_SANITIZE = /[^a-zA-Z0-9\s\-.,']/g;
/** Loan purpose is stricter: letters, spaces and basic punctuation only — no digits, no symbols. */
const LOAN_PURPOSE_ALLOWED = /^[a-zA-Z\s\-.,']+$/;
const LOAN_PURPOSE_SANITIZE = /[^a-zA-Z\s\-.,']/g;
const PAN_SANITIZE = /[^A-Za-z0-9]/g;

export type QuickAddCustomerForm = {
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  locality: string;
  altContact: string;
  panNumber: string;
  aadhaarLast4: string;
  branchId: string;
};

export const EMPTY_QUICK_ADD_CUSTOMER: QuickAddCustomerForm = {
  firstName: '', lastName: '', phone: '', address: '', locality: '',
  altContact: '', panNumber: '', aadhaarLast4: '', branchId: '',
};

/** Map a customer (list or detail) into the Quick Add form. */
export function customerToQuickAddForm(c: {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  address?: string | null;
  locality?: string | null;
  altContact?: string | null;
  panNumber?: string | null;
  aadhaarLast4?: string | null;
  branchId?: string | null;
}): QuickAddCustomerForm {
  return {
    firstName: c.firstName ?? '',
    lastName: !c.lastName || c.lastName === '-' ? '' : c.lastName,
    phone: c.phone ?? '',
    address: c.address ?? '',
    locality: c.locality ?? '',
    altContact: c.altContact ?? '',
    panNumber: c.panNumber ?? '',
    aadhaarLast4: c.aadhaarLast4 ?? '',
    branchId: c.branchId ?? '',
  };
}

/** Returns every validation error for Quick Add Customer forms, so all missing/invalid fields surface at once. */
export function getQuickAddCustomerErrors(cust: {
  firstName: string;
  lastName?: string;
  phone: string;
  address: string;
  locality: string;
  altContact?: string;
  panNumber?: string;
  aadhaarLast4?: string;
  /** When true, alternate contact is required (default false). */
  requireAltContact?: boolean;
}): string[] {
  const errors: string[] = [];

  if (!cust.firstName.trim()) errors.push('First Name is missing');
  else if (NAME_HAS_DIGIT.test(cust.firstName)) errors.push('First Name cannot contain numbers');

  if (cust.lastName?.trim() && NAME_HAS_DIGIT.test(cust.lastName)) {
    errors.push('Last Name cannot contain numbers');
  }

  if (!cust.phone.trim()) errors.push('Phone number is missing');
  else if (!/^\d{10}$/.test(cust.phone)) errors.push('Phone number must be exactly 10 digits');

  if (!cust.address.trim()) errors.push('Address is missing');

  if (!cust.locality.trim()) errors.push('Locality is missing');
  else if (!PLAIN_TEXT_ALLOWED.test(cust.locality.trim())) {
    errors.push('Locality cannot contain special characters');
  }

  if (cust.requireAltContact && !cust.altContact?.trim()) {
    errors.push('Alternate Contact is missing');
  } else if (cust.altContact?.trim() && !/^\d{10}$/.test(cust.altContact)) {
    errors.push('Alternate contact number must be exactly 10 digits');
  }

  if (!cust.panNumber?.trim() && !cust.aadhaarLast4?.trim()) {
    errors.push('PAN or Aadhaar is missing');
  } else {
    if (cust.panNumber?.trim()) {
      if (/[^A-Z0-9]/.test(cust.panNumber.trim())) {
        errors.push('PAN cannot contain special characters');
      } else if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cust.panNumber.trim())) {
        errors.push('PAN format is invalid (e.g. ABCDE1234F)');
      }
    }
    if (cust.aadhaarLast4?.trim() && !/^\d{4}$/.test(cust.aadhaarLast4)) {
      errors.push('Aadhaar last 4 digits must be exactly 4 digits');
    }
  }

  return errors;
}

/** Strip digits from a name field as the user types. */
export function sanitizeNameInput(value: string): string {
  return value.replace(/\d/g, '');
}

/** Allow only letters, numbers, spaces, hyphen, comma, period, apostrophe. */
export function sanitizePlainTextInput(value: string): string {
  return value.replace(PLAIN_TEXT_SANITIZE, '');
}

export function sanitizeLocalityInput(value: string): string {
  return sanitizePlainTextInput(value);
}

/** Strip digits and symbols from loan purpose as the user types (letters/spaces/punctuation only). */
export function sanitizeLoanPurposeInput(value: string): string {
  return value.replace(LOAN_PURPOSE_SANITIZE, '');
}

/** Allow only alphanumeric characters; uppercase for PAN. */
export function sanitizePanInput(value: string): string {
  return value.replace(PAN_SANITIZE, '').toUpperCase().slice(0, 10);
}

/** True if loan purpose contains anything other than letters, spaces and basic punctuation. */
export function hasDisallowedLoanPurposeChars(value: string): boolean {
  return value.trim() !== '' && !LOAN_PURPOSE_ALLOWED.test(value.trim());
}
