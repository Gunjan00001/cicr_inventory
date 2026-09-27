import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbWrite, dbRead, supabase } from '../../config/database';
import { isNeonConfigured, queryWrite as neonQueryWrite } from '../../config/neonPool';
import { AuthRequest, AuthUser } from '../../middleware/auth.middleware';
import { isValidEmail } from '../../validators/email.validator';
import { escapeOrSegment } from '../../validators/postgrest';
import {
  MASTER_ADMIN_EMAIL,
  SUPER_ADMIN_EMAILS,
  DEFAULT_DESIGNATED_ADMINS,
  isSuperAdminEmail,
  isDesignatedAdmin,
  isPurgedUser,
  unpurgeEmail,
  getUserApproval,
  setUserApproval,
  setUserRole,
  deleteUserApproval,
  getAllUserApprovals,
  findUserApprovalByIdentifier,
  getAllAdminEmails,
  syncApprovalsFromDatabase,
  checkUserApprovalInDatabase,
  updateUserMetadata
} from './userApprovalService';
import {
  sendAdminNewUserRegistrationAlert,
  sendUserApprovalSuccessEmail,
  sendUserRejectionNotificationEmail,
  sendAdminUserStatusAlert,
  sendLoginSecurityAlertEmail,
  sendUserWelcomeWithTempPasswordEmail,
  sendPasswordResetOtpEmail,
  sendPasswordChangedSuccessEmail
} from '../../services/emailService';
import { generateAuthOtp, storeAuthOtp, verifyAuthOtp, consumeAuthOtp } from './authOtpService';
import { logAuditEvent } from '../../services/auditService';

