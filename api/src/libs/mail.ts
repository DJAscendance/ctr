import nodemailer from 'nodemailer';

import { getMailFrom, getSiteName, getSiteUrl, getSmtpConfig } from './site-config';

/**
 * Sends one message through the deployment's configured mail transport.
 *
 * The transport used to be hard-coded to `127.0.0.1:25`. That is right for the production
 * host, which runs its own MTA beside the API, and wrong for a containerised deployment,
 * where `127.0.0.1` is the container itself and nothing listens there -- so every message
 * was lost. `getSmtpConfig()` now reads the transport from the environment and defaults to
 * that same local MTA, leaving the production path unchanged while a container can be
 * pointed at a real mail server.
 *
 * Throws on a delivery failure rather than swallowing it. Callers decide what a failed
 * message means to them; an approval, for example, stays approved. What must never happen
 * is this function reporting success for a message the mail server refused.
 */
export const sendEmail = async (data): Promise<void> => {
  const transporter = nodemailer.createTransport(getSmtpConfig());

  await transporter.sendMail({
    from: getMailFrom(),
    to: data.to,
    subject: data.subject,
    html: data.body,
  });
};

export const sendPasswordResetEmail = async (email: string, resetToken: string): Promise<void> => {
  await sendEmail({
    to: email,
    subject:  'Cybertown Revival Password Reset',
    body:
      `<p>Hello,</p>
      <p>
        We have received a request to reset the password on your account.
        Please click the link below to reset your password. If you did not request this,
        please ignore this email
      </p>
      <p>
        <a href='https://www.cybertownrevival.com/#/password_reset?token=${resetToken}'>
          Reset my password
        </a>
      </p>
      <p>This link will expire in 15 minutes.</p>`,
  });
};

export const sendPasswordResetUnknownEmail = async (email: string): Promise<void> => {
  await sendEmail({
    to: email,
    subject: 'Cybertown Revival Password Reset',
    body:
      `<p>Hello,</p>
      <p>Sorry, we were unable to find an account attached to this email address.</p>`,
  });
};

/**
 * Tells a new citizen that a city administrator has approved their immigration and they
 * may now log in.
 *
 * Only sent by deployments that require approval (`MEMBER_APPROVAL_REQUIRED`); where
 * immigration is immediate there is nothing to announce. The site name and login URL come
 * from the deployment's own configuration so the CTNG Beta's mail links at the beta host
 * rather than at production.
 *
 * @param email address to notify
 * @param username the approved member's nickname, so the mail names the account it is about
 */
export const sendMemberApprovedEmail = async (
  email: string,
  username: string,
): Promise<void> => {
  const siteName = getSiteName();
  await sendEmail({
    to: email,
    subject: `Your ${siteName} immigration has been approved`,
    body:
      `<p>Hello ${username},</p>
      <p>
        A city administrator has reviewed and approved your immigration to ${siteName}.
        You can now log in with the nickname and password you chose.
      </p>
      <p><a href='${getSiteUrl()}/#/login'>Log in to ${siteName}</a></p>
      <p>Welcome to the city.</p>`,
  });
};

/**
 * Confirms to a new citizen that their immigration was received and is waiting on a city
 * administrator. Sent at immigration time, so nobody is left wondering why their brand new
 * account will not log in.
 *
 * @param email address to notify
 * @param username the nickname the applicant chose
 */
export const sendMemberPendingApprovalEmail = async (
  email: string,
  username: string,
): Promise<void> => {
  const siteName = getSiteName();
  await sendEmail({
    to: email,
    subject: `Your ${siteName} immigration is being reviewed`,
    body:
      `<p>Hello ${username},</p>
      <p>
        Thank you for immigrating to ${siteName}. Your application has been received and is
        waiting for a city administrator to review it.
      </p>
      <p>
        You will not be able to log in until it is approved. We will email you again as soon
        as that happens.
      </p>`,
  });
};
