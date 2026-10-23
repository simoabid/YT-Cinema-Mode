/**
 * Tests for the background YouTube auth builder.
 *
 * The HAR from the live browser showed the page sending
 *   Authorization: SAPISIDHASH <ts>_<hash>_u ...
 * plus X-Goog-AuthUser. The hash input was verified against the real header:
 *   sha1(USER_SESSION_ID + " " + timestamp + " " + cookie + " " + origin)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..');

function loadBackground(cookies) {
    let authListener = null;

    const api = {
        runtime: {
            onInstalled: { addListener() {} },
            onMessage: { addListener(fn) { authListener = fn; } }
        },
        commands: { onCommand: { addListener() {} } },
        declarativeNetRequest: {
            updateDynamicRules: async () => {}
        },
        cookies: {
            async get({ name }) {
                return name in cookies ? { name, value: cookies[name] } : null;
            }
        },
        storage: {
            sync: {
                get: async () => ({}),
                set: async () => {}
            }
        },
        tabs: {
            query: async () => [],
            sendMessage: async () => {}
        }
    };

    const sandbox = {
        chrome: api,
        console,
        crypto: nodeCrypto.webcrypto,
        TextEncoder,
        URL,
        setTimeout,
        clearTimeout,
        Promise,
        Array,
        Object,
        String,
        Number,
        Math,
        Date,
        JSON,
        isNaN
    };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    const code = fs.readFileSync(path.join(ROOT, 'background/background.js'), 'utf8');
    vm.runInContext(code, context, { filename: 'background/background.js' });

    if (!authListener) throw new Error('background never registered the auth message listener');
    return authListener;
}

function requestAuth(listener, message) {
    return new Promise((resolve, reject) => {
        try {
            listener(message, {}, resolve);
        } catch (err) {
            reject(err);
        }
    });
}

const ORIGIN = 'https://www.youtube.com';
const USER_SESSION_ID = 'test-user-session-id';
const COOKIES = {
    SAPISID: 'cookie-sapisid-value',
    '__Secure-1PAPISID': 'cookie-1p-value',
    '__Secure-3PAPISID': 'cookie-3p-value'
};

describe('background YouTube auth', () => {
    it('builds the same three-token SAPISIDHASH header as the watch page', async () => {
        const listener = loadBackground(COOKIES);
        const response = await requestAuth(listener, {
            action: 'yt-cinema-auth',
            sessionIndex: '2',
            userSessionId: USER_SESSION_ID,
            delegatedSessionId: null
        });

        if (!response || !response.authorization) throw new Error('no authorization returned');
        if (response.authUser !== '2') throw new Error(`wrong auth user: ${response.authUser}`);
        if (response.origin !== ORIGIN) throw new Error(`wrong origin: ${response.origin}`);

        const tokens = [...response.authorization.matchAll(
            /(SAPISIDHASH|SAPISID1PHASH|SAPISID3PHASH) (\d+)_([0-9a-f]{40})_u/g
        )];
        if (tokens.length !== 3) {
            throw new Error(`expected 3 auth tokens, got ${tokens.length}: ${response.authorization}`);
        }

        const cookieFor = {
            SAPISIDHASH: 'SAPISID',
            SAPISID1PHASH: '__Secure-1PAPISID',
            SAPISID3PHASH: '__Secure-3PAPISID'
        };

        for (const [, scheme, timestamp, hash] of tokens) {
            const cookie = COOKIES[cookieFor[scheme]];
            const expected = nodeCrypto
                .createHash('sha1')
                .update(`${USER_SESSION_ID} ${timestamp} ${cookie} ${ORIGIN}`)
                .digest('hex');
            if (hash !== expected) {
                throw new Error(`${scheme} hash does not match YouTube's formula`);
            }
        }
    });

    it('falls back to the secure cookie when SAPISID is missing', async () => {
        const listener = loadBackground({ '__Secure-3PAPISID': 'only-3p' });
        const response = await requestAuth(listener, {
            action: 'yt-cinema-auth',
            sessionIndex: '0',
            userSessionId: USER_SESSION_ID
        });

        if (!response || !response.authorization) throw new Error('no authorization returned');
        if (!response.authorization.startsWith('SAPISIDHASH ')) {
            throw new Error('the secure fallback did not produce SAPISIDHASH');
        }
        if (response.authorization.includes('SAPISID1PHASH')) {
            throw new Error('a 1P token was produced without a 1P cookie');
        }
    });

    it('returns null when no session cookie exists', async () => {
        const listener = loadBackground({});
        const response = await requestAuth(listener, {
            action: 'yt-cinema-auth',
            sessionIndex: '2',
            userSessionId: USER_SESSION_ID
        });
        if (response) throw new Error('built auth without any SAPISID cookie');
    });

    it('ignores unrelated messages', () => {
        const listener = loadBackground(COOKIES);
        let responded = false;
        const returned = listener({ action: 'toggle-cinema' }, {}, () => {
            responded = true;
        });
        if (returned !== undefined) throw new Error('claimed to handle an unrelated message');
        if (responded) throw new Error('answered a message meant for another listener');
    });
});