// users-table row shape for reads in this controller. Queries select different
// column subsets, so this reuses the existing AuthUser type with everything
// optional except the id/email fields every callback below relies on.
interface AuthUserRow extends Partial<AuthUser> {
  id: string;
  email: string;
  created_at?: string;
}

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, username, password, roll_number, batch } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ status: 'error', message: 'Name, email, and password required.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        status: 'error',
        message: 'Access restricted. Only official JIIT student accounts (enrollmentnumber@mail.jiit.ac.in) and authorized administrators can create an account.'
      });
    }

    const normEmail = email.trim().toLowerCase();
    const normUsername = (username || name).trim();
    const userBatch = batch ? String(batch).trim() : null;

    // Auto-extract enrollment number from student email if roll_number not provided
    let userRoll = roll_number ? String(roll_number).trim() : null;
    if (!userRoll) {
      const match = normEmail.match(/^(\d+)@mail\.jiit\.ac\.in$/i);
      if (match) {
        userRoll = match[1];
      }
    }

    // Strict duplicate check across database: case-insensitive email OR roll number
    const { data: existingMatches } = await dbRead
      .from('users')
      .select('id, email, roll_number')
      .or(`email.ilike.${escapeOrSegment(normEmail)}${userRoll ? `,roll_number.eq.${escapeOrSegment(userRoll)}` : ''}`)
      .limit(2);

    if (existingMatches && existingMatches.length > 0) {
      const emailMatch = existingMatches.find((u: AuthUserRow) => u.email?.toLowerCase() === normEmail);
      if (emailMatch && !isPurgedUser(normEmail)) {
        return res.status(400).json({
          status: 'error',
          message: 'An account with this college email is already registered. If your request is pending, please wait for admin approval or try logging in.'
        });
      }
      const rollMatch = existingMatches.find((u: AuthUserRow) => userRoll && u.roll_number === userRoll);
      if (rollMatch && !isPurgedUser(rollMatch.email)) {
        return res.status(400).json({
          status: 'error',
          message: `An account with enrollment number ${userRoll} is already registered. Please log in.`
        });
      }
    }

    const isMasterAdmin = isSuperAdminEmail(normEmail);
    // H-1 FIX: ADMIN derives from the exact allow-list email only; name never grants ADMIN.
    const isDesignated = isDesignatedAdmin(normEmail);
    const userRole = (isMasterAdmin || isDesignated) ? 'ADMIN' : 'MEMBER';
    const isCollegeAccount = normEmail.endsWith('@mail.jiit.ac.in') || normEmail.endsWith('@jiit.ac.in');
    const autoApproveStudents = process.env.AUTO_APPROVE_STUDENTS === 'true';
    const initialStatus = (isMasterAdmin || isDesignated || (isCollegeAccount && autoApproveStudents)) ? 'APPROVED' : 'PENDING';

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    unpurgeEmail(normEmail);

    let newUser: any = null;
    const existingPurged = existingMatches?.find((u: AuthUserRow) => u.email?.toLowerCase() === normEmail);

    if (existingPurged) {
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({ name: name.trim(), password_hash, roll_number: userRoll, role: userRole })
        .eq('id', existingPurged.id)
        .select('id, name, email, roll_number, role, created_at')
        .single();
      if (updateError || !updatedUser) {
        newUser = { id: existingPurged.id, name: name.trim(), email: normEmail, roll_number: userRoll, role: userRole, created_at: new Date().toISOString() };
      } else {
        newUser = updatedUser;
      }
    } else {
      const { data: insertedUser, error: insertError } = await supabase
        .from('users')
        .insert([{ name: name.trim(), email: normEmail, password_hash, roll_number: userRoll, role: userRole }])
        .select('id, name, email, roll_number, role, created_at')
        .single();

      if (insertError || !insertedUser) {
        if (insertError?.code === '23505') {
          return res.status(400).json({
            status: 'error',
            message: 'An account with this college email or enrollment number is already registered. Please log in.'
          });
        }
        console.error('[AUTH REGISTER ERROR] Supabase insert failed:', insertError);
        return res.status(500).json({ status: 'error', message: 'Failed to create user account. Please try again.' });
      }

      newUser = insertedUser;
    }

    // Track approval status and registration metadata
    setUserApproval(normEmail, initialStatus, (initialStatus === 'APPROVED') ? 'SYSTEM (AUTO-APPROVE)' : 'PENDING_REGISTRATION', {
      username: normUsername,
      batch: userBatch,
      name: name.trim(),
      roll_number: userRoll
    });

    // Record in system audit trail
    logAuditEvent({
      action: 'Sign Up',
      userId: newUser.id,
      itemId: null,
      description: `New ${userRole === 'ADMIN' ? 'Admin' : 'Student'} registration (${initialStatus}): ${name.trim()} (@${normUsername}, ${normEmail}) [Batch: ${userBatch || 'N/A'}, Role: ${userRole}]`
    }).catch(() => {});

    // Send instant email notification to ALL Admins if non-master-admin registers
    if (!isMasterAdmin) {
      const adminRecipients = await getAllAdminEmails();
      sendAdminNewUserRegistrationAlert(adminRecipients, {
        userName: name.trim(),
        userEmail: normEmail,
        username: normUsername,
        rollNumber: userRoll,
        batch: userBatch,
        registeredAt: newUser.created_at || new Date().toISOString()
      }).catch((e) => console.error('[EMAIL ERROR] Failed to send admin registration alert:', e));
    }

    // Dispatch Welcome & Temporary Credentials Email directly to the registered user
    sendUserWelcomeWithTempPasswordEmail(normEmail, {
      userName: name.trim(),
      userEmail: normEmail,
      tempPassword: password,
      rollNumber: userRoll,
      batch: userBatch,
      isAutoApproved: initialStatus === 'APPROVED'
    }).catch((e) => console.error('[EMAIL ERROR] Failed to send welcome credentials email:', e));

    const message = (isMasterAdmin || isDesignated)
      ? `Admin registered and approved successfully! Welcome ${name.trim()}.`
      : (initialStatus === 'APPROVED' ? `Account registered and auto-approved successfully! You can now log in.` : `Account registered successfully! Awaiting administrator approval.`);

    return res.status(201).json({
      status: 'success',
      message,
      data: { ...newUser, username: normUsername, batch: userBatch, status: initialStatus }
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, email, username, name, password } = req.body;
    const loginId = (identifier || email || username || name || '').trim();

    if (!loginId || !password) {
      return res.status(400).json({ status: 'error', message: 'Email, Username, or Name and password required.' });
    }

    if (loginId.includes('@') && !isValidEmail(loginId)) {
      return res.status(403).json({
        status: 'forbidden',
        message: 'Access restricted. Only official JIIT student accounts (enrollmentnumber@mail.jiit.ac.in) and authorized administrators can log in.'
      });
    }

    // Resolve user by Email, Name, or Username
    let user: any = null;

    // 1. Direct email match if identifier is an email
    if (loginId.includes('@')) {
      const { data } = await dbRead
        .from('users')
        .select('*')
        .eq('email', loginId.toLowerCase())
        .maybeSingle();
      if (data) user = data;
    }

    // 2. Name or email ilike lookup in DB
    if (!user) {
      const { data } = await dbRead
        .from('users')
        .select('*')
        .or(`email.ilike.${escapeOrSegment(loginId)},name.ilike.${escapeOrSegment(loginId)}`)
        .limit(1)
        .maybeSingle();
      if (data) user = data;
    }

    // 3. Approval state lookup (matches username, name, roll_number, or email)
    if (!user) {
      const match = findUserApprovalByIdentifier(loginId);
      if (match) {
        const { data } = await dbRead
          .from('users')
          .select('*')
          .eq('email', match.email)
          .maybeSingle();
        if (data) user = data;
      }
    }

    // 4. Master Admin Aliases
    if (!user) {
      const lower = loginId.toLowerCase();
      const match = DEFAULT_DESIGNATED_ADMINS.find(
        (a) =>
          a.username.toLowerCase() === lower ||
          a.email.toLowerCase() === lower ||
          a.name.toLowerCase() === lower ||
          (a.roll_number && a.roll_number.toLowerCase() === lower) ||
          (a.username === 'cicradmin' && ['cicradmin', 'cicrinventory', 'cicr admin'].includes(lower)) ||
          (a.username === 'vardaan' && ['vardaan', 'vardaansaxena'].includes(lower))
      );
      if (match) {
        const { data } = await dbRead.from('users').select('*').eq('email', match.email).maybeSingle();
        if (data) user = data;
      }
    }

    if (!user) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials. User not found by email, username, or name.' });
    }

    if (!isValidEmail(user.email) && user.role !== 'ADMIN') {
      return res.status(403).json({
        status: 'forbidden',
        message: 'Access restricted. Only official JIIT student accounts (enrollmentnumber@mail.jiit.ac.in) and authorized administrators can log in.'
      });
    }

    const isMasterAdmin = isSuperAdminEmail(user.email);
    if (!isMasterAdmin && isPurgedUser(user.email)) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials. Account not found or has been removed.' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials. Incorrect password.' });
    }

    // H-1 FIX: ADMIN derives from the exact allow-list email only; stored name never grants ADMIN.
    const isDesignated = isDesignatedAdmin(user.email);

    if ((isMasterAdmin || isDesignated) && user.role !== 'ADMIN') {
      try {
        await supabase.from('users').update({ role: 'ADMIN' }).eq('id', user.id);
        user.role = 'ADMIN';
      } catch (err) {
        console.warn('Could not sync admin role in DB:', err);
      }
    }

    let approval = getUserApproval(user.email, user.role);
    if (isMasterAdmin || isDesignated) {
      approval.role = 'ADMIN';
      approval.status = 'APPROVED';
    }

    // Auto-approve college accounts and designated admins if pending
    if (approval.status === 'PENDING' && (user.email.endsWith('@mail.jiit.ac.in') || user.email.endsWith('@jiit.ac.in') || isDesignated)) {
      approval = setUserApproval(user.email, 'APPROVED', 'SYSTEM (AUTO-APPROVE)');
    }

    if (approval.status === 'PENDING') {
      // Live sync check from Supabase audit_logs in case approved recently or on another container
      const dbStatus = await checkUserApprovalInDatabase(user.email);
      if (dbStatus === 'APPROVED') {
        approval = setUserApproval(user.email, 'APPROVED', 'ADMIN');
      } else if (dbStatus === 'REJECTED') {
        approval = setUserApproval(user.email, 'REJECTED', 'ADMIN');
      }
    }

    if (approval.status === 'PENDING') {
      return res.status(403).json({
        status: 'pending_approval',
        message: 'Your account is pending admin approval. You will receive access once approved by CICR Admin.'
      });
    }

    if (approval.status === 'REJECTED') {
      return res.status(403).json({
        status: 'rejected',
        message: 'Your access request was rejected by the CICR Admin.'
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('FATAL: JWT_SECRET environment variable is not set.');
      return res.status(500).json({ status: 'error', message: 'Server misconfiguration.' });
    }

    // H-1 FIX: role resolution uses the exact allow-list email only; stored name never grants ADMIN.
    const effectiveRole = (isMasterAdmin || isDesignated || user.role === 'ADMIN' || approval.role === 'ADMIN')
      ? 'ADMIN'
      : 'MEMBER';

    // H-3: bind the JWT to the row's token_version (1 for rows predating
    // the migration). Any later password/role invalidation bumps the row,
    // so this token stops verifying.
    const tokenVersion =
      typeof user.token_version === 'number' &&
      Number.isInteger(user.token_version) &&
      user.token_version > 0
        ? user.token_version
        : 1;

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: effectiveRole, tv: tokenVersion },
      secret,
      { expiresIn: '7d' }
    );

    // Dispatch login security notice strictly to the user
    sendLoginSecurityAlertEmail({
      userEmail: user.email,
      userName: user.name,
      role: effectiveRole,
      ip: (req.headers['x-forwarded-for'] as string) || req.ip,
      userAgent: req.headers['user-agent'],
      loginTime: new Date()
    }).catch((e) => console.error('[EMAIL ERROR] Failed to send login alert:', e));

    logAuditEvent({
      action: 'Sign In',
      userId: user.id,
      itemId: null,
      description: `User authenticated: ${user.name} (${user.email}) [Role: ${effectiveRole}] via ${loginId}`
    }).catch(() => {});

    return res.status(200).json({
      status: 'success',
      token,
      user: {
        id: user.id,
        name: (approval as any)?.name || user.name,
        email: user.email,
        roll_number: (approval as any)?.roll_number || user.roll_number || null,
        role: effectiveRole,
        status: approval.status,
        username: (approval as any)?.username || user.username || undefined,
        batch: (approval as any)?.batch || user.batch || undefined,
        avatar_url: (approval as any)?.avatar_url || user.avatar_url || undefined
      }
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

export const verifyLoginOtp = async (req: Request, res: Response) => {
  return res.status(400).json({
    status: 'error',
    message: 'OTP verification is no longer required. Please sign in directly with your credentials.'
  });
};

export const resendLoginOtp = async (req: Request, res: Response) => {
  return res.status(400).json({
    status: 'error',
    message: 'OTP verification is no longer required. Please sign in directly with your credentials.'
  });
};

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    if (!userId && !userEmail) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized. Authentication token missing.' });
    }

    // Try fetching with all profile columns
    let user: any = null;

    if (userId) {
      try {
        const fullSelect = await dbRead
          .from('users')
          .select('id, name, email, roll_number, role, created_at, username, batch, avatar_url')
          .eq('id', userId)
          .maybeSingle();

        if (fullSelect.data) {
          user = fullSelect.data;
        }
      } catch {}

      if (!user) {
        try {
          const basicSelect = await dbRead
            .from('users')
            .select('id, name, email, roll_number, role, created_at')
            .eq('id', userId)
            .maybeSingle();
          if (basicSelect.data) user = basicSelect.data;
        } catch {}
      }
    }

    if (!user && userEmail) {
      try {
        const byEmail = await dbRead
          .from('users')
          .select('id, name, email, roll_number, role, created_at')
          .eq('email', userEmail.toLowerCase())
          .maybeSingle();
        if (byEmail.data) user = byEmail.data;
      } catch {}
    }

    const email = user?.email || userEmail || '';
    const isMasterAdmin = isSuperAdminEmail(email) || isDesignatedAdmin(email) || (user && user.role === 'ADMIN');
    const approval = getUserApproval(email, user?.role || (isMasterAdmin ? 'ADMIN' : 'MEMBER'));

    if (!user && !isMasterAdmin && !approval) {
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }

    const id = user?.id || userId || approval.username || 'user';
    const name = approval.name || user?.name || req.user?.name || (isMasterAdmin ? 'CICR Admin' : 'Member');
    const role = isMasterAdmin ? 'ADMIN' : (approval.role || user?.role || req.user?.role || 'MEMBER');
    const roll_number = approval.roll_number || user?.roll_number || req.user?.roll_number || null;
    const username = approval.username || user?.username || (email ? email.split('@')[0] : 'operator');
    const batch = approval.batch || user?.batch || null;
    const avatar_url = approval.avatar_url || user?.avatar_url || null;

    return res.status(200).json({
      status: 'success',
      data: {
        id,
        name,
        email,
        roll_number,
        role,
        status: approval.status || 'APPROVED',
        username,
        batch,
        avatar_url,
        created_at: user?.created_at || approval.approvedAt || new Date().toISOString(),
        isMasterAdmin
      }
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email;
    if (!userId && !userEmail) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized. Authentication token missing.' });
    }

    const { name, username, batch, branch, avatar_url, profile_pic, roll_number, rollNumber } = req.body;

    const updates: Record<string, any> = {};

    if (typeof name === 'string' && name.trim().length > 0) {
      updates.name = name.trim();
    }

    if (typeof username === 'string') {
      const cleanUsername = username.trim().toLowerCase().replace(/^@/, '');
      if (cleanUsername.length > 0) {
        // Enforce uniqueness if username is being changed
        const { data: existingUser } = await dbRead
          .from('users')
          .select('id')
          .ilike('username', cleanUsername)
          .neq('id', userId || '')
          .maybeSingle();

        if (existingUser) {
          return res.status(400).json({
            status: 'error',
            message: `Username "@${cleanUsername}" is already taken. Please choose another handle.`
          });
        }
        updates.username = cleanUsername;
      }
    }

    const resolvedBatch = (typeof batch === 'string' && batch.trim()) ? batch.trim() : ((typeof branch === 'string' && branch.trim()) ? branch.trim() : '');
    if (resolvedBatch) {
      updates.batch = resolvedBatch;
    }

    const resolvedRoll = (typeof roll_number === 'string' && roll_number.trim()) ? roll_number.trim() : ((typeof rollNumber === 'string' && rollNumber.trim()) ? rollNumber.trim() : '');
    if (resolvedRoll) {
      updates.roll_number = resolvedRoll;
    }

    const resolvedAvatar = avatar_url !== undefined ? avatar_url : profile_pic;
    if (resolvedAvatar !== undefined) {
      updates.avatar_url = resolvedAvatar;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No editable fields provided.'
      });
    }

    // 1. Fetch current user from DB to verify user record
    let currentUser: any = null;
    if (userId) {
      try {
        const { data } = await dbRead.from('users').select('*').eq('id', userId).maybeSingle();
        if (data) currentUser = data;
      } catch {}
    }
    if (!currentUser && userEmail) {
      try {
        const { data } = await dbRead.from('users').select('*').eq('email', userEmail.toLowerCase()).maybeSingle();
        if (data) currentUser = data;
      } catch {}
    }

    const targetEmail = currentUser?.email || userEmail || '';
    const targetId = currentUser?.id || userId;

    let updatedUser: any = {
      ...(currentUser || {}),
      ...updates
    };

    // 2. Persist to Neon PostgreSQL directly (which holds all schema columns)
    try {
      if (isNeonConfigured() && targetId) {
        const fields = Object.keys(updates);
        if (fields.length > 0) {
          const setClause = fields.map((f, i) => `"${f}" = $${i + 1}`).join(', ');
          const values = fields.map((f) => updates[f]);
          await neonQueryWrite(`UPDATE users SET ${setClause} WHERE id = $${fields.length + 1}`, [...values, targetId]);
        }
      }
    } catch (neonErr: any) {
      console.warn('[UPDATE PROFILE] Neon direct sync note:', neonErr.message);
    }

    // 3. Persist to Supabase dbWrite (with resilient column handling)
    try {
      if (targetId) {
        const { data, error } = await dbWrite
          .from('users')
          .update(updates)
          .eq('id', targetId)
          .select('*')
          .maybeSingle();

        if (error) {
          // If schema cache lacks columns like avatar_url, batch, or username, update only core columns
          const standardUpdates: Record<string, any> = {};
          if (updates.name) standardUpdates.name = updates.name;
          if (updates.roll_number) standardUpdates.roll_number = updates.roll_number;

          if (Object.keys(standardUpdates).length > 0) {
            const { data: fallbackData } = await dbWrite
              .from('users')
              .update(standardUpdates)
              .eq('id', targetId)
              .select('*')
              .maybeSingle();
            if (fallbackData) {
              updatedUser = { ...fallbackData, ...updates };
            }
          }
        } else if (data) {
          updatedUser = { ...data, ...updates };
        }
      }
    } catch (dbErr: any) {
      console.warn('[UPDATE PROFILE] Supabase update note:', dbErr.message);
    }

    // 4. Always synchronize persistent JSON & memory approval state
    if (targetEmail) {
      updateUserMetadata(targetEmail, {
        name: updates.name || updatedUser.name,
        username: updates.username || updatedUser.username,
        batch: updates.batch || updatedUser.batch,
        avatar_url: resolvedAvatar !== undefined ? resolvedAvatar : updatedUser.avatar_url,
        roll_number: updates.roll_number || updatedUser.roll_number
      });
    }

    const isMasterAdmin = isSuperAdminEmail(targetEmail) || isDesignatedAdmin(targetEmail);
    const finalRole = isMasterAdmin ? 'ADMIN' : (updatedUser.role || 'MEMBER');

    return res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: {
        id: updatedUser.id || targetId,
        name: updates.name || updatedUser.name,
        email: targetEmail,
        roll_number: updates.roll_number || updatedUser.roll_number || null,
        role: finalRole,
        username: updates.username || updatedUser.username || null,
        batch: updates.batch || updatedUser.batch || null,
        avatar_url: resolvedAvatar !== undefined ? resolvedAvatar : (updatedUser.avatar_url || null),
        created_at: updatedUser.created_at || new Date().toISOString()
      }
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message || 'Failed to update user profile.' });
  }
};

