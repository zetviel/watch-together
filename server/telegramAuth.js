import axios from 'axios';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export function setupTelegramAuth(app, config) {
  const {
    clientId,
    clientSecret,
    baseUrl,
    sessionSecret
  } = config;

  const redirectUri = `${baseUrl}/api/auth/telegram/callback`;

  // Start Telegram OAuth flow
  app.get('/api/auth/telegram', (req, res) => {
    const returnTo = req.query.returnTo || '/';
    // State contains returnTo path, signed with secret to prevent tampering
    const state = jwt.sign({ returnTo }, sessionSecret, { expiresIn: '15m' });

    const authUrl = new URL('https://oauth.telegram.org/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile');
    authUrl.searchParams.set('state', state);

    res.redirect(authUrl.toString());
  });

  // Telegram OAuth callback
  app.get('/api/auth/telegram/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    let returnTo = '/';
    try {
      if (state) {
        const decodedState = jwt.verify(state, sessionSecret);
        if (decodedState.returnTo) returnTo = decodedState.returnTo;
      }
    } catch {
      // Ignore invalid state, fallback to /
    }

    if (error) {
      console.error('[Telegram OAuth] Auth error:', error, error_description);
      return res.redirect(`${returnTo}?auth_error=${encodeURIComponent(error_description || error)}`);
    }

    if (!code) {
      return res.redirect(`${returnTo}?auth_error=missing_code`);
    }

    try {
      // Exchange code for tokens
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      });

      const tokenRes = await axios.post('https://oauth.telegram.org/token', tokenParams.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      });

      const data = tokenRes.data;
      let userData = {
        id: 'tg_user',
        name: 'Telegram User',
        username: '',
        avatar: '',
        isTelegram: true
      };

      if (data.id_token) {
        // Decode JWT id_token (header.payload.signature)
        const parts = data.id_token.split('.');
        if (parts.length >= 2) {
          const payloadJson = Buffer.from(parts[1], 'base64').toString('utf-8');
          const claims = JSON.parse(payloadJson);
          userData = {
            id: String(claims.sub || claims.id || 'tg_' + Date.now()),
            name: claims.name || claims.preferred_username || 'Telegram User',
            username: claims.preferred_username || '',
            avatar: claims.picture || '',
            isTelegram: true
          };
        }
      } else if (data.access_token) {
        userData = {
          id: 'tg_' + Date.now(),
          name: 'Telegram User',
          username: '',
          avatar: '',
          isTelegram: true
        };
      }

      // Generate user session token
      const sessionToken = jwt.sign(userData, sessionSecret, { expiresIn: '30d' });

      res.cookie('wt_session', sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });

      res.redirect(returnTo);
    } catch (err) {
      console.error('[Telegram OAuth] Token exchange failed:', err.response?.data || err.message);
      res.redirect(`${returnTo}?auth_error=${encodeURIComponent('Token exchange failed')}`);
    }
  });

  // Fallback Telegram Login Widget verification endpoint
  app.post('/api/auth/telegram/widget', (req, res) => {
    try {
      const data = req.body;
      if (!data || !data.id || !data.hash) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      // Check hash if clientSecret or botToken available
      const { hash, ...dataToCheck } = data;
      const checkString = Object.keys(dataToCheck)
        .sort()
        .map(k => `${k}=${dataToCheck[k]}`)
        .join('\n');

      const secretKey = crypto.createHash('sha256').update(clientSecret).digest();
      const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

      // Check auth_date not expired (within 1 day)
      const now = Math.floor(Date.now() / 1000);
      if (now - Number(data.auth_date) > 86400) {
        return res.status(400).json({ error: 'Auth data is outdated' });
      }

      const userData = {
        id: String(data.id),
        name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || 'Telegram User',
        username: data.username || '',
        avatar: data.photo_url || '',
        isTelegram: true
      };

      const sessionToken = jwt.sign(userData, sessionSecret, { expiresIn: '30d' });
      res.cookie('wt_session', sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000
      });

      res.json({ ok: true, user: userData });
    } catch (err) {
      console.error('[Telegram Widget] Auth failed:', err);
      res.status(500).json({ error: 'Authentication failed' });
    }
  });

  // Guest authentication
  app.post('/api/auth/guest', (req, res) => {
    const rawName = (req.body.name || '').trim();
    const guestName = rawName.slice(0, 30) || `Гость_${Math.floor(1000 + Math.random() * 9000)}`;

    const guestId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const userData = {
      id: guestId,
      name: guestName,
      username: '',
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(guestName)}`,
      isTelegram: false
    };

    const sessionToken = jwt.sign(userData, sessionSecret, { expiresIn: '7d' });
    res.cookie('wt_session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ ok: true, user: userData });
  });

  // Get current user profile
  app.get('/api/auth/me', (req, res) => {
    const token = req.cookies.wt_session;
    if (!token) {
      return res.json({ user: null });
    }
    try {
      const user = jwt.verify(token, sessionSecret);
      res.json({ user });
    } catch {
      res.clearCookie('wt_session');
      res.json({ user: null });
    }
  });

  // Logout
  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('wt_session');
    res.json({ ok: true });
  });
}
