const NAME_HAS_DIGIT = /\d/;
/** Letters, numbers, spaces, and common punctuation only (no symbols like @#$%) */
const PLAIN_TEXT_ALLOWED = /^[a-zA-Z0-9\s\-.,']+$/;
const PLAIN_TEXT_SANITIZE = /[^a-zA-Z0-9\s\-.,']/g;
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
};

export const EMPTY_QUICK_ADD_CUSTOMER: QuickAddCustomerForm = {
  firstName: '', lastName: '', phone: '', address: '', locality: '',
  altContact: '', panNumber: '', aadhaarLast4: '',
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
  };
}

/** Returns the first specific validation error for Quick Add Customer forms. */
export function getQuickAddCustomerError(cust: {
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
}): string | null {
  if (!cust.firstName.trim()) return 'First Name is missing';
  if (NAME_HAS_DIGIT.test(cust.firstName)) return 'First Name cannot contain numbers';
  if (cust.lastName?.trim() && NAME_HAS_DIGIT.test(cust.lastName)) {
    return 'Last Name cannot contain numbers';
  }
  if (!cust.phone.trim()) return 'Phone number is missing';
  if (!/^\d{10}$/.test(cust.phone)) return 'Phone number must be exactly 10 digits';
  if (!cust.address.trim()) return 'Address is missing';
  if (!cust.locality.trim()) return 'Locality is missing';
  if (!PLAIN_TEXT_ALLOWED.test(cust.locality.trim())) {
    return 'Locality cannot contain special characters';
  }

  if (cust.requireAltContact && !cust.altContact?.trim()) {
    return 'Alternate Contact is missing';
  }
  if (cust.altContact?.trim() && !/^\d{10}$/.test(cust.altContact)) {
    return 'Alternate contact number must be exactly 10 digits';
  }

  if (!cust.panNumber?.trim() && !cust.aadhaarLast4?.trim()) {
    return 'PAN or Aadhaar is missing';
  }
  if (cust.panNumber?.trim()) {
    if (/[^A-Z0-9]/.test(cust.panNumber.trim())) {
      return 'PAN cannot contain special characters';
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cust.panNumber.trim())) {
      return 'PAN format is invalid (e.g. ABCDE1234F)';
    }
  }
  if (cust.aadhaarLast4?.trim() && !/^\d{4}$/.test(cust.aadhaarLast4)) {
    return 'Aadhaar last 4 digits must be exactly 4 digits';
  }

  return null;
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

export function sanitizeLoanPurposeInput(value: string): string {
  return sanitizePlainTextInput(value);
}

/** Allow only alphanumeric characters; uppercase for PAN. */
export function sanitizePanInput(value: string): string {
  return value.replace(PAN_SANITIZE, '').toUpperCase().slice(0, 10);
}

export function hasDisallowedSpecialChars(value: string): boolean {
  return value.trim() !== '' && !PLAIN_TEXT_ALLOWED.test(value.trim());
}
