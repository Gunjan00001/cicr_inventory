/**
 * Types shared by otherwise-independent feature modules.
 * Currently: AdminHardwareRequest (used by both modal.ts and admin.ts). */

export interface AdminHardwareRequest {
    id: string;
    type?: 'ISSUE' | 'RETURN';
    borrowId?: string;
    returnQuantity?: number;
    itemId: string;
    itemName: string;
    category?: string;
    borrowerName: string;
    borrowerEmail: string;
    rollNumber?: string | null;
    quantity: number;
    originalQuantity?: number;
    queuePosition?: number;
    queueAvailable?: number;
    queueAllocated?: number;
    purpose: string;
    durationDays: number;
    dueDate: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    requestedAt: string;
    reviewedAt?: string;
    reviewedBy?: string;
    reviewNote?: string;
}
