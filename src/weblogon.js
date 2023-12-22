import SteamCommunity from 'steamcommunity';
import SteamTotp from 'steam-totp';
import { LoginSession, EAuthTokenPlatformType, EAuthSessionGuardType } from 'steam-session';
import { promises as fs } from 'fs';
import fsExists from 'fs.promises.exists'
import path from 'path';

import { sleep } from './utils.js';


let g_AbortPromptFunc = null;
let result = null;
const tokensFolder = `${path.resolve(path.dirname(''))}/tokens`;

export const createSession = async (login, password, sharedSecret) => {
    if (!login || !password) {
        console.log('Login and password are needed');

        return false;
    }

    let community = new SteamCommunity();

    // Create a LoginSession for us to use to attempt to log into steam
    let session = new LoginSession(EAuthTokenPlatformType.SteamClient);

    // Go ahead and attach our event handlers before we do anything else.
    session.on('authenticated', async () => {
        let cookies = await session.getWebCookies();
        community.setCookies(cookies);

        const folderExists = await fsExists(tokensFolder);
        if (!folderExists) {
            await fs.mkdir(tokensFolder);
        }

        await fs.writeFile(`${tokensFolder}/${login}.bin`, session.refreshToken);
        console.log(`${login} session created`);
        result = true;
    });

    session.on('timeout', () => {
        console.log('This login attempt has timed out.');
        result = false;
    });

    session.on('error', (err) => {
        console.log(`ERROR: This login attempt has failed! ${err.message}`);
        result = false;
    });

    // Start our login attempt
    let startResult = await session.startWithCredentials({ accountName: login, password: password });

    if (startResult.actionRequired) {
        let codeActionTypes = [EAuthSessionGuardType.EmailCode, EAuthSessionGuardType.DeviceCode];
        let codeAction = startResult.validActions.find(action => codeActionTypes.includes(action.type));
        if (codeAction) {
            const code = SteamTotp.generateAuthCode(sharedSecret)
            await session.submitSteamGuardCode(code);
        }
    }

    while (result === null) {
        await sleep(1000);
    }

    return result;
}