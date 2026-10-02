/**
 * identity — "does this record belong to the signed-in user?" matching.
 *
 * Extracted from ModalManager: the same matching rules were needed across
 * modal, dashboard, profile, notification and ledger code. These functions
 * read the cached session and compare it against a loan/request record using
 * id, roll, email and (non-generic) name. Kept side-effect free.
 */
import { readCurrentUser } from './session';
import type { BorrowRecord } from '../types';

const GENERIC_NAMES = ['member', 'student', 'user', 'admin', 'borrower', 'guest', 'student borrower'];

function isGenericName(n: string): boolean {
    return !n || GENERIC_NAMES.includes(n) || n.length < 3;
}

export function isUserLoanMatch(rec: BorrowRecord): boolean {
    if (!rec) return false;
    const storedUser = readCurrentUser();
    const authName = (localStorage.getItem('cicr_auth') || '').toLowerCase().trim();
    const userName = (storedUser.name || storedUser.username || '').toLowerCase().trim();
    const userEmail = (storedUser.email || '').toLowerCase().trim();
    const userRoll = (storedUser.roll_number || storedUser.roll || '').toLowerCase().trim();
    const userId = storedUser.id || storedUser.userId || '';
    const recUserId = (rec as any).userId || (rec as any).user_id || '';

    const rRoll = ((rec as any).roll || (rec as any).rollNumber || (rec as any).roll_number || (rec as any).borrower_roll || (rec as any).userRoll || '').toLowerCase().trim();
    const rName = ((rec as any).userName || (rec as any).borrowerName || (rec as any).borrower_name || rec.name || '').toLowerCase().trim();

    // 1. Direct User ID match (authoritative unless the loan names another recipient)
    if (userId && recUserId && String(userId) === String(recUserId)) {
        if (rRoll && userRoll && rRoll !== userRoll) {
            // Different roll number -> not this user
        } else if (!isGenericName(rName) && !isGenericName(userName) && rName !== userName && (!authName || rName !== authName)) {
            // Different borrower name -> not this user
        } else {
            return true;
        }
    }

    // 2. Exact roll number match
    if (userRoll && rRoll && userRoll === rRoll) return true;
    if (userEmail && rRoll && (userEmail.startsWith(`${rRoll}@`) || userEmail === `${rRoll}@mail.jiit.ac.in`)) return true;

    // 3. Exact email match
    const recEmail = ((rec as any).email || (rec as any).userEmail || (rec as any).borrowerEmail || (rec as any).borrower_email || '').toLowerCase().trim();
    if (userEmail && recEmail && userEmail === recEmail) return true;

    // 4. Exact name match (guarding against generic placeholders)
    if (!isGenericName(userName) && !isGenericName(rName) && userName === rName) return true;
    if (!isGenericName(authName) && !isGenericName(rName) && authName === rName) return true;

    return false;
}

export function isUserRequestMatch(req: any): boolean {
    if (!req) return false;
    const storedUser = readCurrentUser();
    const authName = (localStorage.getItem('cicr_auth') || '').toLowerCase().trim();
    const userName = (storedUser.name || storedUser.username || '').toLowerCase().trim();
    const userEmail = (storedUser.email || '').toLowerCase().trim();
    const userRoll = (storedUser.roll_number || storedUser.roll || '').toLowerCase().trim();
    const userId = storedUser.id || storedUser.userId || '';
    const reqUserId = req.userId || req.user_id || '';

    const rRoll = (req.roll || req.rollNumber || req.roll_number || req.borrower_roll || req.userRoll || '').toLowerCase().trim();
    const rName = (req.name || req.borrowerName || req.borrower_name || req.userName || '').toLowerCase().trim();

    // 1. Direct User ID match (authoritative unless it names another requester)
    if (userId && reqUserId && String(userId) === String(reqUserId)) {
        if (rRoll && userRoll && rRoll !== userRoll) {
            // Different roll number -> not this user
        } else if (!isGenericName(rName) && !isGenericName(userName) && rName !== userName && (!authName || rName !== authName)) {
            // Different requester name -> not this user
        } else {
            return true;
        }
    }

    // 2. Exact roll number match
    if (userRoll && rRoll && userRoll === rRoll) return true;
    if (userEmail && rRoll && (userEmail.startsWith(`${rRoll}@`) || userEmail === `${rRoll}@mail.jiit.ac.in`)) return true;

    // 3. Exact email match
    const rEmail = (req.email || req.borrowerEmail || req.borrower_email || req.userEmail || '').toLowerCase().trim();
    if (userEmail && rEmail && userEmail === rEmail) return true;

    // 4. Exact name match (guarding against generic placeholders)
    if (!isGenericName(userName) && !isGenericName(rName) && userName === rName) return true;
    if (!isGenericName(authName) && !isGenericName(rName) && authName === rName) return true;

    return false;
}
