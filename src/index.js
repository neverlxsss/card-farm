import {promises as fs} from 'fs';
import path from "path";
import SteamUser from "steam-user";
import fsExists from "fs.promises.exists";
import {createSession} from "./weblogon.js";
import {sleep} from "./utils.js";
import puppeteer from "puppeteer";
import TradeOfferManager from "steam-tradeoffer-manager";
import SteamCommunity from "steamcommunity";

const tokensFolder = `${path.resolve(path.dirname(''))}/tokens`;
const mafilesFolder = `${path.resolve(path.dirname(''))}/maFiles`;

let gAccounts = [];
let tradeUrl = null;

const readMafiles = async () => {
    const files = await fs.readdir(mafilesFolder);

    for (const file of files) {
        if (!file.toLowerCase().includes(".mafile"))
            continue;
        const content = JSON.parse((await fs.readFile(`${mafilesFolder}/${file}`)).toString())

        try {
            gAccounts[content.account_name].shared_secret = content.shared_secret;
            gAccounts[content.account_name].identity_secret = content.identity_secret;
        } catch (e) {
            // pass
        }
    }
}

const readTrade = async () => {
    tradeUrl = (await fs.readFile(`${path.resolve(path.dirname(''))}/trade.txt`)).toString()

    if (!tradeUrl || tradeUrl.length < 10) {
        console.log("Trade url in 'trade.txt' is required")
        process.exit(-1)
    }
}

const readAccounts = async () => {
    const content = (await fs.readFile(`${path.resolve(path.dirname(''))}/accounts.txt`)).toString()
    let accounts = content.split("\r\n")

    accounts.forEach(account => {
        gAccounts[account.split(':')[0]] = {
            login: account.split(':')[0],
            password: account.split(':')[1],
            farmed: false,
        };
    });
}

const farm = (async (cookies) => {
    // Launch the browser and open a new blank page
    const browser = await puppeteer.launch({headless: "new"});
    const page = await browser.newPage();

    // Navigate the page to a URL
    await page.goto('https://store.steampowered.com/');

    // Set screen size
    await page.setViewport({width: 1920, height: 1080});
    await page.setCookie(...cookies)
    await page.goto("https://store.steampowered.com/explore/startnew")

    while (true) {
        try {
            await page.waitForSelector('.next_in_queue_content', {visible: true, timeout: 10000})
            await page.evaluate(() => {
                document.querySelector('.next_in_queue_content').click()
            });
            await sleep(1000)
        } catch (e) {
            // done
            break
        }
    }

    await browser.close()
})

const createClient = async (login, password, secret = null) => {
    console.log(login)
    if (!login || !password) {
        console.log('Login and password are needed');

        return;
    }

    let client = new SteamUser();
    const fileExists = await fsExists(`${tokensFolder}/${login}.bin`);

    if (!fileExists) {
        const createSessionResult = await createSession(login, password, secret);
        await sleep(500)
    }
    const refreshToken = (await fs.readFile(`${tokensFolder}/${login}.bin`)).toString();

    client.logOn({
        "refreshToken": refreshToken,
    });

    client.on('webSession', async (sessionID, cookies) => {
        gAccounts[login].steamLoginSecure = cookies[0].split('steamLoginSecure=')[1]
        gAccounts[login].cookies = cookies
    });

    client.on('loggedOn', (details) => {
        console.log('logged')
    });

    client.on('error', async (e) => {
        // Some error occurred during logon
        console.log(e);
    });
}

const trade = async (login) => {
    let client = new SteamUser();
    let community = new SteamCommunity();

    let manager = new TradeOfferManager({
        "steam": client, // Polling every 30 seconds is fine since we get notifications from Steam
        "domain": "example.com", // Our domain is example.com
        "language": "en" // We want English item descriptions
    });

    community.setCookies(gAccounts[login].cookies);
    manager.setCookies(gAccounts[login].cookies, async function (err) {
        if (err) {
            console.log(err);
            process.exit(1); // Fatal error since we couldn't get our API key
            return;
        }

        // Get our inventory
        manager.getInventoryContents(753, 6, true, function (err, inventory) {
            if (err) {
                console.log(err);
                return;
            }

            if (inventory.length === 0) {
                // Inventory empty
                console.log("Steam inventory is empty");
                return;
            }

            console.log("Found " + inventory.length + " steam items");

            // Create and send the offer
            let offer = manager.createOffer(tradeUrl);
            offer.addMyItems(inventory);

            offer.send(function (err, status) {
                if (err) {
                    console.log(err);
                    return;
                }

                if (status === 'pending') {
                    // We need to confirm it
                    console.log(`Offer #${offer.id} sent, but requires confirmation`);

                    community.acceptConfirmationForObject(gAccounts[login].identity_secret, offer.id, (err) => {
                        if (err) {
                            console.log(err)
                        } else {
                            console.log("Confirmed")
                        }
                    });
                } else {
                    console.log(`Offer #${offer.id} sent successfully`);
                }
            });
        });
    });
}

const bootstrap = async () => {
    await readTrade()
    await readAccounts()
    await readMafiles()
}

const main = async () => {
    await bootstrap()

    for (const login of Object.keys(gAccounts)) {
        await createClient(gAccounts[login].login, gAccounts[login].password, gAccounts[login].shared_secret)
        while (!gAccounts[login].steamLoginSecure) {
            await sleep(100);
        }

        // await farm([{'name': "steamLoginSecure", 'value': gAccounts[login].steamLoginSecure}])
        await trade(login)
        await sleep(2500)
    }

    process.exit(0)
}

main()