// ==========================================
// Admin Member Management Endpoints
// ==========================================

export const listUsersForAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const force = req.query.force === 'true';
    await syncApprovalsFromDatabase(force);

    const { data: users, error } = await dbRead
      .from('users')
      .select('id, name, email, roll_number, role, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const allApprovals = getAllUserApprovals();

    const userList = (users || [])
      .filter((u: AuthUserRow) => !u.email.endsWith('.test'))
      .map((u: AuthUserRow) => {
        const normEmail = u.email.toLowerCase();
        const isMaster = isSuperAdminEmail(normEmail) || isDesignatedAdmin(normEmail) || u.role === 'ADMIN';
        const approval = allApprovals[normEmail] || getUserApproval(normEmail, u.role || 'MEMBER');

        const effectiveRole: 'ADMIN' | 'MEMBER' = isMaster ? 'ADMIN' : (approval.role || 'MEMBER');
        const effectiveStatus: 'APPROVED' | 'PENDING' | 'REJECTED' = isMaster ? 'APPROVED' : (approval.status || 'APPROVED');

        return {
          id: u.id,
          name: approval.name || u.name,
          email: u.email,
          username: approval.username || null,
          batch: approval.batch || null,
          roll_number: approval.roll_number || u.roll_number || null,
          avatar_url: approval.avatar_url || (u as any).avatar_url || null,
          role: effectiveRole,
          status: effectiveStatus,
          isMasterAdmin: isMaster,
          created_at: u.created_at
        };
      });

    return res.status(200).json({ status: 'success', count: userList.length, data: userList });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

export const approveUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { data: user, error } = await dbRead.from('users').select('id, email, name').eq('id', id).single();
    if (error || !user) return res.status(404).json({ status: 'error', message: 'User not found.' });

    const approver = req.user?.name || 'Admin';
    const updated = setUserApproval(user.email, 'APPROVED', approver);

    // Persist to audit_logs in Supabase so it's permanently stored across all instances and restarts
    await logAuditEvent({
      action: 'User Approved',
      userId: req.user?.id,
      itemId: null,
      description: `Admin ${approver} approved user account ${user.name} (${user.email})`
    });

    // Send instant approval confirmation email to user
    sendUserApprovalSuccessEmail(user.email, user.name).catch((e) =>
      console.error('[EMAIL ERROR] Failed to send user approval email:', e)
    );

    // Instant alert to all admins
    const allAdmins = await getAllAdminEmails();
    sendAdminUserStatusAlert(allAdmins, user.name, user.email, 'APPROVED', approver).catch((e) =>
      console.error('[EMAIL ERROR] Failed to send admin status alert:', e)
    );

    return res.status(200).json({
      status: 'success',
      message: `User ${user.name} approved successfully.`,
      data: updated,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

export const rejectUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { data: user, error } = await dbRead.from('users').select('id, email, name').eq('id', id).single();
    if (error || !user) return res.status(404).json({ status: 'error', message: 'User not found.' });

    const rejector = req.user?.name || 'Admin';
    const updated = setUserApproval(user.email, 'REJECTED', rejector);

    // Persist to audit_logs in Supabase
    await logAuditEvent({
      action: 'User Rejected',
      userId: req.user?.id,
      itemId: null,
      description: `Admin ${rejector} rejected registration for ${user.name} (${user.email})`
    });

    // Send rejection notification email to user
    sendUserRejectionNotificationEmail(user.email, user.name).catch((e) =>
      console.error('[EMAIL ERROR] Failed to send user rejection email:', e)
    );

    // Instant alert to all admins
    const allAdmins = await getAllAdminEmails();
    sendAdminUserStatusAlert(allAdmins, user.name, user.email, 'REJECTED', rejector).catch((e) =>
      console.error('[EMAIL ERROR] Failed to send admin status alert:', e)
    );

    return res.status(200).json({ status: 'success', message: `User ${user.name} registration rejected.`, data: updated });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

export const changeUserRole = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (role !== 'ADMIN' && role !== 'MEMBER') {
      return res.status(400).json({ status: 'error', message: 'Role must be ADMIN or MEMBER.' });
    }

    const { data: user, error } = await dbRead.from('users').select('id, email, name, role').eq('id', id).single();
    if (error || !user) return res.status(404).json({ status: 'error', message: 'User not found.' });

    if ((isSuperAdminEmail(user.email) || isDesignatedAdmin(user.email) || user.role === 'ADMIN') && role !== 'ADMIN') {
      return res.status(400).json({ status: 'error', message: 'Cannot demote a Master Admin / Administrator.' });
    }

    const blockedAdminEmails = (process.env.BLOCKED_ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    if (blockedAdminEmails.includes(user.email.toLowerCase()) && role === 'ADMIN') {
      return res.status(400).json({ status: 'error', message: 'User is not permitted to hold an ADMIN role.' });
    }

    const updated = setUserRole(user.email, role);
    // H-3: fresh token_version invalidates JWTs issued before this role change.
    await supabase.from('users').update({ role, token_version: Date.now() }).eq('id', id);

    logAuditEvent({
      action: 'Role Changed',
      userId: req.user?.id,
      itemId: null,
      description: `Admin ${req.user?.name || 'Admin'} updated role for ${user.name} (${user.email}) to ${role}`
    }).catch(() => {});

    return res.status(200).json({ status: 'success', message: `Role for ${user.name} changed to ${role}.`, data: updated });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { data: user, error } = await dbRead.from('users').select('id, email, name, role').eq('id', id).single();
    if (error || !user) return res.status(404).json({ status: 'error', message: 'User not found in database.' });

    if (isSuperAdminEmail(user.email) || isDesignatedAdmin(user.email) || user.role === 'ADMIN') {
      return res.status(400).json({ status: 'error', message: 'Cannot delete a Master Admin / Administrator.' });
    }

    // 1. Clean up dependent foreign keys in database so deletion never fails
    try {
      await dbWrite.from('borrow_records').delete().eq('user_id', id);
      await dbWrite.from('audit_logs').update({ user_id: null }).eq('user_id', id);
    } catch (cleanErr) {
      console.warn('[DELETE USER] Warning while cleaning references:', cleanErr);
    }

    // 2. Permanently delete from Supabase PostgreSQL users table
    const { data: deletedRows, error: dbDeleteError } = await dbWrite.from('users').delete().eq('id', id).select();
    if (dbDeleteError) {
      console.error('[DELETE USER ERROR] Supabase users table deletion failed:', dbDeleteError);
      return res.status(500).json({ status: 'error', message: `Database deletion failed: ${dbDeleteError.message}` });
    }

    if (!deletedRows || deletedRows.length === 0) {
      console.warn('[DELETE USER WARN] 0 rows deleted from users table. If Row Level Security (RLS) is enabled on users table in Supabase, please run backend/migrations/006_allow_admin_manage_users_rls.sql or set SUPABASE_SERVICE_ROLE_KEY.');
    }

    // Also delete by email if ID differed for any reason
    if (user.email) {
      await dbWrite.from('users').delete().ilike('email', user.email).select();
    }

    // 3. Remove approval and registration state
    deleteUserApproval(user.email);

    // 4. Log audit event
    await logAuditEvent({
      action: 'User Deleted',
      userId: req.user?.id,
      itemId: null,
      description: `Admin ${req.user?.name || 'Admin'} deleted user ${user.name} (${user.email})`
    }).catch(() => {});

    return res.status(200).json({ status: 'success', message: `User ${user.name} permanently deleted from database.` });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD (REQUEST RESET OTP)
// ──────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD (NO OTP REQUIRED - DIRECT RESET ACTIVE)
// ──────────────────────────────────────────────────────────────────────────────
export const forgotPassword = async (req: Request, res: Response) => {
  return res.status(200).json({
    status: 'success',
    message: 'OTP verification has been completely decommissioned. You can reset your password directly on the website without any OTP.',
    direct_reset: true
  });
};

// ──────────────────────────────────────────────────────────────────────────────
// RESET PASSWORD (DIRECT DATABASE SYNC - NO OTP REQUIRED)
// ──────────────────────────────────────────────────────────────────────────────
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { identifier, email, new_password, current_password } = req.body;
    const loginId = (identifier || email || '').trim();

    if (!loginId || !new_password) {
      return res.status(400).json({ status: 'error', message: 'College email or enrollment number and new password are required.' });
    }

    if (String(new_password).length < 6) {
      return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters.' });
    }

    const normId = loginId.toLowerCase();

    // H-2.2: identifier resolution is restricted to the two UI-advertised
    // forms. "@": exact email lookup (trimmed + lowercased). Otherwise:
    // exact roll_number lookup (trimmed). Name, email-prefix, hardcoded
    // aliases, and the approval-store fallback are intentionally not consulted.
    // Login's broader identifier behavior is unchanged.
    let user: any = null;
    if (normId.includes('@')) {
      const { data: byEmail } = await dbRead.from('users').select('id, name, email, password_hash').eq('email', normId).maybeSingle();
      if (byEmail) user = byEmail;
    } else {
      const { data: byRoll } = await dbRead.from('users').select('id, name, email, password_hash').eq('roll_number', loginId).maybeSingle();
      if (byRoll) user = byRoll;
    }

    if (!user) {
      // H-2.2 enumeration hardening: unknown identifiers receive the same
      // generic credential-failure response as a wrong current password, and
      // no canonical email is echoed.
      return res.status(400).json({
        status: 'error',
        message: 'Current password is incorrect. Please verify and re-enter your existing password.'
      });
    }

    // Security requirement: Current password must be provided to authenticate password change
    if (!current_password) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Current password is required to verify your identity before updating credentials.' 
      });
    }

    // H-2 FIX (fail closed): a missing/invalid stored credential must NEVER
    // bypass verification. Reject with the same generic message used for a
    // wrong current password so hash state is not revealed.
    if (typeof user.password_hash !== 'string' || user.password_hash.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Current password is incorrect. Please verify and re-enter your existing password.'
      });
    }

    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({
        status: 'error',
        message: 'Current password is incorrect. Please verify and re-enter your existing password.'
      });
    }

    // Hash new password with bcrypt
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(new_password, salt);

    // Direct update in Supabase database!
    // H-3: assign a fresh token_version (race-safe set, not read-modify-write)
    // so JWTs issued before this reset stop verifying immediately.
    const { error: updateErr } = await dbWrite.from('users').update({
      password_hash,
      token_version: Date.now()
    }).eq('id', user.id);

    if (updateErr) {
      console.error('[RESET PASSWORD ERROR] Failed to update password in DB:', updateErr);
      return res.status(500).json({ status: 'error', message: 'Failed to update password in database.' });
    }

    // Dispatch security notification email to user
    if (user.email) {
      sendPasswordChangedSuccessEmail(user.email, {
        userName: user.name || 'Member',
        changedAt: new Date()
      }).catch((e) => console.error('[EMAIL ERROR] Failed to send password changed confirmation email:', e));
    }

    logAuditEvent({
      action: 'Password Reset',
      userId: user.id,
      itemId: null,
      description: `Password updated directly for ${user.name} (${user.email})`
    }).catch(() => {});

    return res.status(200).json({
      status: 'success',
      message: 'Your password has been reset and updated in the database! You can now log in with your new password.',
      data: { email: user.email }
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// CHANGE PASSWORD (AUTHENTICATED IN-PORTAL)
// ──────────────────────────────────────────────────────────────────────────────
export const changePassword = async (req: AuthRequest, res: Response) => {
  try {
    const { current_password, new_password } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized. Please sign in.' });
    }

    if (!current_password || !new_password) {
      return res.status(400).json({ status: 'error', message: 'Current password and new password are required.' });
    }

    if (String(new_password).length < 6) {
      return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters.' });
    }

    // Retrieve user from DB including current password hash
    const { data: user, error: userErr } = await dbRead.from('users').select('id, name, email, password_hash').eq('id', userId).single();
    if (userErr || !user) {
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ status: 'error', message: 'Current password is incorrect.' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(new_password, salt);

    // Update in DB
    // H-3: fresh token_version invalidates JWTs issued before this change.
    const { error: updateErr } = await dbWrite.from('users').update({ password_hash, token_version: Date.now() }).eq('id', user.id);
    if (updateErr) {
      console.error('[CHANGE PASSWORD ERROR] DB update failed:', updateErr);
      return res.status(500).json({ status: 'error', message: 'Failed to update password.' });
    }

    // Send confirmation email
    sendPasswordChangedSuccessEmail(user.email, {
      userName: user.name,
      changedAt: new Date()
    }).catch((e) => console.error('[EMAIL ERROR] Failed to send password changed email:', e));

    logAuditEvent({
      action: 'Password Changed',
      userId: user.id,
      itemId: null,
      description: `User ${user.name} (${user.email}) changed their password in-portal`
    }).catch(() => {});

    return res.status(200).json({
      status: 'success',
      message: 'Password updated successfully!'
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// ADMIN CREATE USER (DIRECT PROVISIONING WITH AUTO-APPROVAL & WELCOME EMAIL)
// ──────────────────────────────────────────────────────────────────────────────
export const adminCreateUser = async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, username, password, roll_number, batch, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ status: 'error', message: 'Name, college email, and temporary password are required.' });
    }

    // M-7.1: temporary password must meet the registration length policy.
    if (String(password).length < 6) {
      return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters.' });
    }

    const normEmail = email.trim().toLowerCase();
    // M-7.2: syntactic email check only — no JIIT-domain restriction, so
    // Gmail/superadmin provisioning keeps working.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) {
      return res.status(400).json({ status: 'error', message: 'Invalid email format.' });
    }
    const normUsername = (username || name).trim();
    const userBatch = batch ? String(batch).trim() : null;
    const userRole = role === 'ADMIN' ? 'ADMIN' : 'MEMBER';

    const blockedAdminEmails = (process.env.BLOCKED_ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    if (blockedAdminEmails.includes(normEmail) && userRole === 'ADMIN') {
      return res.status(400).json({ status: 'error', message: 'User is not permitted to hold an ADMIN role.' });
    }

    let userRoll = roll_number ? String(roll_number).trim() : null;
    if (!userRoll) {
      const match = normEmail.match(/^(\d+)@mail\.jiit\.ac\.in$/i);
      if (match) userRoll = match[1];
    }

    // Check duplicate
    const { data: existing } = await dbRead.from('users').select('id, email, roll_number').or(`email.ilike.${escapeOrSegment(normEmail)}${userRoll ? `,roll_number.eq.${escapeOrSegment(userRoll)}` : ''}`).limit(1).maybeSingle();
    if (existing) {
      return res.status(400).json({ status: 'error', message: `An account with email ${normEmail} or enrollment number ${userRoll} already exists.` });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    unpurgeEmail(normEmail);

    const { data: newUser, error: insertError } = await dbWrite
      .from('users')
      .insert([{ name: name.trim(), email: normEmail, password_hash, roll_number: userRoll, role: userRole }])
      .select('id, name, email, roll_number, role, created_at')
      .single();

    if (insertError || !newUser) {
      // M-7.4: map the check-then-insert duplicate race to the duplicate
      // response; never leak raw driver/PostgREST error text.
      if ((insertError as any)?.code === '23505') {
        return res.status(400).json({ status: 'error', message: `An account with email ${normEmail} or enrollment number ${userRoll} already exists.` });
      }
      console.error('[ADMIN CREATE USER ERROR]:', insertError);
      return res.status(500).json({ status: 'error', message: 'Failed to create user in database.' });
    }

    // Admin-created users are automatically APPROVED!
    setUserApproval(normEmail, 'APPROVED', req.user?.email || 'ADMIN', {
      username: normUsername,
      batch: userBatch,
      name: name.trim(),
      roll_number: userRoll
    });

    // Send Welcome Email with Temporary Password
    sendUserWelcomeWithTempPasswordEmail(normEmail, {
      userName: name.trim(),
      userEmail: normEmail,
      tempPassword: password,
      rollNumber: userRoll,
      batch: userBatch,
      isAutoApproved: true
    }).catch((e) => console.error('[EMAIL ERROR] Failed to send welcome email:', e));

    logAuditEvent({
      action: 'Admin Created User',
      userId: req.user?.id,
      itemId: null,
      description: `Admin ${req.user?.name || 'Admin'} provisioned member account for ${name.trim()} (${normEmail}) [Batch: ${userBatch || 'N/A'}, Role: ${userRole}]`
    }).catch(() => {});

    return res.status(201).json({
      status: 'success',
      message: `User ${name} provisioned successfully! Credentials and instructions emailed to ${normEmail}.`,
      data: { ...newUser, username: normUsername, batch: userBatch, status: 'APPROVED' }
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

export const logout = async (req: AuthRequest, res: Response) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      const { revokeToken } = await import('./tokenRevocationService');
      await revokeToken(token);
    }
    const { clearSessionUser } = await import('../../middleware/auth.middleware');
    await clearSessionUser(req);

    if (req.user?.id) {
      logAuditEvent({
        action: 'Sign Out',
        userId: req.user.id,
        itemId: null,
        description: `User signed out: ${req.user.name} (${req.user.email})`
      }).catch(() => {});
    }

    return res.status(200).json({ status: 'success', message: 'Signed out successfully. Token revoked.' });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

