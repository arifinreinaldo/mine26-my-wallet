import { signJwt } from '../helpers/jwt.js';

function generateOtp() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, '0');
}

async function sendOtpViaNtfy(username, otp) {
  const topic = `my-wallet-${username}`;
  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      title: 'My Wallet - Verification Code',
      message: `Your OTP is: ${otp}`,
      tags: ['key'],
    }),
  });
}

export async function handleCheckUsername(sql, username) {
  if (!username) {
    return {
      status: 400,
      body: { success: false, message: 'username query parameter is required' },
    };
  }

  const [existing] = await sql`
    SELECT id FROM users WHERE username = ${username}
  `;

  return {
    body: { success: true, available: !existing },
  };
}

export async function handleRegister(sql, body) {
  const { name, email, username } = body;

  if (!name || !email || !username) {
    return {
      status: 400,
      body: { success: false, message: 'name, email, and username are required' },
    };
  }

  // Check if email is taken by a verified user
  const [existingEmail] = await sql`
    SELECT id, verified FROM users WHERE email = ${email}
  `;
  if (existingEmail && existingEmail.verified) {
    return {
      status: 409,
      body: { success: false, message: 'A user with this email already exists' },
    };
  }

  // Check if username is taken by a verified user
  const [existingUsername] = await sql`
    SELECT id, verified FROM users WHERE username = ${username}
  `;
  if (existingUsername && existingUsername.verified) {
    return {
      status: 409,
      body: { success: false, message: 'This username is already taken' },
    };
  }

  // If an unverified user exists with this username, update their info and resend OTP
  if (existingUsername && !existingUsername.verified) {
    await sql`
      UPDATE users SET name = ${name}, email = ${email}
      WHERE id = ${existingUsername.id}
    `;
  } else if (existingEmail && !existingEmail.verified) {
    // Unverified user exists with this email, update their info
    await sql`
      UPDATE users SET name = ${name}, username = ${username}
      WHERE id = ${existingEmail.id}
    `;
  } else {
    await sql`
      INSERT INTO users (name, email, username, verified)
      VALUES (${name}, ${email}, ${username}, false)
    `;
  }

  // Invalidate any previous unused registration OTPs for this username
  await sql`
    UPDATE otp_codes SET used = true
    WHERE username = ${username} AND purpose = 'register' AND used = false
  `;

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await sql`
    INSERT INTO otp_codes (username, code, purpose, expires_at)
    VALUES (${username}, ${otp}, 'register', ${expiresAt})
  `;

  await sendOtpViaNtfy(username, otp);

  return {
    body: { success: true, message: 'OTP sent' },
  };
}

export async function handleVerifyRegistration(sql, body, env) {
  const { username, otp } = body;

  if (!username || !otp) {
    return {
      status: 400,
      body: { success: false, message: 'username and otp are required' },
    };
  }

  const [otpRecord] = await sql`
    SELECT id FROM otp_codes
    WHERE username = ${username}
      AND code = ${otp}
      AND purpose = 'register'
      AND used = false
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!otpRecord) {
    return {
      status: 400,
      body: { success: false, message: 'Invalid or expired OTP' },
    };
  }

  await sql`UPDATE otp_codes SET used = true WHERE id = ${otpRecord.id}`;
  await sql`UPDATE users SET verified = true WHERE username = ${username}`;

  const [user] = await sql`
    SELECT id, username FROM users WHERE username = ${username}
  `;

  const token = await signJwt({ userId: user.id, username: user.username }, env.JWT_SECRET);

  return {
    body: { success: true, token },
  };
}

export async function handleLogin(sql, body) {
  const { username } = body;

  if (!username) {
    return {
      status: 400,
      body: { success: false, message: 'username is required' },
    };
  }

  const [user] = await sql`
    SELECT id, verified FROM users WHERE username = ${username}
  `;

  if (!user) {
    return {
      status: 404,
      body: { success: false, message: 'User not found' },
    };
  }

  if (!user.verified) {
    return {
      status: 403,
      body: { success: false, message: 'User is not verified' },
    };
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await sql`
    INSERT INTO otp_codes (username, code, purpose, expires_at)
    VALUES (${username}, ${otp}, 'login', ${expiresAt})
  `;

  await sendOtpViaNtfy(username, otp);

  return {
    body: { success: true, message: 'OTP sent' },
  };
}

export async function handleVerifyLogin(sql, body, env) {
  const { username, otp } = body;

  if (!username || !otp) {
    return {
      status: 400,
      body: { success: false, message: 'username and otp are required' },
    };
  }

  const [otpRecord] = await sql`
    SELECT id FROM otp_codes
    WHERE username = ${username}
      AND code = ${otp}
      AND purpose = 'login'
      AND used = false
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!otpRecord) {
    return {
      status: 400,
      body: { success: false, message: 'Invalid or expired OTP' },
    };
  }

  await sql`UPDATE otp_codes SET used = true WHERE id = ${otpRecord.id}`;

  const [user] = await sql`
    SELECT id, username FROM users WHERE username = ${username}
  `;

  const token = await signJwt({ userId: user.id, username: user.username }, env.JWT_SECRET);

  return {
    body: { success: true, token },
  };
}
